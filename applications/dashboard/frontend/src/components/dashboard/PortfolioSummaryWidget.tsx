'use client'

import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Zap } from 'lucide-react'
import { portfolioService } from '@/services/portfolio'
import { formatCurrency, formatPct, cn } from '@/lib/utils'
import { useDashboardStore } from '@/store/dashboard'
import { useWSEvent } from '@/websocket/hooks'
import { useState } from 'react'
import type { WidgetConfig } from '@/types'

export function PortfolioSummaryWidget({ config }: { config: WidgetConfig }) {
  const { selectedPortfolioId } = useDashboardStore()
  const [liveValue, setLiveValue] = useState<number | null>(null)

  const { data: portfolio, isLoading } = useQuery({
    queryKey: ['portfolio', selectedPortfolioId ?? 'default'],
    queryFn: () => portfolioService.get(selectedPortfolioId ?? 'default'),
    refetchInterval: 30_000,
  })

  // Receive live updates
  useWSEvent<any>('portfolio_update', (payload) => {
    if (!selectedPortfolioId || payload.id === selectedPortfolioId) {
      setLiveValue(payload.totalValue)
    }
  })

  const totalValue = liveValue ?? portfolio?.totalValue ?? 0
  const dailyPnl = portfolio?.dailyPnl ?? 0
  const dailyPnlPct = portfolio?.dailyPnlPct ?? 0
  const totalReturn = portfolio?.totalReturn ?? 0
  const totalReturnPct = portfolio?.totalReturnPct ?? 0
  const cash = portfolio?.cash ?? 0

  const metrics = [
    {
      label: 'Total Value',
      value: formatCurrency(totalValue),
      icon: DollarSign,
      highlight: true,
    },
    {
      label: 'Day P&L',
      value: formatCurrency(dailyPnl),
      change: formatPct(dailyPnlPct),
      up: dailyPnl >= 0,
      icon: dailyPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: 'Total Return',
      value: formatCurrency(totalReturn),
      change: formatPct(totalReturnPct),
      up: totalReturn >= 0,
      icon: BarChart2,
    },
    {
      label: 'Cash',
      value: formatCurrency(cash),
      icon: Zap,
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 h-full">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 h-full content-start">
      {metrics.map(({ label, value, change, up, icon: Icon, highlight }) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'card-elevated p-4 rounded-xl flex flex-col gap-1',
            highlight && 'border-brand-500/20 bg-brand-500/5'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="metric-label">{label}</span>
            <Icon className={cn('w-3.5 h-3.5', highlight ? 'text-brand-400' : 'text-ink-muted')} />
          </div>
          <AnimatePresence mode="wait">
            <motion.span
              key={value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn('metric-value text-xl', highlight && 'text-brand-300')}
            >
              {value}
            </motion.span>
          </AnimatePresence>
          {change !== undefined && (
            <span className={cn('text-xs font-semibold', up ? 'text-gain' : 'text-loss')}>
              {up ? '▲' : '▼'} {change}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  )
}
