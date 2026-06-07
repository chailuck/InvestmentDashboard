'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { format, subDays } from 'date-fns'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

type TimeRange = 'All' | '3M' | '1M'
const TIME_RANGES: TimeRange[] = ['All', '3M', '1M']

function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function rangeToFromDate(range: TimeRange): string | undefined {
  const today = new Date()
  if (range === '3M') return format(subDays(today, 90), 'yyyy-MM-dd')
  if (range === '1M') return format(subDays(today, 30), 'yyyy-MM-dd')
  return undefined
}

function gradientColor(positive: boolean) {
  return positive
    ? { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
        colorStops: [{ offset: 0, color: 'rgba(16,185,129,0.35)' }, { offset: 1, color: 'rgba(16,185,129,0.9)' }] }
    : { type: 'linear', x: 1, y: 0, x2: 0, y2: 0,
        colorStops: [{ offset: 0, color: 'rgba(239,68,68,0.35)' },  { offset: 1, color: 'rgba(239,68,68,0.9)' }] }
}

export function PnlWaterfallWidget({ config }: { config: WidgetConfig }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('All')
  const fromDate = rangeToFromDate(timeRange)

  const { data: stockData = [], isLoading } = useQuery({
    queryKey: ['performance-by-stock', timeRange],
    queryFn: () => portfolioTrackerService.getPerformanceByStock(fromDate ? { from_date: fromDate } : {}),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

  const chartOption = useMemo(() => {
    if (!stockData.length) return null

    const sorted = [...stockData].sort((a, b) => b.net - a.net)
    const syms   = sorted.map(d => d.symbol)

    return {
      backgroundColor: 'transparent',
      grid: { left: 8, right: 8, top: 6, bottom: 24, containLabel: true },

      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1C2333',
        borderColor: '#2A3450',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0
          const d = sorted[idx]
          if (!d) return ''
          const sign = d.net >= 0 ? '+' : ''
          const retSign = d.pnlPct >= 0 ? '+' : ''
          return (
            `<div style="font-weight:700;color:#F1F5F9;margin-bottom:4px">${d.symbol}</div>` +
            `<div style="display:flex;justify-content:space-between;gap:16px">` +
            `<span style="color:#94A3B8">Net P&L</span><span style="color:${d.net >= 0 ? '#10B981' : '#EF4444'};font-weight:600">${sign}${fmtK(d.net)} ฿</span></div>` +
            `<div style="display:flex;justify-content:space-between;gap:16px">` +
            `<span style="color:#94A3B8">Return</span><span style="color:${d.pnlPct >= 0 ? '#10B981' : '#EF4444'}">${retSign}${d.pnlPct.toFixed(2)}%</span></div>` +
            `<div style="display:flex;justify-content:space-between;gap:16px">` +
            `<span style="color:#94A3B8">Trades</span><span style="color:#E2E8F0">${d.wins}W / ${d.losses}L</span></div>` +
            `<div style="display:flex;justify-content:space-between;gap:16px">` +
            `<span style="color:#94A3B8">Win Rate</span><span style="color:#60A5FA">${d.winRate.toFixed(0)}%</span></div>`
          )
        },
      },

      xAxis: {
        type: 'value',
        axisLabel: { color: '#475569', fontSize: 9, formatter: (v: number) => v === 0 ? '' : fmtK(v) },
        splitLine: { lineStyle: { color: '#1a2235', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },

      yAxis: {
        type: 'category',
        data: syms,
        axisLabel: {
          color: '#94A3B8',
          fontSize: 10,
          fontWeight: '600',
        },
        axisLine: { lineStyle: { color: '#1E2940' } },
        axisTick: { show: false },
        splitLine: { show: false },
      },

      series: [
        // ── Main P&L bars ─────────────────────────────────────────────
        {
          type: 'bar',
          barMaxWidth: 20,
          barMinHeight: 3,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            distance: 6,
            formatter: (params: any) => {
              const d = sorted[params.dataIndex]
              const sign    = d.net >= 0 ? '+' : ''
              const retSign = d.pnlPct >= 0 ? '+' : ''
              const filled  = Math.round(d.winRate / 20)
              const barStr  = '█'.repeat(filled) + '░'.repeat(5 - filled)
              const barKey  = d.winRate >= 60 ? 'bg' : d.winRate >= 40 ? 'bo' : 'br'
              return [
                `{v|${sign}${fmtK(d.net)}฿}`,
                `{s|${retSign}${d.pnlPct.toFixed(1)}% · ${d.total}T}`,
                `{dot|}`,
                `{wr|${d.winRate.toFixed(0)}%}`,
                `{${barKey}|${barStr}}`,
              ].join('  ')
            },
            rich: {
              v:   { fontSize: 11, fontWeight: '700', color: '#F1F5F9', padding: [0, 4, 0, 0] },
              s:   { fontSize: 9,  color: '#64748B' },
              dot: {
                fontSize: 9, width: 8, height: 8, borderRadius: 4,
                backgroundColor: (params: any) => {
                  const d = sorted[params.dataIndex]
                  return d.winRate >= 60 ? '#10B981' : d.winRate >= 40 ? '#FB923C' : '#EF4444'
                },
              },
              wr:  { fontSize: 9, color: '#94A3B8' },
              bg:  { fontSize: 8, color: '#10B981' },
              bo:  { fontSize: 8, color: '#FB923C' },
              br:  { fontSize: 8, color: '#EF4444' },
            },
          },
          data: sorted.map(d => ({
            value: d.net,
            itemStyle: { color: gradientColor(d.net >= 0) },
          })),
        },

      ],
    }
  }, [stockData])

  return (
    <div className="flex flex-col h-full">
      {/* Time range toggle */}
      <div className="flex items-center gap-1 px-4 pt-2 pb-1 shrink-0">
        {TIME_RANGES.map(r => (
          <button key={r} onClick={() => setTimeRange(r)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
              timeRange === r
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-secondary',
            )}>
            {r}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-1 pb-2">
        {isLoading ? (
          <div className="skeleton h-full rounded-lg" />
        ) : !stockData.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-sm text-ink-muted">No P&L data for this period</p>
            <p className="text-xs text-ink-disabled">Closed trades will appear here once data is available.</p>
          </div>
        ) : (
          <ReactECharts
            option={chartOption!}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>
    </div>
  )
}
