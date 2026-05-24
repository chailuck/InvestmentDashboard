'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { format, subMonths } from 'date-fns'
import { RefreshCw, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  portfolioTrackerService,
  type Position,
  type Period,
  type StatusFilter,
} from '@/services/portfolioTracker'

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

// ── Section 1: Positions Table ─────────────────────────────────────────────────

function PositionsTable({ positions, total, totalPnl, loading }: {
  positions: Position[]; total: number; totalPnl: number; loading: boolean
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
                <td className="px-3 py-2.5 font-semibold text-ink-primary">{pos.symbol}</td>
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

// ── Section 2: Performance Chart ───────────────────────────────────────────────

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

// ── Section 3: Performance by Date table ──────────────────────────────────────

function PerformanceByDateTable({ data, period }: {
  data: { period: string; label: string; net: number; accumulatedPnl?: number; wins: number; losses: number; total: number; winRate: number }[]
  period: Period
}) {
  return (
    <CollapsibleSection title={`Performance by ${period.charAt(0).toUpperCase() + period.slice(1)}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-ink-muted">
              {['Period', 'Net P&L', 'Accumulated P&L', 'Wins', 'Losses', 'Total', 'Win Rate'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No data.</td></tr>
            ) : data.map(row => (
              <tr key={row.period} className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors">
                <td className="px-3 py-2 text-ink-secondary">{row.label}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}

// ── Section 4: Performance by Stock chart ─────────────────────────────────────

function PerformanceByStockChart({ data }: {
  data: { symbol: string; net: number }[]
}) {
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.net - a.net)
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: '#1e293b', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params: any[]) => {
          const p = params[0]
          return `<b>${p.name}</b><br/>Net P&L: ${Number(p.value) >= 0 ? '+' : ''}${Number(p.value).toLocaleString()} THB`
        },
      },
      grid: { left: '2%', right: '4%', bottom: '3%', top: '8px', containLabel: true },
      xAxis: {
        type: 'category', data: sorted.map(d => d.symbol),
        axisLabel: { color: '#94a3b8', fontSize: 11 }, axisLine: { lineStyle: { color: '#334155' } }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', name: 'THB',
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => v.toLocaleString() },
        axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [{
        type: 'bar',
        data: sorted.map(d => ({
          value: d.net,
          itemStyle: { color: d.net >= 0 ? '#22c55e' : '#ef4444', borderRadius: d.net >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] },
        })),
        barMaxWidth: 48,
      }],
    }
  }, [data])

  if (data.length === 0) return null

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-ink-primary mb-3">Performance by Stock</h2>
      <ReactECharts option={option} style={{ height: 220 }} notMerge />
    </div>
  )
}

// ── Section 5: Performance by Stock table ─────────────────────────────────────

function PerformanceByStockTable({ data }: {
  data: { symbol: string; net: number; investment: number; currentValue: number; pnlPct: number; wins: number; losses: number; total: number; winRate: number }[]
}) {
  return (
    <CollapsibleSection title="Performance by Stock — Detail">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-ink-muted">
              {['Symbol', 'Investment', 'Current Value', 'Net P&L', 'P&L %', 'Wins', 'Losses', 'Win Rate'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No data.</td></tr>
            ) : data.map(row => (
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const queryClient = useQueryClient()
  const saved = loadCriteria()
  const [fromDate, setFromDate] = useState(saved?.fromDate ?? defaultFromDate())
  const [toDate, setToDate] = useState(saved?.toDate ?? todayStr())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(saved?.statusFilter ?? 'active')
  const [period, setPeriod] = useState<Period>('daily')

  // Persist criteria on change
  useEffect(() => { saveCriteria(fromDate, toDate, statusFilter) }, [fromDate, toDate, statusFilter])

  const params = { from_date: fromDate, to_date: toDate }

  const posQuery = useQuery({
    queryKey: ['portfolio-positions', fromDate, toDate, statusFilter],
    queryFn: () => portfolioTrackerService.getPositions({ ...params, status: statusFilter }),
    refetchInterval: 60_000,
  })

  const perfQuery = useQuery({
    queryKey: ['portfolio-performance', fromDate, toDate, period],
    queryFn: () => portfolioTrackerService.getPerformance({ ...params, period }),
    refetchInterval: 60_000,
  })

  const byDateQuery = useQuery({
    queryKey: ['portfolio-by-date', fromDate, toDate, period],
    queryFn: () => portfolioTrackerService.getPerformanceByDate({ ...params, period }),
    refetchInterval: 60_000,
  })

  const byStockQuery = useQuery({
    queryKey: ['portfolio-by-stock', fromDate, toDate],
    queryFn: () => portfolioTrackerService.getPerformanceByStock(params),
    refetchInterval: 60_000,
  })

  const refreshMutation = useMutation({
    mutationFn: () => portfolioTrackerService.refresh(),
    onSuccess: () => {
      toast.success('Excel refreshed — reloading data…')
      queryClient.invalidateQueries({ queryKey: ['portfolio-positions'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-performance'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-by-date'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-by-stock'] })
    },
    onError: () => toast.error('Refresh failed — check the source path in Settings'),
  })

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">Portfolio</h1>
          <p className="text-xs text-ink-muted mt-0.5">Thai SET · Investment tracking</p>
        </div>
        <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
          className="btn-icon" title="Copy Excel from source and refresh prices">
          <RefreshCw className={cn('w-4 h-4', refreshMutation.isPending && 'animate-spin')} />
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-ink-muted mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input text-sm py-1.5 px-2 w-36" />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">To</label>
          <input type="date" value={toDate} max={todayStr()} onChange={e => setToDate(e.target.value)} className="input text-sm py-1.5 px-2 w-36" />
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
      <PositionsTable positions={positions} total={totalPositions} totalPnl={totalPnl} loading={isLoading} />

      {/* 2. Daily Performance Chart */}
      <PerformanceChart data={perfQuery.data ?? []} period={period} onPeriodChange={setPeriod} loading={perfQuery.isLoading} />

      {/* 3. Performance by Date table (collapsible, aligned with chart period) */}
      <PerformanceByDateTable data={byDateQuery.data ?? []} period={period} />

      {/* 4. Performance by Stock chart */}
      <PerformanceByStockChart data={byStockQuery.data ?? []} />

      {/* 5. Performance by Stock table (collapsible) */}
      <PerformanceByStockTable data={byStockQuery.data ?? []} />
    </div>
  )
}
