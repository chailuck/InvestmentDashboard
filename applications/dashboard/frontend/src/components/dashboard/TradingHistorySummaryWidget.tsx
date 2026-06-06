'use client'

import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown, BarChart2, Target, Percent } from 'lucide-react'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

function fmtTHB(n: number) {
  const sign = n >= 0 ? '+' : ''
  if (Math.abs(n) >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(2)}M ฿`
  if (Math.abs(n) >= 1_000) return `${sign}${(n / 1_000).toFixed(1)}K ฿`
  return `${sign}${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ฿`
}

export function TradingHistorySummaryWidget({ config }: { config: WidgetConfig }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: () => portfolioTrackerService.getSummary({}),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const accPnl     = data?.accumulated_pnl ?? 0
  const winRate    = data?.win_rate        ?? 0
  const avgPnl     = data?.avg_pnl         ?? 0
  const avgPnlPct  = data?.avg_pnl_pct     ?? 0
  const total      = data?.total_trades    ?? 0
  const wins       = data?.wins            ?? 0
  const losses     = data?.losses          ?? 0

  const metrics = [
    {
      label: 'Accumulated P&L',
      value: fmtTHB(accPnl),
      sub: `${total} closed trade${total !== 1 ? 's' : ''}`,
      up: accPnl >= 0,
      icon: accPnl >= 0 ? TrendingUp : TrendingDown,
      highlight: true,
    },
    {
      label: 'Win Rate',
      value: `${winRate.toFixed(1)}%`,
      sub: `${wins}W / ${losses}L`,
      up: winRate >= 50,
      icon: Target,
    },
    {
      label: 'Avg P&L / Trade',
      value: total > 0 ? fmtTHB(Math.round(avgPnl)) : '—',
      sub: total > 0 ? `${total} trades` : 'no trades',
      up: avgPnl >= 0,
      icon: avgPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: 'Avg P&L %',
      value: total > 0 ? `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}%` : '—',
      sub: 'per trade',
      up: avgPnlPct >= 0,
      icon: Percent,
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-3 h-full sm:gap-3 sm:p-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 sm:h-20 rounded-lg" />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-3 h-full content-start sm:gap-3 sm:p-4">
      {metrics.map(({ label, value, sub, up, icon: Icon, highlight }) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'card-elevated rounded-xl flex flex-col gap-0.5',
            'p-2.5 sm:p-4',
            highlight && 'border-brand-500/20 bg-brand-500/5',
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="metric-label text-[10px] sm:text-xs leading-tight truncate">{label}</span>
            <Icon className={cn(
              'w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0',
              highlight ? 'text-brand-400' : up === undefined ? 'text-ink-muted' : up ? 'text-gain' : 'text-loss',
            )} />
          </div>
          <AnimatePresence mode="wait">
            <motion.span
              key={value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn(
                'font-bold tabular-nums leading-tight',
                'text-base sm:text-xl',
                highlight
                  ? (up ? 'text-gain' : 'text-loss')
                  : up !== undefined ? (up ? 'text-gain' : 'text-loss') : 'text-ink-primary',
              )}
            >
              {value}
            </motion.span>
          </AnimatePresence>
          {sub && <span className="text-[10px] sm:text-xs text-ink-muted leading-tight">{sub}</span>}
        </motion.div>
      ))}
    </div>
  )
}
