'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { format, subMonths } from 'date-fns'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { portfolioTrackerService, type Position } from '@/services/portfolioTracker'

// ── Types ──────────────────────────────────────────────────────────────────────

type StatusFilter = 'active' | 'closed' | 'all'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPnl(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n, 0)}`
}

function fmtPct(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n, 2)}%`
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

function oneMonthAgoStr() {
  return format(subMonths(new Date(), 1), 'yyyy-MM-dd')
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-muted mb-1">{label}</p>
      <p className={cn('text-xl font-bold', positive === true && 'text-gain', positive === false && 'text-loss', positive === undefined && 'text-ink-primary')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: Position['status'] }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold',
      status === 'active' ? 'bg-gain/15 text-gain' : 'bg-ink-muted/20 text-ink-muted',
    )}>
      {status === 'active' ? 'OPEN' : 'CLOSED'}
    </span>
  )
}

function PnlCell({ value, pct }: { value: number; pct: number }) {
  const pos = value >= 0
  return (
    <div className={pos ? 'text-gain' : 'text-loss'}>
      <span className="font-semibold">{fmtPnl(value)}</span>
      <span className="text-[10px] ml-1 opacity-75">{fmtPct(pct)}</span>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [fromDate, setFromDate] = useState(oneMonthAgoStr())
  const [toDate, setToDate] = useState(todayStr())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const posQuery = useQuery({
    queryKey: ['portfolio-positions', fromDate, toDate, statusFilter],
    queryFn: () => portfolioTrackerService.getPositions({
      from_date: fromDate,
      to_date: toDate,
      status: statusFilter,
    }),
    refetchInterval: 60_000,
  })

  const perfQuery = useQuery({
    queryKey: ['portfolio-performance', fromDate, toDate],
    queryFn: () => portfolioTrackerService.getPerformance({ from_date: fromDate, to_date: toDate }),
    refetchInterval: 60_000,
  })

  const positions = posQuery.data?.positions ?? []
  const totalPnl = posQuery.data?.totalNetPnl ?? 0
  const totalPositions = posQuery.data?.total ?? 0

  const activeCount = positions.filter(p => p.status === 'active').length
  const winCount = positions.filter(p => p.netPnl > 0).length
  const lossCount = positions.filter(p => p.netPnl <= 0).length
  const winRate = positions.length > 0 ? Math.round((winCount / positions.length) * 100) : 0

  // ── Chart option ─────────────────────────────────────────────────────────────

  const chartOption = useMemo(() => {
    const perf = perfQuery.data ?? []
    const dates = perf.map(p => p.date)
    const cumPnl = perf.map(p => p.cumulativePnl)
    const dailyPnl = perf.map(p => p.dailyPnl)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? ''
          let html = `<div style="font-weight:600;margin-bottom:4px">${date}</div>`
          params.forEach((p: any) => {
            const sign = p.value >= 0 ? '+' : ''
            html += `<div style="color:${p.color}">${p.seriesName}: ${sign}${Number(p.value).toLocaleString()} THB</div>`
          })
          return html
        },
      },
      legend: {
        data: ['Cumulative P&L', 'Daily P&L'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 4,
      },
      grid: { left: '2%', right: '2%', bottom: '3%', top: '40px', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'THB',
          nameTextStyle: { color: '#64748b', fontSize: 10 },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => v.toLocaleString() },
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#1e293b' } },
        },
        {
          type: 'value',
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Cumulative P&L',
          type: 'line',
          data: cumPnl,
          smooth: true,
          lineStyle: { color: '#22c55e', width: 2 },
          itemStyle: { color: '#22c55e' },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.18)' }, { offset: 1, color: 'rgba(34,197,94,0)' }],
            },
          },
          symbol: 'none',
        },
        {
          name: 'Daily P&L',
          type: 'bar',
          yAxisIndex: 1,
          data: dailyPnl.map((v: number) => ({
            value: v,
            itemStyle: { color: v >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)' },
          })),
          barMaxWidth: 8,
        },
      ],
    }
  }, [perfQuery.data])

  const refresh = useCallback(() => {
    posQuery.refetch()
    perfQuery.refetch()
  }, [posQuery, perfQuery])

  const isLoading = posQuery.isLoading || perfQuery.isLoading
  const hasError = posQuery.isError || perfQuery.isError

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">Portfolio</h1>
          <p className="text-xs text-ink-muted mt-0.5">Investment tracking — Thai SET stocks</p>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="btn-icon"
          title="Refresh live prices"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-ink-muted mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="input text-sm py-1.5 px-2 w-36"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">To</label>
          <input
            type="date"
            value={toDate}
            max={todayStr()}
            onChange={e => setToDate(e.target.value)}
            className="input text-sm py-1.5 px-2 w-36"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Status</label>
          <div className="flex gap-1">
            {(['active', 'all', 'closed'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                  statusFilter === s
                    ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                    : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {hasError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load portfolio data. Check the Excel file path in the backend configuration.
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Total P&L" value={`${fmtPnl(totalPnl)} THB`} positive={totalPnl >= 0} />
        <MetricCard label="Positions" value={String(totalPositions)} sub={`${activeCount} open`} />
        <MetricCard label="Win Rate" value={`${winRate}%`} sub={`${winCount}W / ${lossCount}L`} positive={winRate >= 50} />
        <MetricCard
          label="Avg P&L"
          value={positions.length > 0 ? `${fmtPnl(Math.round(totalPnl / positions.length))} THB` : '—'}
          positive={totalPnl >= 0}
        />
      </div>

      {/* Daily Performance Chart */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink-primary mb-3">Daily Performance</h2>
        {perfQuery.isLoading ? (
          <div className="h-56 flex items-center justify-center text-ink-muted text-sm">Loading chart…</div>
        ) : (perfQuery.data ?? []).length === 0 ? (
          <div className="h-56 flex items-center justify-center text-ink-muted text-sm">No performance data for the selected period.</div>
        ) : (
          <ReactECharts option={chartOption} style={{ height: 240 }} notMerge />
        )}
      </div>

      {/* Positions Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">
            Positions <span className="text-ink-muted font-normal ml-1">({totalPositions})</span>
          </h2>
          {posQuery.isLoading && <span className="text-xs text-ink-muted">Loading…</span>}
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
              {positions.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-ink-muted">No positions found.</td>
                </tr>
              ) : (
                positions.map(pos => (
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
                    <td className="px-3 py-2.5"><StatusBadge status={pos.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
            {positions.length > 0 && (
              <tfoot>
                <tr className="border-t border-border/50 bg-surface-elevated/30">
                  <td colSpan={6} className="px-3 py-2.5 font-semibold text-ink-secondary text-right">Total</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('font-bold', totalPnl >= 0 ? 'text-gain' : 'text-loss')}>
                      {fmtPnl(totalPnl)} THB
                    </span>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
