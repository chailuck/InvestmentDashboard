'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { portfolioService } from '@/services/portfolio'
import { useDashboardStore } from '@/store/dashboard'
import { cn, formatCurrency } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

type Period = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD'

const PERIODS: Period[] = ['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD']

export function PortfolioChartWidget({ config }: { config: WidgetConfig }) {
  const { selectedPortfolioId } = useDashboardStore()
  const [period, setPeriod] = useState<Period>('3M')

  const { data = [], isLoading } = useQuery({
    queryKey: ['portfolio-performance', selectedPortfolioId, period],
    queryFn: () => portfolioService.getPerformance(selectedPortfolioId ?? 'default', period),
    refetchInterval: 60_000,
  })

  const chartOption = useMemo(() => {
    const dates = data.map((d) => d.date)
    const portfolioVals = data.map((d) => d.portfolioValue)
    const benchmarkVals = data.map((d) => d.benchmarkValue)

    return {
      backgroundColor: 'transparent',
      grid: { top: 16, right: 12, bottom: 32, left: 60, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1C2333',
        borderColor: '#2A3450',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 12 },
        formatter: (params: any[]) =>
          `<div style="font-size:11px;color:#94A3B8;margin-bottom:4px">${params[0]?.axisValueLabel}</div>` +
          params.map((p: any) =>
            `<div style="display:flex;gap:8px;align-items:center">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block"></span>
              <span style="color:#94A3B8">${p.seriesName}</span>
              <span style="color:#E2E8F0;font-weight:600;margin-left:auto">${formatCurrency(p.value)}</span>
            </div>`
          ).join(''),
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#2A3450' } },
        axisTick: { show: false },
        axisLabel: { color: '#64748B', fontSize: 11, interval: 'auto' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#64748B', fontSize: 11,
          formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
        },
        splitLine: { lineStyle: { color: '#1E2940', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'Portfolio',
          type: 'line',
          data: portfolioVals,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#3B82F6', width: 2 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59,130,246,0.25)' },
                { offset: 1, color: 'rgba(59,130,246,0.01)' },
              ],
            },
          },
        },
        {
          name: 'Benchmark',
          type: 'line',
          data: benchmarkVals,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#64748B', width: 1.5, type: 'dashed' },
        },
      ],
      legend: {
        top: -4,
        right: 0,
        textStyle: { color: '#94A3B8', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 2,
      },
    }
  }, [data])

  return (
    <div className="flex flex-col h-full">
      {/* Period selector */}
      <div className="flex items-center gap-1 px-4 pt-2 pb-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
              period === p
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-secondary'
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        {isLoading ? (
          <div className="skeleton h-full rounded-lg" />
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        )}
      </div>
    </div>
  )
}
