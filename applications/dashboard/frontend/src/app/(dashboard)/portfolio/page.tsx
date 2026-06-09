'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { format, subMonths } from 'date-fns'
import { RefreshCw, AlertCircle, ChevronDown, ChevronRight, X, Loader2, CheckCircle2, XCircle, FileText, Copy, Trash2, RotateCcw, Table2, Database, ArrowUpDown, ArrowUp, ArrowDown, Wallet, Plus, Pencil, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  portfolioTrackerService,
  type Position,
  type Period,
  type StatusFilter,
  type PeriodTransaction,
} from '@/services/portfolioTracker'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'
import { portfolioService, type UserPortfolio } from '@/services/portfolio'
import {
  investmentTransactionService,
  type InvestmentTransaction,
  type InvestmentAction,
  INVESTMENT_ACTIONS,
} from '@/services/investmentTransaction'

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 2) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })

const fmtPnl = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n, 0)}`
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`
const todayStr = () => format(new Date(), 'yyyy-MM-dd')

function getDefaultMonths(): number {
  if (typeof window === 'undefined') return 3
  return parseInt(localStorage.getItem('portfolio_default_months') ?? '3', 10) || 3
}

function defaultFromDate(): string {
  return format(subMonths(new Date(), getDefaultMonths()), 'yyyy-MM-dd')
}

