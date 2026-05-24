'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { portfolioService } from '@/services/portfolio'
import { useDashboardStore } from '@/store/dashboard'
import type { WidgetConfig } from '@/types'
import { cn } from '@/lib/utils'

interface MetricRow {
  label: string
  value: number | string
  suffix?: string
  description: string
  good: 'high' | 'low' | 'neutral'
  threshold?: { good: number; bad: number }
}

export function RiskMetricsWidget({ config }: { config: WidgetConfig }) {
  const { selectedPortfolioId } = useDashboardStore()

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['risk-metrics', selectedPortfolioId],
    queryFn: () => portfolioService.getMetrics(selectedPortfolioId ?? 'default'),
    refetchInterval: 300_000,
  })

  const rows: MetricRow[] = metrics
    ? [
        { label: 'Sharpe Ratio',    value: metrics.sharpeRatio.toFixed(2),   description: 'Risk-adjusted return',    good: 'high', threshold: { good: 1.5, bad: 0.5 } },
        { label: 'Sortino Ratio',   value: metrics.sortinoRatio.toFixed(2),  description: 'Downside-adjusted return', good: 'high', threshold: { good: 2.0, bad: 1.0 } },
        { label: 'Max Drawdown',    value: (metrics.maxDrawdown * 100).toFixed(2), suffix: '%', description: 'Worst peak-to-trough',  good: 'low',  threshold: { good: -10, bad: -25 } },
        { label: 'Volatility',      value: (metrics.volatility * 100).toFixed(2),  suffix: '%', description: 'Annual std deviation',  good: 'low',  threshold: { good: 10, bad: 25 } },
        { label: 'Beta',            value: metrics.beta.toFixed(2),           description: 'Market sensitivity',      good: 'neutral' },
        { label: 'Alpha',           value: (metrics.alpha * 100).toFixed(2),  suffix: '%', description: 'Excess return vs benchmark', good: 'high' },
        { label: 'VaR (95%)',       value: (metrics.var95 * 100).toFixed(2),  suffix: '%', description: 'Daily value at risk 95%',   good: 'low' },
        { label: 'Calmar Ratio',    value: metrics.calmarRatio.toFixed(2),    description: 'Return / max drawdown',   good: 'high', threshold: { good: 3, bad: 1 } },
      ]
    : []

  const getColor = (row: MetricRow): string => {
    if (row.good === 'neutral') return 'text-ink-secondary'
    const v = parseFloat(String(row.value))
    if (!row.threshold) return v > 0 ? 'text-gain' : 'text-loss'
    if (row.good === 'high') {
      return v >= row.threshold.good ? 'text-gain' : v <= row.threshold.bad ? 'text-loss' : 'text-warning'
    }
    return v <= row.threshold.good ? 'text-gain' : v >= row.threshold.bad ? 'text-loss' : 'text-warning'
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-8 rounded" />)}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-1 overflow-y-auto h-full">
      {rows.map((row, i) => (
        <motion.div
          key={row.label}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center justify-between py-2 border-b border-border/20 last:border-0 group"
        >
          <div>
            <div className="text-xs font-medium text-ink-secondary">{row.label}</div>
            <div className="text-[10px] text-ink-disabled group-hover:text-ink-muted transition-colors">{row.description}</div>
          </div>
          <span className={cn('text-sm font-bold tabular', getColor(row))}>
            {row.value}{row.suffix ?? ''}
          </span>
        </motion.div>
      ))}
    </div>
  )
}
