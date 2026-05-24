'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { portfolioService } from '@/services/portfolio'
import { useDashboardStore } from '@/store/dashboard'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

const SECTOR_COLORS = [
  '#3B82F6', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#84CC16', '#F97316', '#6366F1',
]

export function AllocationChartWidget({ config }: { config: WidgetConfig }) {
  const { selectedPortfolioId } = useDashboardStore()

  const { data: holdings = [], isLoading } = useQuery({
    queryKey: ['holdings', selectedPortfolioId],
    queryFn: () => portfolioService.getHoldings(selectedPortfolioId ?? 'default'),
    refetchInterval: 60_000,
  })

  const sectorData = useMemo(() => {
    const map: Record<string, number> = {}
    holdings.forEach(h => {
      map[h.sector] = (map[h.sector] ?? 0) + h.weight
    })
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value: +(value * 100).toFixed(2),
        itemStyle: { color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
      }))
  }, [holdings])

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1C2333',
      borderColor: '#2A3450',
      borderWidth: 1,
      textStyle: { color: '#E2E8F0', fontSize: 12 },
      formatter: (p: any) =>
        `<b style="color:#E2E8F0">${p.name}</b><br/><span style="color:#94A3B8">${p.value}%</span>`,
    },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'center',
      textStyle: { color: '#94A3B8', fontSize: 11 },
      itemWidth: 8,
      itemHeight: 8,
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#0B0F1A', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(59,130,246,0.3)' },
        scale: true,
        scaleSize: 6,
      },
      data: sectorData,
    }],
  }

  if (isLoading) return <div className="skeleton h-full m-4 rounded-lg" />

  return (
    <ReactECharts
      option={option}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}
