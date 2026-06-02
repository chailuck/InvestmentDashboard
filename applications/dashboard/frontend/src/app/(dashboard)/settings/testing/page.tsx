'use client'

import { useState, useRef, useEffect } from 'react'
import {
  FlaskConical, Play, Square, CheckCircle2, XCircle,
  Loader2, Terminal, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SSELine { line?: string; done?: boolean; exit_code?: number }

interface TestSummary {
  passed: number | null
  failed: number | null
  errors: number | null
  warnings: number | null
  duration: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseSummary(lines: string[]): TestSummary {
  const summary: TestSummary = { passed: null, failed: null, errors: null, warnings: null, duration: null }
  for (const line of lines) {
    const m = line.match(/(\d+) passed/)
    if (m) summary.passed = parseInt(m[1])
    const f = line.match(/(\d+) failed/)
    if (f) summary.failed = parseInt(f[1])
    const e = line.match(/(\d+) error/)
    if (e) summary.errors = parseInt(e[1])
    const w = line.match(/(\d+) warning/)
    if (w) summary.warnings = parseInt(w[1])
    const d = line.match(/in ([\d.]+s)/)
    if (d) summary.duration = d[1]
  }
  return summary
}

function lineColor(line: string): string {
  if (/PASSED/.test(line)) return 'text-emerald-400'
  if (/FAILED|ERROR/.test(line)) return 'text-red-400'
  if (/WARNING/.test(line)) return 'text-amber-400'
  if (/SKIPPED/.test(line)) return 'text-slate-400'
  if (/={3,}/.test(line)) return 'text-brand-400 font-semibold'
  if (/^tests\//.test(line) || /::test_/.test(line)) return 'text-sky-300'
  if (/^ERRORS?/.test(line) || /^FAILURES?/.test(line)) return 'text-red-300 font-semibold'
  if (/^E /.test(line)) return 'text-red-300'
  return 'text-slate-300'
}

// ── Frontend test info ─────────────────────────────────────────────────────────

const FRONTEND_FILES = [
  { file: 'src/store/__tests__/dashboard.test.ts', tests: 14 },
  { file: 'src/services/__tests__/weeklyScan.test.ts', tests: 26 },
  { file: 'src/components/dashboard/__tests__/PortfolioSummaryWidget.test.tsx', tests: 11 },
  { file: 'src/components/dashboard/__tests__/MarketPulseWidget.test.tsx', tests: 9 },
  { file: 'src/components/dashboard/__tests__/PnlWaterfallWidget.test.tsx', tests: 9 },
  { file: 'src/components/dashboard/__tests__/AllocationChartWidget.test.tsx', tests: 10 },
]

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TestingPage() {
  const accessToken = useAuthStore(s => s.accessToken)
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [showFrontend, setShowFrontend] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const summary = parseSummary(lines)
  const hasRun = lines.length > 0 || exitCode !== null
  const totalFrontend = FRONTEND_FILES.reduce((s, f) => s + f.tests, 0)

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  const runBackendTests = async () => {
    setLines([])
    setExitCode(null)
    setRunning(true)
    abortRef.current = new AbortController()

    try {
      const resp = await fetch('/api/proxy/api/v1/testing/run/backend', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: abortRef.current.signal,
      })

      if (!resp.ok || !resp.body) {
        setLines([`Error: ${resp.status} ${resp.statusText}`])
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const evt: SSELine = JSON.parse(part.slice(6))
            if (evt.done) {
              setExitCode(evt.exit_code ?? -1)
            } else if (evt.line !== undefined) {
              setLines(prev => [...prev, evt.line!])
            }
          } catch { /* ignore malformed event */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setLines(prev => [...prev, `Stream error: ${err?.message ?? String(err)}`])
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const stopTests = () => {
    abortRef.current?.abort()
    setRunning(false)
    setLines(prev => [...prev, '', '--- Stopped by user ---'])
  }

  return (
    <div className="max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical className="w-5 h-5 text-brand-400" />
        <div>
          <h1 className="text-lg font-bold text-ink-primary">Test Runner</h1>
          <p className="text-xs text-ink-muted">Run automated tests and view results</p>
        </div>
      </div>

      {/* ── Backend tests ── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand-400" />
              Backend Tests
              <span className="text-[10px] font-normal text-ink-muted">(pytest · 95 tests)</span>
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              auth · weekly scan · action plan · portfolio tracker · health
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hasRun && !running && (
              <button
                onClick={() => { setLines([]); setExitCode(null) }}
                className="btn-ghost text-xs gap-1.5 py-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
            {running ? (
              <button onClick={stopTests} className="btn-ghost text-xs gap-1.5 py-1.5 text-loss hover:text-loss">
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            ) : (
              <button
                onClick={runBackendTests}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Run Tests
              </button>
            )}
          </div>
        </div>

        {/* Summary bar */}
        {(summary.passed !== null || summary.failed !== null || exitCode !== null) && (
          <div className={cn(
            'flex items-center gap-4 px-4 py-2.5 rounded-lg border text-xs font-semibold',
            exitCode === 0
              ? 'bg-gain/8 border-gain/20 text-gain'
              : 'bg-loss/8 border-loss/20 text-loss',
          )}>
            {exitCode === 0
              ? <CheckCircle2 className="w-4 h-4 shrink-0" />
              : <XCircle className="w-4 h-4 shrink-0" />}
            <span>
              {exitCode === 0 ? 'All tests passed' : 'Tests failed'}
              {summary.passed !== null && ` · ${summary.passed} passed`}
              {summary.failed !== null && summary.failed > 0 && ` · ${summary.failed} failed`}
              {summary.errors !== null && summary.errors > 0 && ` · ${summary.errors} errors`}
              {summary.duration && ` · ${summary.duration}`}
            </span>
          </div>
        )}

        {/* Terminal output */}
        {(lines.length > 0 || running) && (
          <div
            ref={outputRef}
            className="bg-[#0a0e17] border border-border/40 rounded-lg p-4 font-mono text-[11px] leading-5 overflow-y-auto"
            style={{ maxHeight: '60vh', minHeight: '200px' }}
          >
            {lines.map((line, i) => (
              <div key={i} className={cn('whitespace-pre-wrap break-all', lineColor(line))}>
                {line || ' '}
              </div>
            ))}
            {running && (
              <div className="flex items-center gap-2 text-brand-400 mt-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Running…</span>
              </div>
            )}
          </div>
        )}

        {/* Idle state */}
        {!hasRun && !running && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-ink-muted">
            <FlaskConical className="w-8 h-8 opacity-30" />
            <p className="text-sm">Click <strong className="text-ink-secondary">Run Tests</strong> to execute the pytest suite</p>
            <p className="text-xs text-ink-disabled">Runs inside the inv_backend Docker container</p>
          </div>
        )}
      </div>

      {/* ── Frontend tests ── */}
      <div className="card p-5 space-y-3">
        <button
          onClick={() => setShowFrontend(v => !v)}
          className="w-full flex items-center justify-between"
        >
          <div className="text-left">
            <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              Frontend Tests
              <span className="text-[10px] font-normal text-ink-muted">(Vitest · {totalFrontend} tests)</span>
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              dashboard store · weeklyScan service · 4 widget components
            </p>
          </div>
          {showFrontend
            ? <ChevronUp className="w-4 h-4 text-ink-muted" />
            : <ChevronDown className="w-4 h-4 text-ink-muted" />}
        </button>

        {showFrontend && (
          <div className="space-y-3 pt-1">
            {/* File table */}
            <div className="overflow-hidden rounded-lg border border-border/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-surface-elevated">
                    <th className="px-3 py-2 text-left text-ink-muted font-semibold">Test file</th>
                    <th className="px-3 py-2 text-right text-ink-muted font-semibold">Tests</th>
                  </tr>
                </thead>
                <tbody>
                  {FRONTEND_FILES.map(f => (
                    <tr key={f.file} className="border-b border-border/20 last:border-0 hover:bg-surface-elevated/40">
                      <td className="px-3 py-2 font-mono text-ink-secondary">{f.file}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-primary font-semibold">{f.tests}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-elevated">
                    <td className="px-3 py-2 font-semibold text-ink-primary">Total</td>
                    <td className="px-3 py-2 text-right font-bold text-brand-400">{totalFrontend}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Run instructions */}
            <div className="rounded-lg bg-surface-elevated border border-border/40 p-4 space-y-2">
              <p className="text-xs font-semibold text-ink-secondary">Run frontend tests locally:</p>
              <div className="bg-[#0a0e17] rounded-lg p-3 font-mono text-[11px] text-slate-300 space-y-1">
                <div><span className="text-slate-500"># Install deps (first time only)</span></div>
                <div>cd applications/dashboard/frontend</div>
                <div>npm install</div>
                <div className="mt-2"><span className="text-slate-500"># Run all tests</span></div>
                <div>npx vitest run --reporter=verbose</div>
                <div className="mt-2"><span className="text-slate-500"># Watch mode</span></div>
                <div>npx vitest</div>
                <div className="mt-2"><span className="text-slate-500"># With coverage</span></div>
                <div>npx vitest run --coverage</div>
              </div>
              <p className="text-[11px] text-ink-disabled">
                Frontend tests run in jsdom with all HTTP calls mocked — no network access required.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Master runner ── */}
      <div className="card p-5 space-y-2">
        <h2 className="text-sm font-semibold text-ink-primary">Master Test Runner</h2>
        <p className="text-xs text-ink-muted">Run both suites from the project root:</p>
        <div className="bg-[#0a0e17] rounded-lg p-3 font-mono text-[11px] text-slate-300 space-y-1">
          <div><span className="text-slate-500"># All suites</span></div>
          <div>bash applications/dashboard/run-tests.sh</div>
          <div className="mt-2"><span className="text-slate-500"># Backend only</span></div>
          <div>bash applications/dashboard/run-tests.sh backend</div>
          <div className="mt-2"><span className="text-slate-500"># Frontend only</span></div>
          <div>bash applications/dashboard/run-tests.sh frontend</div>
        </div>
      </div>

    </div>
  )
}
