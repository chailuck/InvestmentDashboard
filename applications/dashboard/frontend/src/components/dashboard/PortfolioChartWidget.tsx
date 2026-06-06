'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { format, subMonths, subWeeks, subDays, startOfYear } from 'date-fns'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

type Period = '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD'

const PERIODS: Period[] = ['1W', '1M', '3M', '6M', '1Y', 'YTD']

function periodToParams(p: Period): { from_date: string; period: 'daily' | 'weekly' | 'monthly' } {
  const today = new Date()
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (p) {
    case '1W':  return { from_date: fmt(subWeeks(today, 1)),   period: 'daily' }
    case '1M':  return { from_date: fmt(subMonths(today, 1)),  period: 'daily' }
    case '3M':  return { from_date: fmt(subMonths(today, 3)),  period: 'weekly' }
    case '6M':  return { from_date: fmt(subMonths(today, 6)),  period: 'weekly' }
    case '1Y':  return { from_date: fmt(subMonths(today, 12)), period: 'monthly' }
    case 'YTD': return { from_date: fmt(startOfYear(today)),   period: 'monthly' }
  }
}

const PERIOD_KEY = 'perf-widget-period'

export function PortfolioChartWidget({ config }: { config: WidgetConfig }) {
  const [period, setPeriod] = useState<Period>('3M')

  useEffect(() => {
    const saved = localStorage.getItem(PERIOD_KEY) as Period | null
    if (saved && PERIODS.includes(saved)) setPeriod(saved)
  }, [])

  const handlePeriod = (p: Period) => {
    setPeriod(p)
    localStorage.setItem(PERIOD_KEY, p)
  }
  const { from_date, period: apiPeriod } = periodToParams(period)
  const toDate = format(new Date(), 'yyyy-MM-dd')

  const { data = [], isLoading } = useQuery({
    queryKey: ['dashboard-performance', from_date, apiPeriod],
    queryFn: () => portfolioTrackerService.getPerformance({ from_date, to_date: toDate, period: apiPeriod }),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const chartOption = useMemo(() => {
    const labels = data.map(d => d.label)
    const cumPnl  = data.map(d => d.cumulativePnl)
    const barPnl  = data.map(d => d.dailyPnl)

    return {
      backgroundColor: 'transparent',
      grid: { top: 16, right: 12, bottom: 32, left: 56, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1C2333',
        borderColor: '#2A3450',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any[]) => {
          const lbl = params[0]?.axisValueLabel ?? ''
          let html = `<div style="font-size:11px;color:#94A3B8;margin-bottom:4px">${lbl}</div>`
          params.forEach((p: any) => {
            const sign = Number(p.value) >= 0 ? '+' : ''
            html += `<div style="display:flex;gap:8px;align-items:center">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block"></span>
              <span style="color:#94A3B8">${p.seriesName}</span>
              <span style="color:#E2E8F0;font-weight:600;margin-left:auto">${sign}${Number(p.value).toLocaleString()} ฿</span>
            </div>`
          })
          return html
        },
      },
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: '#2A3450' } },
        axisTick: { show: false },
        axisLabel: { color: '#64748B', fontSize: 10, rotate: labels.length > 8 ? 30 : 0 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { color: '#64748B', fontSize: 10, formatter: (v: number) => `${(v/1000).toFixed(0)}k` },
          splitLine: { lineStyle: { color: '#1E2940', type: 'dashed' } },
          axisLine: { show: false }, axisTick: { show: false },
        },
        { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
      ],
      series: [
        {
          name: 'Cumulative P&L',
          type: 'line',
          data: cumPnl,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#22c55e', width: 2 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.2)' }, { offset: 1, color: 'rgba(34,197,94,0.01)' }],
            },
          },
        },
        {
          name: 'Period P&L',
          type: 'bar',
          yAxisIndex: 1,
          data: barPnl.map((v: number) => ({
            value: v,
            itemStyle: { color: v >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)' },
          })),
          barMaxWidth: 8,
        },
      ],
    }
  }, [data])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-4 pt-2 pb-1">
        {PERIODS.map(p => (
          <button key={p} onClick={() => handlePeriod(p)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
              period === p
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-secondary'
            )}>
            {p}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 px-2 pb-2">
        {isLoading ? (
          <div className="skeleton h-full rounded-lg" />
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-muted text-xs">
            No realized P&L data for this period.
          </div>
        ) : (
          <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} notMerge />
        )}
      </div>
    </div>
  )
}
