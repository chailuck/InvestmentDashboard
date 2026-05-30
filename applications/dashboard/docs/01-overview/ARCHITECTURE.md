# System Architecture

---

## 1. High-Level Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Next.js 14 — port 3000)                       │
│  React 18 · TypeScript · TanStack Query · Zustand       │
└─────────────┬───────────────────────────────────────────┘
              │ HTTP /api/proxy/...  (same-origin, no CORS)
              ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js API Route Proxy  /api/proxy/[...path]          │
│  Runtime: process.env.BACKEND_URL (http://backend:8000) │
└─────────────┬───────────────────────────────────────────┘
              │ HTTP/SSE  (internal Docker network)
              ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI Backend  (port 8000)                           │
│  4 Uvicorn workers · Socket.IO mounted at root          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  PostgreSQL │  │   Redis 7    │  │  yfinance /   │  │
│  │  16-alpine  │  │  Token store │  │  Anthropic    │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Excel file volume  /app/investment_data  (ro)  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
          ↕ dashboard-net (Docker bridge)
```

---

## 2. The Next.js Proxy Pattern

All browser API calls go through a Next.js server-side route at `/api/proxy/[...path]`. This proxy:

- Forwards the request (including JWT Bearer header) to `http://backend:8000/...`
- Buffers the request body as `ArrayBuffer` before forwarding (fixes streaming body issues)
- Streams the response body back (handles SSE for AI Copilot)
- Strips hop-by-hop headers (`host`, `connection`, `transfer-encoding`)

**Why this matters:**
- Works behind any external tunnel (ngrok, Cloudflare) without rebuilding the frontend
- No CORS issues — browser only sees the same-origin Next.js server
- `BACKEND_URL` is a runtime env var, not baked at build time

**File:** `frontend/src/app/api/proxy/[...path]/route.ts`

```typescript
const BACKEND = (process.env.BACKEND_URL ?? 'http://backend:8000').replace(/\/$/, '')

async function proxy(req: NextRequest, { params }) {
  const url = `${BACKEND}/${params.path.join('/')}${req.nextUrl.search}`
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  const body = hasBody ? await req.arrayBuffer() : undefined
  fwdHeaders.delete('content-length')   // let fetch recalculate
  const upstream = await fetch(url, { method: req.method, headers: fwdHeaders, body, redirect: 'manual' })
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders })
}
```

---

## 3. Authentication Flow

```
┌──────────┐   POST /api/proxy/api/v1/auth/login   ┌──────────────┐
│ Browser  │ ─────────────────────────────────────► │   FastAPI    │
│          │ ◄───────────────────────────────────── │              │
│          │   { accessToken, refreshToken }         │  JWT signed  │
│          │                                         │  HS256       │
│          │   GET /api/proxy/api/v1/...             │              │
│          │   Authorization: Bearer <accessToken>  │              │
│          │ ─────────────────────────────────────► │              │
│          │                                         │  Verify JWT  │
└──────────┘                                         └──────────────┘

On 401:
  → Axios interceptor: POST /api/proxy/api/v1/auth/refresh
  → If success: retry original request
  → If failure: clearAuth() → redirect to /login
```

Token storage: Zustand store in `sessionStorage` (cleared on tab close).

---

## 4. Data Flow — Portfolio

```
Excel file (read-only mount)
  │  pandas read_excel
  ▼
portfolio_excel.py._load_df()
  │  cache: { df, mtime }  →  invalidated when .cache_bust file changes
  │
  ├── get_positions()          →  yfinance live prices for open positions
  ├── get_daily_performance()  →  grouped by day/week/month, cumsum
  ├── get_performance_by_date()
  ├── get_performance_by_stock()
  └── get_period_transactions()

Frontend:
  TanStack Query (60s refetch) → portfolioTrackerService → /api/proxy → FastAPI → above
```

**Cross-worker cache invalidation:**  
FastAPI runs 4 Uvicorn workers. Each has its own in-memory `_CACHE` dict. When the Excel is refreshed (copied from source), a `.cache_bust` timestamp file is written. Every `_cached()` call checks the file's mtime — if newer than the cache entry, the cache is cleared and data is reloaded.

---

## 5. AI Copilot Data Flow

```
Browser POST /api/proxy/api/v1/ai/copilot/stream
  ↓ Next.js proxy (streams response)
  ↓ FastAPI StreamingResponse (text/event-stream)
  ↓ Anthropic API (claude-sonnet-4-6)
  ↓ Tool use loop (up to 6 iterations):
      get_portfolio_positions → portfolio_excel.get_positions()
      get_live_price          → yfinance
      get_performance_summary → portfolio_excel
      read_knowledge_doc      → /app/investment_agent/knowledge/*.md
      run_analysis_script     → subprocess python *.py

SSE events: { type: 'text'|'tool_start'|'tool_end'|'error'|'done', content/name }
```

---

## 6. Multi-Worker Architecture

The backend uses 4 Uvicorn workers defined in `docker/Dockerfile.backend`:

```dockerfile
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

**Implications:**
- In-memory state (like `_SESSIONS` for AI copilot) is NOT shared between workers. Sessions are sticky per connection, which works for SSE but may not persist across disconnects.
- The `.cache_bust` file mechanism is used for shared cache invalidation across workers.
- The admin seed (`ON CONFLICT DO NOTHING`) is safe to run on all 4 workers simultaneously.

---

## 7. Frontend State Management

| State type | Tool | Storage |
|-----------|------|---------|
| Auth (user, tokens) | Zustand | sessionStorage |
| Server data (positions, plans) | TanStack Query | memory (with 60s refetch) |
| UI state (modals, filters) | React useState | component memory |
| Persistent user prefs | localStorage | `portfolio_criteria`, `portfolio_default_months` |

---

## 8. Docker Network

All services connect to `dashboard-net` (bridge driver). Services communicate by hostname:

| Container | Internal hostname | Calls |
|-----------|------------------|-------|
| `inv_frontend` | `frontend` | `http://backend:8000` |
| `inv_backend` | `backend` | `postgres:5432`, `redis:6379` |
| `inv_postgres` | `postgres` | — |
| `inv_redis` | `redis` | — |
