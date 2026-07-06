'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { format, subMonths, subWeeks, startOfYear } from 'date-fns'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { investmentTransactionService } from '@/services/investmentTransaction'
import { portfolioDbService } from '@/services/portfolioDb'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

type Period = '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'All'
const PERIODS: Period[] = ['1W', '1M', '3M', '6M', '1Y', 'YTD', 'All']

function periodToParams(p: Period, earliestTxDate?: string): { from_date: string; period: 'daily' | 'weekly' | 'monthly' } {
  const today = new Date()
  const d = (dt: Date) => format(dt, 'yyyy-MM-dd')
  switch (p) {
    case '1W':  return { from_date: d(subWeeks(today, 1)),   period: 'daily'   }
    case '1M':  return { from_date: d(subMonths(today, 1)),  period: 'daily'   }
    case '3M':  return { from_date: d(subMonths(today, 3)),  period: 'weekly'  }
    case '6M':  return { from_date: d(subMonths(today, 6)),  period: 'weekly'  }
    case '1Y':  return { from_date: d(subMonths(today, 12)), period: 'monthly' }
    case 'YTD': return { from_date: d(startOfYear(today)),   period: 'monthly' }
    case 'All': return { from_date: '2000-01-01', period: 'monthly' }
  }
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const PERIOD_KEY = 'inv-balance-widget-period'

export function InvestmentBalanceWidget({ config: _config }: { config: WidgetConfig }) {
  const [period, setPeriod] = useState<Period>('3M')

  useEffect(() => {
    const saved = localStorage.getItem(PERIOD_KEY) as Period | null
    if (saved && PERIODS.includes(saved)) setPeriod(saved)
  }, [])

  const handlePeriod = (p: Period) => {
    setPeriod(p)
    localStorage.setItem(PERIOD_KEY, p)
  }

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['inv-balance-widget-tx'],
    queryFn: () => investmentTransactionService.list({}),
    staleTime: 120_000,
    refetchInterval: 5 * 60_000,
  })

  const earliestTxDate = useMemo(() => {
    const dates = (txData?.transactions ?? []).map(tx => tx.date).filter(Boolean)
    return dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : undefined
  }, [txData])

  const { from_date, period: apiPeriod } = periodToParams(period, earliestTxDate)
  const toDate = format(new Date(), 'yyyy-MM-dd')

  const { data: perfData = [], isLoading: perfLoading } = useQuery({
    queryKey: ['inv-balance-widget-perf', from_date, apiPeriod],
    queryFn: () => portfolioTrackerService.getPerformance({ from_date, to_date: toDate, period: apiPeriod }),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const { data: dbSummary } = useQuery({
    queryKey: ['portfolio-db-summary'],
    queryFn: portfolioDbService.getSummary,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: 1,
  })

  const balanceData = useMemo(() => {
    const transactions = txData?.transactions ?? []
    const totalInvested = txData?.summary?.net_investment ?? 0
    if (!perfData.length) return []
    const points = perfData.map(p => {
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
    // If transactions exist beyond the last perf-data cutoff date, add a synthetic
    // "today" point so the chart reflects the full invested amount.
    const last = points[points.length - 1]
    if (last && totalInvested > last.netInvested) {
      points.push({
        label: format(new Date(), 'dd MMM'),
        netInvested: totalInvested,
        cumulativePnl: last.cumulativePnl,
        portfolioValue: totalInvested + last.cumulativePnl,
      })
    }
    return points
  }, [perfData, txData])

  const summary = useMemo(() => {
    // Use actual total net investment from transaction summary — not the last chart point,
    // which can be stale when transactions fall after the performance data cutoff date.
    const totalInvested = txData?.summary?.net_investment ?? 0
    const openPnl = dbSummary?.openPnl ?? 0
    if (!balanceData.length) return { invested: totalInvested, value: 0, pnl: 0, pnlPct: 0, openPnl, openPnlPct: 0, totalWithOpen: 0, totalWithOpenPct: 0 }
    const last = balanceData[balanceData.length - 1]
    const pnl  = last.cumulativePnl
    const totalWithOpen = last.portfolioValue + openPnl
    return {
      invested:         totalInvested,
      value:            last.portfolioValue,
      pnl,
      pnlPct:           totalInvested !== 0 ? (pnl / totalInvested) * 100 : 0,
      openPnl,
      openPnlPct:       totalInvested !== 0 ? (openPnl / totalInvested) * 100 : 0,
      totalWithOpen,
      totalWithOpenPct: totalInvested !== 0 ? ((pnl + openPnl) / totalInvested) * 100 : 0,
    }
  }, [balanceData, txData, dbSummary])

  const chartOption = useMemo(() => {
    if (!balanceData.length) return {}
    const labels    = balanceData.map(d => d.label)
    const invested  = balanceData.map(d => d.netInvested)
    const portValue = balanceData.map(d => d.portfolioValue)

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
      grid: { top: 16, right: 12, bottom: 32, left: 52, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1C2333',
        borderColor: '#2A3450',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any[]) => {
          const lbl = params[0]?.axisValue ?? ''
          const inv = (params.find((p: any) => p.seriesName === 'Net Invested')?.value as number) ?? 0
          const val = (params.find((p: any) => p.seriesName === 'Portfolio Value')?.value as number) ?? 0
          const pnl = val - inv
          const pnlColor = pnl >= 0 ? '#22c55e' : '#ef4444'
          const sign = (n: number) => n >= 0 ? '+' : ''
          return `<div style="font-size:11px;color:#94A3B8;margin-bottom:4px">${lbl}</div>
<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:#8b5cf6;display:inline-block"></span><span style="color:#94A3B8">Net Invested</span><span style="color:#E2E8F0;font-weight:600;margin-left:auto">${fmtNum(inv)} ฿</span></div>
<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:#22d3ee;display:inline-block"></span><span style="color:#94A3B8">Portfolio Value</span><span style="color:#E2E8F0;font-weight:600;margin-left:auto">${fmtNum(val)} ฿</span></div>
<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${pnlColor};display:inline-block"></span><span style="color:#94A3B8">P&amp;L</span><span style="color:${pnlColor};font-weight:600;margin-left:auto">${sign(pnl)}${fmtNum(pnl)} ฿</span></div>`
        },
      },
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: '#2A3450' } },
        axisTick: { show: false },
        axisLabel: { color: '#64748B', fontSize: 10, rotate: labels.length > 8 ? 30 : 0 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: yMin, max: yMax,
        axisLabel: { color: '#64748B', fontSize: 10, formatter: fmtAxis },
        splitLine: { lineStyle: { color: '#1E2940', type: 'dashed' } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      series: [
        {
          name: 'Net Invested', type: 'line', data: invested, smooth: true, symbol: 'none',
          lineStyle: { color: '#8b5cf6', width: 2 },
          itemStyle: { color: '#8b5cf6' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(139,92,246,0.25)' }, { offset: 1, color: 'rgba(139,92,246,0)' }] } },
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
  }, [balanceData])

  const isLoading = perfLoading || txLoading
  const { invested, value, pnl, pnlPct, openPnl, openPnlPct, totalWithOpen, totalWithOpenPct } = summary
  const pnlUp         = pnl >= 0
  const openUp        = openPnl >= 0
  const totalWithOpenUp = totalWithOpen >= (summary.invested)

  const sign = (n: number) => n >= 0 ? '+' : ''

  return (
    <div className="flex flex-col h-full">
      {/* Summary row */}
      <div className="grid grid-cols-5 gap-x-3 gap-y-1 px-4 pt-3 pb-1 shrink-0">
        <div>
          <div className="text-[10px] text-ink-muted leading-tight">Net Invested</div>
          <div className="text-sm font-bold text-ink-primary tabular-nums">{fmtNum(invested)} ฿</div>
        </div>
        <div>
          <div className="text-[10px] text-ink-muted leading-tight">Portfolio Value</div>
          <div className="text-sm font-bold text-ink-primary tabular-nums">{fmtNum(value)} ฿</div>
        </div>
        <div>
          <div className="text-[10px] text-ink-muted leading-tight">Closed P&L <span className="text-ink-disabled">({period})</span></div>
          <div className={cn('text-sm font-bold tabular-nums', pnlUp ? 'text-gain' : 'text-loss')}>
            {sign(pnl)}{fmtNum(pnl)} ฿
            <span className="text-[10px] ml-1 opacity-70">({sign(pnl)}{pnlPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-ink-muted leading-tight">Open P&L</div>
          <div className={cn('text-sm font-bold tabular-nums', openUp ? 'text-gain' : 'text-loss')}>
            {sign(openPnl)}{fmtNum(openPnl)} ฿
            <span className="text-[10px] ml-1 opacity-70">({sign(openPnl)}{openPnlPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-ink-muted leading-tight">Total Value (incl. Open)</div>
          <div className="text-sm font-bold text-ink-primary tabular-nums">
            {fmtNum(totalWithOpen)} ฿
            <span className={cn('text-[10px] ml-1 opacity-70', (pnl + openPnl) >= 0 ? 'text-gain' : 'text-loss')}>
              ({sign(pnl + openPnl)}{totalWithOpenPct.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-1 px-4 pb-1 shrink-0">
        {PERIODS.map(p => (
          <button key={p} onClick={() => handlePeriod(p)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
              period === p
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-secondary',
            )}>
            {p}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        {isLoading ? (
          <div className="skeleton h-full rounded-lg" />
        ) : balanceData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-muted text-xs">
            Add investment transactions to view balance chart.
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>
    </div>
  )
}