function loadCriteria() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('portfolio_criteria')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveCriteria(fromDate: string, toDate: string, statusFilter: StatusFilter) {
  if (typeof window === 'undefined') return
  localStorage.setItem('portfolio_criteria', JSON.stringify({ fromDate, toDate, statusFilter }))
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-muted mb-1">{label}</p>
      <p className={cn('text-xl font-bold',
        positive === true ? 'text-gain' : positive === false ? 'text-loss' : 'text-ink-primary')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-1">
      {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
        <button key={p} onClick={() => onChange(p)}
          className={cn('px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
            value === p
              ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
              : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

function CollapsibleSection({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border/50 hover:bg-surface-elevated/40 transition-colors">
        <span className="text-sm font-semibold text-ink-primary">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-ink-muted" /> : <ChevronRight className="w-4 h-4 text-ink-muted" />}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function PnlCell({ value, pct }: { value: number; pct?: number }) {
  const pos = value >= 0
  return (
    <span className={pos ? 'text-gain font-semibold' : 'text-loss font-semibold'}>
      {fmtPnl(value)}{pct !== undefined && <span className="ml-1 text-[10px] opacity-75">{fmtPct(pct)}</span>}
    </span>
  )
}

// ── Refresh progress modal (self-contained — runs refresh in useEffect) ─────────

type StepStatus = 'pending' | 'running' | 'done' | 'error'

function StepRow({ icon: Icon, label, detail, status }: {
  icon: React.ElementType; label: string; detail?: string; status: StepStatus
}) {
  return (
    <div className={cn(
      'flex items-start gap-3 py-2.5 px-3 rounded-lg',
      status === 'running' && 'bg-brand-500/8 border border-brand-500/20',
      status === 'error' && 'bg-loss/8 border border-loss/20',
    )}>
      <div className="mt-0.5 shrink-0 w-4">
        {status === 'pending' && <Icon className="w-4 h-4 text-ink-disabled" />}
        {status === 'running' && <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />}
        {status === 'done'    && <CheckCircle2 className="w-4 h-4 text-gain" />}
        {status === 'error'   && <XCircle className="w-4 h-4 text-loss" />}
      </div>
      <div className="min-w-0">
        <p className={cn('text-sm font-medium leading-tight',
          status === 'pending' ? 'text-ink-disabled' :
          status === 'error'   ? 'text-loss' : 'text-ink-primary')}>{label}</p>
        {detail && <p className="text-xs font-mono text-ink-muted mt-0.5 break-all leading-snug">{detail}</p>}
      </div>
    </div>
  )
}

function RefreshModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'copying' | 'reloading' | 'done' | 'error'>('copying')
  const [info, setInfo] = useState<{ source: string; destination: string; source_size_kb: number; destination_size_kb: number; synced_rows?: number } | null>(null)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await portfolioTrackerService.refresh()
        if (cancelled) return
        setInfo(res)
        setPhase('reloading')
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['portfolio-positions'] }),
          queryClient.refetchQueries({ queryKey: ['portfolio-performance'] }),
          queryClient.refetchQueries({ queryKey: ['portfolio-by-date'] }),
          queryClient.refetchQueries({ queryKey: ['portfolio-by-stock'] }),
          queryClient.refetchQueries({ queryKey: ['portfolio-summary'] }),
        ])
        if (!cancelled) setPhase('done')
      } catch (e: any) {
        if (!cancelled) {
          setErrMsg(e?.response?.data?.detail ?? e?.message ?? 'Refresh failed')
          setPhase('error')
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const steps: { icon: React.ElementType; label: string; detail?: string; status: StepStatus }[] = [
    {
      icon: FileText, label: 'Reading source file',
      detail: info ? `${info.source}  (${info.source_size_kb} KB)` : phase === 'error' ? errMsg : undefined,
      status: phase === 'copying' ? 'running' : phase === 'error' ? 'error' : 'done',
    },
    {
      icon: Copy, label: 'Copying to working location',
      detail: info ? `→ ${info.destination}  (${info.destination_size_kb} KB)` : undefined,
      status: phase === 'copying' ? 'running' : phase === 'error' ? 'error' : 'done',
    },
    {
      icon: Trash2, label: 'Clearing cache (all workers)',
      detail: (phase === 'reloading' || phase === 'done') ? 'Cache bust file written' : undefined,
      status: phase === 'copying' ? 'running' : phase === 'error' ? 'error' : 'done',
    },
    {
      icon: Database, label: 'Syncing to database',
      detail: info?.synced_rows != null ? `${info.synced_rows} rows written to portfolio_positions_db` : undefined,
      status: phase === 'copying' ? 'running' : phase === 'error' ? 'error' : 'done',
    },
    {
      icon: RotateCcw, label: 'Reloading portfolio data',
      detail: phase === 'done' ? 'Positions · Performance · By Date · By Stock' : undefined,
      status: phase === 'reloading' ? 'running' : phase === 'done' ? 'done' : 'pending',
    },
  ]

  const canClose = phase === 'done' || phase === 'error'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
         onClick={canClose ? onClose : undefined}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <RefreshCw className={cn('w-4 h-4 shrink-0',
              phase === 'copying' || phase === 'reloading' ? 'text-brand-400 animate-spin' :
              phase === 'done' ? 'text-gain' : 'text-loss')} />
            <h2 className="text-sm font-semibold text-ink-primary">
              {phase === 'done' ? 'Refresh Complete' : phase === 'error' ? 'Refresh Failed' : 'Refreshing Data…'}
            </h2>
          </div>
          {canClose && <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>}
        </div>

        {/* Steps */}
        <div className="p-4 space-y-1.5">
          {steps.map((s, i) => <StepRow key={i} {...s} />)}
        </div>

        {/* Footer */}
        {phase === 'done' && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gain/8 border border-gain/20 text-gain text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Charts and tables are now up to date.
            </div>
          </div>
        )}
        {phase === 'error' && (
          <div className="px-4 pb-4 space-y-2">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-loss/8 border border-loss/20 text-loss text-xs">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{errMsg}</span>
            </div>
            <p className="text-[11px] text-ink-muted">
              Go to <strong className="text-ink-secondary">Settings → App Configuration</strong> and verify the Source File Path is correct.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Raw data viewer modal ──────────────────────────────────────────────────────

function RawDataModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['raw-excel-data'],
    queryFn: () => portfolioTrackerService.getRawData(),
    staleTime: 30_000,
    retry: 1,
  })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
         onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Table2 className="w-4 h-4 text-brand-400" />
            <div>
              <h2 className="text-sm font-semibold text-ink-primary">Raw Excel Data</h2>
              {data && (
                <p className="text-[11px] text-ink-muted mt-0.5 font-mono">{data.file} — {data.total} rows</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-full gap-2 text-ink-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Excel data…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <XCircle className="w-8 h-8 text-loss mx-auto" />
                <p className="text-sm text-loss">Failed to load Excel file.</p>
                <p className="text-xs text-ink-muted">Make sure the working copy exists. Press Refresh first if needed.</p>
              </div>
            </div>
          )}
          {data && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-card">
                <tr className="border-b border-border/60">
                  <th className="px-2.5 py-2 text-left font-medium text-ink-disabled whitespace-nowrap border-r border-border/30">#</th>
                  {data.columns.map((col, i) => (
                    <th key={i} className="px-2.5 py-2 text-left font-medium text-ink-muted whitespace-nowrap border-r border-border/20 last:border-r-0">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr key={ri} className={cn('border-b border-border/20 hover:bg-surface-elevated/50 transition-colors',
                    ri % 2 === 1 && 'bg-surface-elevated/20')}>
                    <td className="px-2.5 py-1.5 text-ink-disabled border-r border-border/20 tabular-nums">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 text-ink-secondary border-r border-border/15 last:border-r-0 whitespace-nowrap max-w-[200px] truncate"
                          title={cell != null ? String(cell) : ''}>
                        {cell != null ? String(cell) : <span className="text-ink-disabled">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Raw source data viewer modal ───────────────────────────────────────────────

function RawSourceDataModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['raw-source-data'],
    queryFn: () => portfolioTrackerService.getRawSourceData(),
    staleTime: 0,
    retry: 1,
  })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
         onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-ink-primary">Raw Source Data</h2>
              {data && (
                <p className="text-[11px] text-ink-muted mt-0.5 font-mono">{data.file} — {data.total} rows</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-full gap-2 text-ink-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading source file…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <XCircle className="w-8 h-8 text-loss mx-auto" />
                <p className="text-sm text-loss">Failed to read source file.</p>
                <p className="text-xs text-ink-muted">Check that the source path is mounted correctly in docker-compose.</p>
              </div>
            </div>
          )}
          {data && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-card">
                <tr className="border-b border-border/60">
                  <th className="px-2.5 py-2 text-left font-medium text-ink-disabled whitespace-nowrap border-r border-border/30">#</th>
                  {data.columns.map((col, i) => (
                    <th key={i} className="px-2.5 py-2 text-left font-medium text-ink-muted whitespace-nowrap border-r border-border/20 last:border-r-0">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr key={ri} className={cn('border-b border-border/20 hover:bg-surface-elevated/50 transition-colors',
                    ri % 2 === 1 && 'bg-surface-elevated/20')}>
                    <td className="px-2.5 py-1.5 text-ink-disabled border-r border-border/20 tabular-nums">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 text-ink-secondary border-r border-border/15 last:border-r-0 whitespace-nowrap max-w-[200px] truncate"
                          title={cell != null ? String(cell) : ''}>
                        {cell != null ? String(cell) : <span className="text-ink-disabled">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Transaction drill-down modal ───────────────────────────────────────────────

interface DrillDown {
  periodKey: string
  label: string
  period: Period
  fromDate: string
  toDate: string
}

function TransactionModal({ drill, onClose, onSymbolClick }: { drill: DrillDown; onClose: () => void; onSymbolClick: (s: string) => void }) {
  const { data: txns = [], isLoading } = useQuery<PeriodTransaction[]>({
    queryKey: ['period-transactions', drill.periodKey, drill.period],
    queryFn: () => portfolioTrackerService.getTransactions({
      period_key: drill.periodKey,
      period: drill.period,
      from_date: drill.fromDate,
      to_date: drill.toDate,
    }),
    staleTime: 60_000,
  })

  const totalPnl = txns.reduce((s, t) => s + t.netPnl, 0)
  const wins = txns.filter(t => t.netPnl > 0).length
  const losses = txns.filter(t => t.netPnl <= 0).length

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="modal"
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.18 }}
          className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-ink-primary">Transactions — {drill.label}</h2>
              <p className="text-[11px] text-ink-muted mt-0.5">
                {txns.length} trade{txns.length !== 1 ? 's' : ''} ·{' '}
                <span className="text-gain">{wins}W</span>{' '}
                <span className="text-loss">{losses}L</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
              {txns.length > 0 && (
                <div className="text-right">
                  <p className="text-[10px] text-ink-muted">Net P&L</p>
                  <p className={cn('text-sm font-bold', totalPnl >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtPnl(totalPnl)} THB
                  </p>
                </div>
              )}
              <button onClick={onClose} className="btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-auto flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-ink-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading transactions…
              </div>
            ) : txns.length === 0 ? (
              <p className="text-center text-ink-muted text-sm py-16">No transactions found for this period.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-card z-10">
                  <tr className="border-b border-border/50 text-ink-muted">
                    {['Symbol', 'Dir', 'Entry Date', 'Exit Date', 'Entry ฿', 'Exit ฿', 'Size', 'Net P&L', 'P&L %', 'Remarks'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t, i) => (
                    <tr key={i} className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => onSymbolClick(t.symbol)}
                          className="font-semibold text-ink-primary hover:text-brand-400 transition-colors"
                          title={`Analytics: ${t.symbol}`}
                        >{t.symbol}</button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-medium', t.direction.toLowerCase().includes('short') ? 'text-loss' : 'text-gain')}>
                          {t.direction.toLowerCase().includes('short') ? '↓ S' : '↑ L'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">{t.entryDate ?? '—'}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{t.exitDate}</td>
                      <td className="px-3 py-2.5 text-ink-secondary tabular-nums">{fmt(t.entryPrice)}</td>
                      <td className="px-3 py-2.5 text-ink-primary font-medium tabular-nums">{fmt(t.exitPrice)}</td>
                      <td className="px-3 py-2.5 text-ink-secondary tabular-nums">{t.positionSize.toLocaleString()}</td>
                      <td className="px-3 py-2.5"><PnlCell value={t.netPnl} /></td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-medium tabular-nums', t.pnlPct >= 0 ? 'text-gain' : 'text-loss')}>
                          {fmtPct(t.pnlPct)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted max-w-[160px] truncate" title={t.remarks ?? ''}>
                        {t.remarks ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/50 bg-surface-elevated/40">
                    <td colSpan={7} className="px-3 py-2.5 font-semibold text-ink-secondary text-right">Total</td>
                    <td className="px-3 py-2.5"><PnlCell value={totalPnl} /></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Section 1: Positions Table ─────────────────────────────────────────────────

function PositionsTable({ positions, total, totalPnl, loading, onSymbolClick }: {
  positions: Position[]; total: number; totalPnl: number; loading: boolean; onSymbolClick: (s: string) => void
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">
          Positions <span className="text-ink-muted font-normal ml-1">({total})</span>
        </h2>
        {loading && <span className="text-xs text-ink-muted">Loading…</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-ink-muted">
              {['Symbol', 'Dir', 'Entry Date', 'Entry Price', 'Current', 'Size', 'Net P&L', 'SL', 'TP', 'Status'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && !loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-muted">No positions found.</td></tr>
            ) : positions.map(pos => (
              <tr key={pos.id} className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors">
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => onSymbolClick(pos.symbol)}
                    className="font-semibold text-ink-primary hover:text-brand-400 transition-colors"
                    title={`Analytics: ${pos.symbol}`}
                  >{pos.symbol}</button>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('font-medium', pos.direction.toLowerCase().includes('short') ? 'text-loss' : 'text-gain')}>
                    {pos.direction.toLowerCase().includes('short') ? '↓ S' : '↑ L'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-ink-secondary">{pos.entryDate ?? '—'}</td>
                <td className="px-3 py-2.5 text-ink-secondary">{fmt(pos.entryPrice)}</td>
                <td className="px-3 py-2.5 text-ink-primary font-medium">{fmt(pos.currentPrice)}</td>
                <td className="px-3 py-2.5 text-ink-secondary">{pos.positionSize.toLocaleString()}</td>
                <td className="px-3 py-2.5"><PnlCell value={pos.netPnl} pct={pos.pnlPct} /></td>
                <td className="px-3 py-2.5 text-ink-muted">{pos.sl != null ? fmt(pos.sl) : '—'}</td>
                <td className="px-3 py-2.5 text-ink-muted">{pos.tp != null ? fmt(pos.tp) : '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold',
                    pos.status === 'active' ? 'bg-gain/15 text-gain' : 'bg-ink-muted/20 text-ink-muted')}>
                    {pos.status === 'active' ? 'OPEN' : 'CLOSED'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          {positions.length > 0 && (
            <tfoot>
              <tr className="border-t border-border/50 bg-surface-elevated/30">
                <td colSpan={6} className="px-3 py-2.5 font-semibold text-ink-secondary text-right">Total</td>
                <td className="px-3 py-2.5"><PnlCell value={totalPnl} /></td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ── Section 2a: Performance Summary stats ─────────────────────────────────────

function PerformanceSummary({ data }: {
  data: { accumulated_pnl: number; win_rate: number; avg_pnl: number; avg_pnl_pct: number; total_trades: number; wins: number; losses: number } | undefined
}) {
  const stats = [
    {
      label: 'Accumulated P&L',
      value: data ? fmtPnl(data.accumulated_pnl) : '—',
      color: data ? (data.accumulated_pnl >= 0 ? 'text-gain' : 'text-loss') : 'text-ink-muted',
    },
    {
      label: 'Win Rate',
      value: data ? `${data.win_rate}%` : '—',
      sub: data ? `${data.wins}W / ${data.losses}L / ${data.total_trades}T` : undefined,
      color: data ? (data.win_rate >= 50 ? 'text-gain' : 'text-loss') : 'text-ink-muted',
    },
    {
      label: 'Avg P&L / Trade',
      value: data ? fmtPnl(data.avg_pnl) : '—',
      color: data ? (data.avg_pnl >= 0 ? 'text-gain' : 'text-loss') : 'text-ink-muted',
    },
    {
      label: 'Avg %P&L / Trade',
      value: data ? `${data.avg_pnl_pct >= 0 ? '+' : ''}${data.avg_pnl_pct.toFixed(2)}%` : '—',
      color: data ? (data.avg_pnl_pct >= 0 ? 'text-gain' : 'text-loss') : 'text-ink-muted',
    },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(s => (
        <div key={s.label} className="card p-3.5 flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted font-medium">{s.label}</span>
          <span className={cn('text-base font-bold tabular-nums', s.color)}>{s.value}</span>
          {s.sub && <span className="text-[10px] text-ink-disabled">{s.sub}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Section 2b: Performance Chart ─────────────────────────────────────────────

function PerformanceChart({ data, period, onPeriodChange, loading }: {
  data: { date: string; label: string; dailyPnl: number; cumulativePnl: number }[]
  period: Period
  onPeriodChange: (p: Period) => void
  loading: boolean
}) {
  const option = useMemo(() => {
    const labels = data.map(p => p.label)
    const cumPnl = data.map(p => p.cumulativePnl)
    const dayPnl = data.map(p => p.dailyPnl)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params: any[]) => {
          const lbl = params[0]?.axisValue ?? ''
          let html = `<div style="font-weight:600;margin-bottom:4px">${lbl}</div>`
          params.forEach((p: any) => {
            const sign = p.value >= 0 ? '+' : ''
            html += `<div style="color:${p.color}">${p.seriesName}: ${sign}${Number(p.value).toLocaleString()} THB</div>`
          })
          return html
        },
      },
      legend: { data: ['Cumulative P&L', `${period.charAt(0).toUpperCase() + period.slice(1)} P&L`], textStyle: { color: '#94a3b8', fontSize: 11 }, top: 4 },
      grid: { left: '2%', right: '2%', bottom: '3%', top: '44px', containLabel: true },
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'THB', nameTextStyle: { color: '#64748b', fontSize: 10 },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => v.toLocaleString() },
          axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e293b' } } },
        { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Cumulative P&L', type: 'line', data: cumPnl, smooth: true,
          lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.18)' }, { offset: 1, color: 'rgba(34,197,94,0)' }] } },
          symbol: 'none',
        },
        {
          name: `${period.charAt(0).toUpperCase() + period.slice(1)} P&L`, type: 'bar', yAxisIndex: 1,
          data: dayPnl.map((v: number) => ({ value: v, itemStyle: { color: v >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)' } })),
          barMaxWidth: 10,
        },
      ],
    }
  }, [data, period])

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink-primary">Performance History</h2>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-ink-muted text-sm">Loading chart…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-ink-muted text-sm">No data for the selected period.</div>
      ) : (
        <ReactECharts option={option} style={{ height: 256 }} notMerge />
      )}
    </div>
  )
}

// ── Investment Balance Chart ───────────────────────────────────────────────────

function InvestmentBalanceChart({
  data,
  loading,
  period,
  onPeriodChange,
}: {
  data: Array<{ label: string; netInvested: number; portfolioValue: number; cumulativePnl: number }>
  loading: boolean
  period: Period
  onPeriodChange: (p: Period) => void
}) {
  const option = useMemo(() => {
    if (!data.length) return {}
    const labels    = data.map(d => d.label)
    const invested  = data.map(d => d.netInvested)
    const portValue = data.map(d => d.portfolioValue)

    const allVals = [...invested, ...portValue].filter(isFinite)
    const minVal  = Math.min(...allVals)
    const maxVal  = Math.max(...allVals)
    const range   = maxVal - minVal || 1
    const yMin    = minVal - range * 0.12
    const yMax    = maxVal + range * 0.06

    const fmtAxis = (v: number) =>
      Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : Math.abs(v) >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
      : String(v)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params: any[]) => {
          const lbl = params[0]?.axisValue ?? ''
          const inv = (params.find((p: any) => p.seriesName === 'Net Invested')?.value as number) ?? 0
          const val = (params.find((p: any) => p.seriesName === 'Portfolio Value')?.value as number) ?? 0
          const pnl = val - inv
          const pnlColor = pnl >= 0 ? '#22c55e' : '#ef4444'
          const sign = (n: number) => n >= 0 ? '+' : ''
          return `<div style="font-weight:600;margin-bottom:4px">${lbl}</div>
<div style="color:#8b5cf6">Net Invested: ${Number(inv).toLocaleString()} THB</div>
<div style="color:#22d3ee">Portfolio Value: ${Number(val).toLocaleString()} THB</div>
<div style="color:${pnlColor}">P&amp;L: ${sign(pnl)}${Number(pnl).toLocaleString()} THB</div>`
        },
      },
      legend: { data: ['Net Invested', 'Portfolio Value'], textStyle: { color: '#94a3b8', fontSize: 11 }, top: 4 },
      grid: { left: '2%', right: '2%', bottom: '3%', top: '44px', containLabel: true },
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10, rotate: labels.length > 12 ? 30 : 0 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: yMin, max: yMax,
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: fmtAxis },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: 'Net Invested', type: 'line', data: invested, smooth: true, symbol: 'none',
          lineStyle: { color: '#8b5cf6', width: 2 },
          itemStyle: { color: '#8b5cf6' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(139,92,246,0.28)' }, { offset: 1, color: 'rgba(139,92,246,0)' }] } },
        },
        {
          name: 'Portfolio Value', type: 'line', data: portValue, smooth: true, symbol: 'none',
          lineStyle: { color: '#22d3ee', width: 2.5 },
          itemStyle: { color: '#22d3ee' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,211,238,0.18)' }, { offset: 1, color: 'rgba(34,211,238,0)' }] } },
        },
      ],
    }
  }, [data])

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-primary">Investment Balance</h2>
          <p className="text-xs text-ink-muted mt-0.5">Cumulative invested capital vs. estimated portfolio value</p>
        </div>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-ink-muted text-sm">Loading chart…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-ink-muted text-sm">
          No data — add investment transactions or select a date range with performance data.
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 256 }} notMerge />
      )}
    </div>
  )
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortKey, dir }: { col: string; sortKey: string; dir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="w-3 h-3 ml-1 inline-block opacity-30" />
  return dir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-1 inline-block text-brand-400" />
    : <ArrowDown className="w-3 h-3 ml-1 inline-block text-brand-400" />
}

// ── Section 3: Performance by Date table ──────────────────────────────────────

function PerformanceByDateTable({ data, period, onRowClick }: {
  data: { period: string; label: string; net: number; accumulatedPnl?: number; wins: number; losses: number; total: number; winRate: number }[]
  period: Period
  onRowClick: (periodKey: string, label: string) => void
}) {
  const [sortKey, setSortKey] = useState<string>('period')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const onSort = (col: string) => {
    if (col === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const d = [...data]
    d.sort((a, b) => {
      let av: any, bv: any
      if (sortKey === 'period') { av = a.period; bv = b.period }
      else if (sortKey === 'net') { av = a.net; bv = b.net }
      else if (sortKey === 'accumulatedPnl') { av = a.accumulatedPnl ?? 0; bv = b.accumulatedPnl ?? 0 }
      else if (sortKey === 'wins') { av = a.wins; bv = b.wins }
      else if (sortKey === 'losses') { av = a.losses; bv = b.losses }
      else if (sortKey === 'total') { av = a.total; bv = b.total }
      else if (sortKey === 'winRate') { av = a.winRate; bv = b.winRate }
      else { av = 0; bv = 0 }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
    return d
  }, [data, sortKey, sortDir])

  const Th = ({ col, label }: { col: string; label: string }) => (
    <th onClick={() => onSort(col)}
        className="px-3 py-2.5 text-left font-medium whitespace-nowrap cursor-pointer select-none hover:text-ink-primary transition-colors">
      {label}<SortIcon col={col} sortKey={sortKey} dir={sortDir} />
    </th>
  )

  return (
    <CollapsibleSection title={`Performance by ${period.charAt(0).toUpperCase() + period.slice(1)}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-ink-muted">
              <Th col="period" label="Period" />
              <Th col="net" label="Net P&L" />
              <Th col="accumulatedPnl" label="Accumulated P&L" />
              <Th col="wins" label="Wins" />
              <Th col="losses" label="Losses" />
              <Th col="total" label="Total" />
              <Th col="winRate" label="Win Rate" />
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No data.</td></tr>
            ) : sorted.map(row => (
              <tr
                key={row.period}
                onClick={() => onRowClick(row.period, row.label)}
                className="border-b border-border/30 hover:bg-surface-elevated/60 transition-colors cursor-pointer group"
              >
                <td className="px-3 py-2 text-ink-secondary font-medium">{row.label}</td>
                <td className="px-3 py-2"><PnlCell value={row.net} /></td>
                <td className="px-3 py-2">
                  {row.accumulatedPnl !== undefined
                    ? <PnlCell value={row.accumulatedPnl} />
                    : <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-3 py-2 text-gain">{row.wins}</td>
                <td className="px-3 py-2 text-loss">{row.losses}</td>
                <td className="px-3 py-2 text-ink-secondary">{row.total}</td>
                <td className="px-3 py-2">
                  <span className={cn('font-medium', row.winRate >= 50 ? 'text-gain' : 'text-loss')}>{row.winRate}%</span>
                </td>
                <td className="px-3 py-2 text-ink-disabled group-hover:text-brand-400 transition-colors text-right">
                  <ChevronRight className="w-3.5 h-3.5 inline-block" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}

// ── Section 4: Performance by Stock table ─────────────────────────────────────

function PerformanceByStockTable({ data }: {
  data: { symbol: string; net: number; investment: number; currentValue: number; pnlPct: number; wins: number; losses: number; total: number; winRate: number }[]
}) {
  const [sortKey, setSortKey] = useState<string>('net')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const onSort = (col: string) => {
    if (col === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const d = [...data]
    d.sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0
      const bv = (b as any)[sortKey] ?? 0
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return d
  }, [data, sortKey, sortDir])

  const Th = ({ col, label }: { col: string; label: string }) => (
    <th onClick={() => onSort(col)}
        className="px-3 py-2.5 text-left font-medium whitespace-nowrap cursor-pointer select-none hover:text-ink-primary transition-colors">
      {label}<SortIcon col={col} sortKey={sortKey} dir={sortDir} />
    </th>
  )

  return (
    <CollapsibleSection title="Performance by Stock — Detail">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-ink-muted">
              <Th col="symbol" label="Symbol" />
              <Th col="investment" label="Investment" />
              <Th col="currentValue" label="Current Value" />
              <Th col="net" label="Net P&L" />
              <Th col="pnlPct" label="P&L %" />
              <Th col="wins" label="Wins" />
              <Th col="losses" label="Losses" />
              <Th col="winRate" label="Win Rate" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No data.</td></tr>
            ) : sorted.map(row => (
              <tr key={row.symbol} className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors">
                <td className="px-3 py-2 font-semibold text-ink-primary">{row.symbol}</td>
                <td className="px-3 py-2 text-ink-secondary tabular-nums">{fmt(row.investment, 0)}</td>
                <td className="px-3 py-2 text-ink-primary font-medium tabular-nums">{fmt(row.currentValue, 0)}</td>
                <td className="px-3 py-2"><PnlCell value={row.net} /></td>
                <td className="px-3 py-2">
                  <span className={cn('font-semibold tabular-nums', row.pnlPct >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtPct(row.pnlPct)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gain">{row.wins}</td>
                <td className="px-3 py-2 text-loss">{row.losses}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium', row.winRate >= 50 ? 'text-gain' : 'text-loss')}>{row.winRate}%</span>
                    <div className="w-16 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500/60 rounded-full" style={{ width: `${row.winRate}%` }} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}

// ── Investment tab helpers ─────────────────────────────────────────────────────

function fmtThb(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayIso() { return format(new Date(), 'yyyy-MM-dd') }

function ActionBadge({ action }: { action: InvestmentAction }) {
  const meta = INVESTMENT_ACTIONS.find(a => a.value === action)!
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
      action === 'CASH_IN'  && 'bg-gain/10 text-gain border-gain/20',
      action === 'CASH_OUT' && 'bg-loss/10 text-loss border-loss/20',
      action === 'ADJUST'   && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    )}>
      {meta.label}
    </span>
  )
}

interface TxFormProps {
  portfolioId: string
  initial?: InvestmentTransaction | null
  onClose: () => void
  onSaved: () => void
}

function TransactionForm({ portfolioId, initial, onClose, onSaved }: TxFormProps) {
  const [date, setDate]         = useState(initial?.date ?? todayIso())
  const [action, setAction]     = useState<InvestmentAction>(initial?.action ?? 'CASH_IN')
  const [amount, setAmount]     = useState(initial ? String(initial.amount) : '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'THB')
  const [note, setNote]         = useState(initial?.note ?? '')
  const [saving, setSaving]     = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { toast.error('Amount must be a positive number'); return }
    setSaving(true)
    try {
      if (initial) {
        await investmentTransactionService.update(initial.id, { date, action, amount: amt, currency, note: note || null })
      } else {
        await investmentTransactionService.create({ portfolio_id: portfolioId, date, action, amount: amt, currency, note: note || null })
      }
      toast.success(initial ? 'Transaction updated' : 'Transaction added')
      onSaved()
    } catch { toast.error('Failed to save transaction') }
    finally { setSaving(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="card p-5 border border-brand-500/20 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">{initial ? 'Edit Transaction' : 'New Transaction'}</h3>
        <button onClick={onClose} className="text-ink-muted hover:text-ink-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Date</label>
            <input type="date" className="input text-sm w-full" value={date} onChange={e => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Action</label>
            <div className="flex gap-1">
              {INVESTMENT_ACTIONS.map(a => (
                <button key={a.value} type="button" onClick={() => setAction(a.value)}
                  className={cn(
                    'flex-1 py-2 text-[11px] font-medium rounded-lg border transition-colors',
                    action === a.value
                      ? a.value === 'CASH_IN'  ? 'bg-gain/15 text-gain border-gain/30'
                        : a.value === 'CASH_OUT' ? 'bg-loss/15 text-loss border-loss/30'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      : 'border-border text-ink-muted hover:text-ink-primary',
                  )}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Amount</label>
            <input type="number" step="0.01" min="0.01" className="input text-sm w-full"
              value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Currency</label>
            <select className="input text-sm w-full" value={currency} onChange={e => setCurrency(e.target.value)}>
              {['THB', 'USD', 'HKD', 'BTC'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-secondary">Note <span className="text-ink-disabled">(optional)</span></label>
          <input className="input text-sm w-full" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Monthly contribution" />
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-sm text-ink-muted border border-border rounded-lg hover:text-ink-primary transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="btn-primary flex items-center gap-2 px-4 py-1.5 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {initial ? 'Update' : 'Add'}
          </button>
        </div>
      </form>
    </motion.div>
  )
}

function InvestmentTab({ portfolioId }: { portfolioId: string }) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm]     = useState(false)
  const [editTx,   setEditTx]       = useState<InvestmentTransaction | null>(null)
  const [filterAction, setFilterAction] = useState<InvestmentAction | ''>('')
  const [deleting, setDeleting]     = useState<string | null>(null)

  const { data: txData, isLoading } = useQuery({
    queryKey: ['investment-transactions', portfolioId, filterAction],
    queryFn: () => investmentTransactionService.list({ portfolio_id: portfolioId, action: filterAction || undefined }),
    enabled: !!portfolioId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['investment-transactions'] })
    setShowForm(false); setEditTx(null)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    setDeleting(id)
    try { await investmentTransactionService.delete(id); toast.success('Deleted'); invalidate() }
    catch { toast.error('Failed to delete') }
    finally { setDeleting(null) }
  }

  const transactions = txData?.transactions ?? []
  const summary = txData?.summary

  return (
    <div className="space-y-4 pt-2">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Cash In',        value: summary.total_cash_in,    color: 'text-gain' },
            { label: 'Cash Out',       value: summary.total_cash_out,   color: 'text-loss' },
            { label: 'Adjustments',    value: summary.total_adjust,     color: 'text-amber-400' },
            { label: 'Net Investment', value: summary.net_investment,   color: summary.net_investment >= 0 ? 'text-brand-400' : 'text-loss' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4">
              <p className="text-xs text-ink-muted mb-1">{label}</p>
              <p className={cn('text-lg font-bold font-mono', color)}>{fmtThb(value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-muted">Filter:</span>
          {(['', 'CASH_IN', 'CASH_OUT', 'ADJUST'] as const).map(a => (
            <button key={a} onClick={() => setFilterAction(a)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-lg border transition-colors',
                filterAction === a
                  ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                  : 'border-border text-ink-muted hover:text-ink-primary',
              )}>
              {a === '' ? 'All' : INVESTMENT_ACTIONS.find(x => x.value === a)?.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditTx(null); setShowForm(s => !s) }}
          className="btn-primary flex items-center gap-1.5 px-4 py-1.5 text-sm">
          <Plus className="w-4 h-4" /> Add Transaction
        </button>
      </div>

      {/* Form */}
      <AnimatePresence>
        {(showForm || editTx) && (
          <TransactionForm key={editTx?.id ?? 'new'} portfolioId={portfolioId}
            initial={editTx} onClose={() => { setShowForm(false); setEditTx(null) }} onSaved={invalidate} />
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading transactions…
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No transactions yet.{' '}
            <button onClick={() => setShowForm(true)} className="text-brand-400 hover:underline">Add your first one.</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs text-ink-muted">
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">CCY</th>
                <th className="text-left px-4 py-3 font-medium">Note</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {transactions.map(tx => (
                <tr key={tx.id} className="hover:bg-surface-elevated/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{tx.date}</td>
                  <td className="px-4 py-3"><ActionBadge action={tx.action} /></td>
                  <td className={cn('px-4 py-3 text-right font-mono font-semibold text-xs',
                    tx.action === 'CASH_IN' ? 'text-gain' : tx.action === 'CASH_OUT' ? 'text-loss' : 'text-amber-400')}>
                    {fmtThb(tx.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{tx.currency}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted max-w-[200px] truncate">
                    {tx.note ?? <span className="text-ink-disabled">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { setEditTx(tx); setShowForm(false) }}
                        className="p-1.5 rounded text-ink-disabled hover:text-brand-400 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(tx.id)} disabled={deleting === tx.id}
                        className="p-1.5 rounded text-ink-disabled hover:text-loss transition-colors disabled:opacity-40">
                        {deleting === tx.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {transactions.length > 0 && (
        <p className="text-xs text-ink-disabled text-right">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</p>
      )}
    </div>
  )
}

// ── Portfolio dropdown ─────────────────────────────────────────────────────────

function PortfolioDropdown({
  portfolios, selected, onChange,
}: {
  portfolios: UserPortfolio[]; selected: string | null; onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = portfolios.find(p => p.id === selected) ?? portfolios.find(p => p.is_default) ?? portfolios[0]
  if (!current) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-elevated
                   text-sm font-medium text-ink-primary hover:border-brand-500/50 transition-colors"
      >
        <Wallet className="w-3.5 h-3.5 text-brand-400" />
        {current.name}
        {current.is_default && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/15 text-brand-400 font-bold">DEFAULT</span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full mt-1 min-w-[180px] bg-surface-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            onMouseLeave={() => setOpen(false)}
          >
            {portfolios.map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-surface-elevated transition-colors',
                  p.id === current.id && 'bg-brand-500/8 text-brand-400',
                )}
              >
                {p.name}
                {p.is_default && <span className="ml-auto text-[9px] text-brand-400 font-bold">DEFAULT</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const queryClient = useQueryClient()
  const saved = loadCriteria()
  const [fromDate, setFromDate] = useState(saved?.fromDate ?? defaultFromDate())
  const [toDate, setToDate] = useState(todayStr())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(saved?.statusFilter ?? 'active')
  const [period, setPeriod] = useState<Period>('daily')
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
  const [showRefresh, setShowRefresh] = useState(false)
  const [showRawData, setShowRawData] = useState(false)
  const [showRawSourceData, setShowRawSourceData] = useState(false)
  const [analyticsSymbol, setAnalyticsSymbol] = useState<string | null>(null)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'investment'>('overview')

  // Load portfolios
  const { data: portfolios = [] } = useQuery({
    queryKey: ['portfolios'],
    queryFn: portfolioService.list,
    staleTime: 60_000,
  })

  // Auto-select default
  useEffect(() => {
    if (!selectedPortfolioId && portfolios.length > 0) {
      const def = portfolios.find(p => p.is_default) ?? portfolios[0]
      setSelectedPortfolioId(def.id)
    }
  }, [portfolios, selectedPortfolioId])

  const portfolioId = selectedPortfolioId ?? portfolios.find(p => p.is_default)?.id ?? portfolios[0]?.id

  // Persist criteria on change
  useEffect(() => { saveCriteria(fromDate, toDate, statusFilter) }, [fromDate, toDate, statusFilter])

  const params = { from_date: fromDate, to_date: toDate, portfolio_id: portfolioId }

  const posQuery = useQuery({
    queryKey: ['portfolio-positions', fromDate, toDate, statusFilter, portfolioId],
    queryFn: () => portfolioTrackerService.getPositions({ ...params, status: statusFilter }),
    refetchInterval: 60_000,
    enabled: !!portfolioId,
  })

  const perfQuery = useQuery({
    queryKey: ['portfolio-performance', fromDate, toDate, period, portfolioId],
    queryFn: () => portfolioTrackerService.getPerformance({ ...params, period }),
    refetchInterval: 60_000,
    enabled: !!portfolioId,
  })

  const byDateQuery = useQuery({
    queryKey: ['portfolio-by-date', fromDate, toDate, period, portfolioId],
    queryFn: () => portfolioTrackerService.getPerformanceByDate({ ...params, period }),
    refetchInterval: 60_000,
    enabled: !!portfolioId,
  })

  const byStockQuery = useQuery({
    queryKey: ['portfolio-by-stock', fromDate, toDate, portfolioId],
    queryFn: () => portfolioTrackerService.getPerformanceByStock(params),
    refetchInterval: 60_000,
    enabled: !!portfolioId,
  })

  const summaryQuery = useQuery({
    queryKey: ['portfolio-summary', fromDate, toDate, portfolioId],
    queryFn: () => portfolioTrackerService.getSummary(params),
    refetchInterval: 60_000,
    enabled: !!portfolioId,
  })

  const allTxQuery = useQuery({
    queryKey: ['investment-transactions-balance', portfolioId],
    queryFn: () => investmentTransactionService.list({ portfolio_id: portfolioId }),
    staleTime: 120_000,
    enabled: !!portfolioId,
  })

  const balanceData = useMemo(() => {
    const perfData = perfQuery.data ?? []
    const transactions = allTxQuery.data?.transactions ?? []
    if (!perfData.length) return []
    return perfData.map(p => {
      const netInvested = transactions
        .filter(tx => tx.date <= p.date)
        .reduce((sum, tx) => {
          if (tx.action === 'CASH_IN')  return sum + tx.amount
          if (tx.action === 'CASH_OUT') return sum - tx.amount
          if (tx.action === 'ADJUST')   return sum + tx.amount
          return sum
        }, 0)
      return {
        label: p.label,
        netInvested,
        cumulativePnl: p.cumulativePnl,
        portfolioValue: netInvested + p.cumulativePnl,
      }
    })
  }, [perfQuery.data, allTxQuery.data])

  const positions = posQuery.data?.positions ?? []
  const totalPnl = posQuery.data?.totalNetPnl ?? 0
  const totalPositions = posQuery.data?.total ?? 0
  const winCount = positions.filter(p => p.netPnl > 0).length
  const lossCount = positions.filter(p => p.netPnl <= 0).length
  const winRate = positions.length > 0 ? Math.round((winCount / positions.length) * 100) : 0
  const isLoading = posQuery.isLoading
  const hasError = posQuery.isError || perfQuery.isError

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">Portfolio</h1>
          <p className="text-xs text-ink-muted mt-0.5">Thai SET · Investment tracking</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {portfolios.length > 0 && (
            <PortfolioDropdown
              portfolios={portfolios}
              selected={portfolioId ?? null}
              onChange={setSelectedPortfolioId}
            />
          )}
          {activeTab === 'overview' && (
          <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRawSourceData(true)}
            className="btn-icon"
            title="View raw source Excel data (from mounted source path)"
          >
            <Database className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowRawData(true)}
            className="btn-icon"
            title="View raw Excel data (working copy)"
          >
            <Table2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowRefresh(true)}
            disabled={showRefresh}
            className="btn-icon"
            title="Copy Excel from source and refresh all data"
          >
            <RefreshCw className={cn('w-4 h-4', showRefresh && 'animate-spin')} />
          </button>
          </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50">
        {[
          { key: 'overview',   label: 'Portfolio Overview', icon: TrendingUp },
          { key: 'investment', label: 'Investment',          icon: Wallet },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key as 'overview' | 'investment')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === key
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-ink-muted hover:text-ink-primary',
            )}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Investment tab */}
      {activeTab === 'investment' && portfolioId && (
        <InvestmentTab portfolioId={portfolioId} />
      )}

      {/* Overview tab content */}
      {activeTab === 'overview' && <>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-ink-muted mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input text-sm py-1.5 px-2 w-36" />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">To</label>
          <div className="flex items-center gap-1.5">
            <input type="date" value={toDate} max={todayStr()} onChange={e => setToDate(e.target.value)} className="input text-sm py-1.5 px-2 w-36" />
            <button
              onClick={() => setToDate(todayStr())}
              disabled={toDate === todayStr()}
              title="Set to today"
              className={cn(
                'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap',
                toDate === todayStr()
                  ? 'text-ink-disabled border-border/40 cursor-default'
                  : 'text-brand-400 border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/20',
              )}
            >
              Today
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Status</label>
          <div className="flex gap-1">
            {(['active', 'all', 'closed'] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                  statusFilter === s
                    ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                    : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {hasError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load portfolio data. Check the Excel source path in Settings → App Configuration.
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Total P&L" value={`${fmtPnl(totalPnl)} THB`} positive={totalPnl >= 0} />
        <MetricCard label="Positions" value={String(totalPositions)} sub={`${positions.filter(p => p.status === 'active').length} open`} />
        <MetricCard label="Win Rate" value={`${winRate}%`} sub={`${winCount}W / ${lossCount}L`} positive={winRate >= 50} />
        <MetricCard label="Avg P&L" value={positions.length > 0 ? `${fmtPnl(Math.round(totalPnl / positions.length))} THB` : '—'} positive={totalPnl >= 0} />
      </div>

      {/* 1. Positions */}
      <PositionsTable positions={positions} total={totalPositions} totalPnl={totalPnl} loading={isLoading} onSymbolClick={setAnalyticsSymbol} />

      {/* 2a. Summary stats */}
      <PerformanceSummary data={summaryQuery.data} />

      {/* 2b. Investment Balance Chart */}
      <InvestmentBalanceChart
        data={balanceData}
        loading={perfQuery.isLoading || allTxQuery.isLoading}
        period={period}
        onPeriodChange={setPeriod}
      />

      {/* 2c. Daily Performance Chart */}
      <PerformanceChart data={perfQuery.data ?? []} period={period} onPeriodChange={setPeriod} loading={perfQuery.isLoading} />

      {/* 3. Performance by Date table */}
      <PerformanceByDateTable
        data={byDateQuery.data ?? []}
        period={period}
        onRowClick={(periodKey, label) =>
          setDrillDown({ periodKey, label, period, fromDate, toDate })
        }
      />

      {/* 4. Performance by Stock table */}
      <PerformanceByStockTable data={byStockQuery.data ?? []} />

      {/* Drill-down modal */}
      {drillDown && (
        <TransactionModal drill={drillDown} onClose={() => setDrillDown(null)} onSymbolClick={setAnalyticsSymbol} />
      )}

      {/* Refresh progress modal */}
      {showRefresh && <RefreshModal onClose={() => setShowRefresh(false)} />}

      {/* Raw data viewer modal */}
      {showRawData && <RawDataModal onClose={() => setShowRawData(false)} />}

      {/* Raw source data viewer modal */}
      {showRawSourceData && <RawSourceDataModal onClose={() => setShowRawSourceData(false)} />}

      </>}

      {/* Analytics modal — always mounted */}
      <AnimatePresence>
        {analyticsSymbol && (
          <AnalyticsModal
            symbol={analyticsSymbol}
            assetType="SET"
            onClose={() => setAnalyticsSymbol(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
