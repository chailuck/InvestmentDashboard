'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

const COLORS = [
  '#3B82F6', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#A855F7', '#0EA5E9', '#22C55E', '#FB923C',
]

export function AllocationChartWidget({ config }: { config: WidgetConfig }) {
  // Use active positions from the Excel tracker
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-positions', undefined, undefined, 'active'],
    queryFn: () => portfolioTrackerService.getPositions({ status: 'active' }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const positions = data?.positions ?? []

  // Compute allocation by symbol: currentPrice × positionSize
  const allocationData = useMemo(() => {
    if (positions.length === 0) return []

    const map: Record<string, number> = {}
    for (const p of positions) {
      const val = p.currentPrice * p.positionSize
      map[p.symbol] = (map[p.symbol] ?? 0) + val
    }

    const total = Object.values(map).reduce((s, v) => s + v, 0)
    if (total === 0) return []

    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, value], i) => ({
        name: symbol,
        rawValue: value,
        value: +((value / total) * 100).toFixed(2),
        itemStyle: { color: COLORS[i % COLORS.length] },
      }))
  }, [positions])

  const totalValue = allocationData.reduce((s, d) => s + d.rawValue, 0)

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1C2333',
      borderColor: '#2A3450',
      borderWidth: 1,
      textStyle: { color: '#E2E8F0', fontSize: 11 },
      formatter: (p: any) => {
        const raw = allocationData.find(d => d.name === p.name)
        const val = raw ? raw.rawValue.toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''
        return `<b style="color:#E2E8F0">${p.name}</b><br/>
          <span style="color:#94A3B8">Value: ${val} ฿</span><br/>
          <span style="color:#94A3B8">Share: ${p.value}%</span>`
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 4,
      top: 'center',
      textStyle: { color: '#94A3B8', fontSize: 10 },
      itemWidth: 8,
      itemHeight: 8,
      pageTextStyle: { color: '#64748b', fontSize: 10 },
    },
    series: [{
      type: 'pie',
      radius: ['38%', '68%'],
      center: ['36%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#0B0F1A', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(59,130,246,0.4)' },
        scale: true,
        scaleSize: 5,
      },
      data: allocationData,
    }],
  }), [allocationData])

  if (isLoading) {
    return <div className="skeleton h-full m-4 rounded-lg" />
  }

  if (allocationData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        <p className="text-sm text-ink-muted">No open positions</p>
        <p className="text-xs text-ink-disabled">Allocation chart appears when you have active positions.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Total value label */}
      <div className="px-4 pt-3 pb-0 shrink-0">
        <p className="text-[10px] text-ink-muted">Total Position Value</p>
        <p className="text-sm font-bold text-ink-primary tabular-nums">
          {totalValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿
        </p>
      </div>
      <ReactECharts
        option={option}
        style={{ flex: 1, width: '100%', minHeight: 0 }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
    </div>
  )
}
