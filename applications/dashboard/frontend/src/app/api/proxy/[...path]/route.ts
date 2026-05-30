/**
 * Universal backend proxy — lets the browser call /api/proxy/... instead of
 * http://localhost:8000/... so the app works behind any tunnel (ngrok, Cloudflare,
 * etc.) without rebuilding.  The Next.js server-side code reaches the backend on
 * the internal Docker network via BACKEND_URL.
 */

import { type NextRequest, NextResponse } from 'next/server'

const BACKEND = (process.env.BACKEND_URL ?? 'http://backend:8000').replace(/\/$/, '')

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const tail = params.path.join('/')
  const qs   = req.nextUrl.search          // includes leading '?'
  const url  = `${BACKEND}/${tail}${qs}`

  // Forward relevant headers, strip host so the backend sees its own hostname
  const fwdHeaders = new Headers()
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (['host', 'connection', 'transfer-encoding'].includes(lower)) return
    fwdHeaders.set(key, value)
  })

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  // Buffer the entire request body as ArrayBuffer so Node.js fetch can forward it
  // reliably.  Passing req.body (a ReadableStream) with duplex:'half' works in some
  // runtimes but arrives empty in others — buffering avoids that inconsistency and
  // fixes "Invalid credentials" errors when the browser calls through any tunnel.
  const body = hasBody ? await req.arrayBuffer() : undefined

  // Let fetch calculate the correct content-length from the buffer
  if (body !== undefined) fwdHeaders.delete('content-length')

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method:  req.method,
      headers: fwdHeaders,
      body,
      // Don't follow redirects — let the client handle them
      redirect: 'manual',
    })
  } catch (err: any) {
    return NextResponse.json(
      { detail: `Proxy: could not reach backend — ${err?.message ?? err}` },
      { status: 502 },
    )
  }

  // Build response headers — forward what matters
  const resHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (['transfer-encoding', 'connection'].includes(lower)) return
    resHeaders.set(key, value)
  })

  // Stream the body directly (handles SSE, file downloads, and regular JSON)
  return new NextResponse(upstream.body, {
    status:  upstream.status,
    headers: resHeaders,
  })
}

export const GET     = proxy
export const POST    = proxy
export const PUT     = proxy
export const DELETE  = proxy
export const PATCH   = proxy
export const OPTIONS = proxy
