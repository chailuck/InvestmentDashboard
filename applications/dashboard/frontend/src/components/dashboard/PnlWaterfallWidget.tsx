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
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function rangeToFromDate(range: TimeRange): string | undefined {
  const today = new Date()
  if (range === '3M') return format(subDays(today, 90), 'yyyy-MM-dd')
  if (range === '1M') return format(subDays(today, 30), 'yyyy-MM-dd')
  return undefined
}

export function PnlWaterfallWidget({ config }: { config: WidgetConfig }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('All')

  const fromDate = rangeToFromDate(timeRange)

  const { data: stockData = [], isLoading } = useQuery({
    queryKey: ['performance-by-stock', timeRange],
    queryFn: () =>
      portfolioTrackerService.getPerformanceByStock(
        fromDate ? { from_date: fromDate } : {},
      ),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

  const { symbols, values, chartOption } = useMemo(() => {
    if (stockData.length === 0) {
      return { symbols: [], values: [], chartOption: null }
    }

    const sorted = [...stockData].sort((a, b) => b.net - a.net)
    const syms = sorted.map((s) => s.symbol)
    const vals = sorted.map((s) => s.net)

    const option = {
      backgroundColor: 'transparent',
      grid: { left: 60, right: 20, top: 10, bottom: 30, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1C2333',
        borderColor: '#2A3450',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any) => {
          const d = sorted.find((s) => s.symbol === params[0]?.name)
          if (!d) return ''
          const sign = d.net >= 0 ? '+' : ''
          return (
            `<b style="color:#E2E8F0">${d.symbol}</b><br/>` +
            `<span style="color:#94A3B8">P&L: ${sign}${fmtK(d.net)} ฿</span><br/>` +
            `<span style="color:#94A3B8">Return: ${d.pnlPct.toFixed(2)}%</span><br/>` +
            `<span style="color:#94A3B8">Win Rate: ${d.winRate.toFixed(0)}%</span>`
          )
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: '#64748b',
          fontSize: 10,
          formatter: fmtK,
        },
        splitLine: { lineStyle: { color: '#1E2940', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: syms,
        axisLabel: {
          color: '#94A3B8',
          fontSize: 10,
        },
        axisLine: { lineStyle: { color: '#2A3450' } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: vals.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#10B981' : '#EF4444', borderRadius: 2 },
          })),
          barMaxWidth: 16,
        },
      ],
    }

    return { symbols: syms, values: vals, chartOption: option }
  }, [stockData])

  return (
    <div className="flex flex-col h-full">
      {/* Time range toggle */}
      <div className="flex items-center gap-1 px-4 pt-2 pb-1 shrink-0">
        {TIME_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
              timeRange === r
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-secondary',
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        {isLoading ? (
          <div className="skeleton h-full rounded-lg" />
        ) : stockData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-sm text-ink-muted">No P&L data for this period</p>
            <p className="text-xs text-ink-disabled">
              Closed trades will appear here once data is available.
            </p>
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
