'use client'

import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown, BarChart2, Target } from 'lucide-react'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

function fmtTHB(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ฿`
}

export function PortfolioSummaryWidget({ config }: { config: WidgetConfig }) {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-positions', undefined, undefined, 'active'],
    queryFn: () => portfolioTrackerService.getPositions({ status: 'active' }),
    refetchInterval: 60_000,
  })

  const positions = data?.positions ?? []
  const totalPnl = data?.totalNetPnl ?? 0
  const total = data?.total ?? 0
  const wins = positions.filter(p => p.netPnl > 0).length
  const losses = positions.filter(p => p.netPnl <= 0).length
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0
  const totalCost = positions.reduce((s, p) => s + p.entryPrice * p.positionSize, 0)

  const metrics = [
    {
      label: 'Open P&L',
      value: fmtTHB(totalPnl),
      sub: totalCost > 0 ? `${((totalPnl / totalCost) * 100).toFixed(2)}% return` : undefined,
      up: totalPnl >= 0,
      icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
      highlight: true,
    },
    {
      label: 'Open Positions',
      value: String(total),
      sub: `${wins}W / ${losses}L`,
      icon: BarChart2,
    },
    {
      label: 'Win Rate',
      value: `${winRate}%`,
      sub: total > 0 ? `${total} trades` : 'no trades',
      up: winRate >= 50,
      icon: Target,
    },
    {
      label: 'Avg P&L / Trade',
      value: total > 0 ? fmtTHB(Math.round(totalPnl / total)) : '—',
      up: totalPnl >= 0,
      icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 h-full">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 h-full content-start">
      {metrics.map(({ label, value, sub, up, icon: Icon, highlight }) => (
        <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className={cn('card-elevated p-4 rounded-xl flex flex-col gap-1',
            highlight && 'border-brand-500/20 bg-brand-500/5')}>
          <div className="flex items-center justify-between">
            <span className="metric-label">{label}</span>
            <Icon className={cn('w-3.5 h-3.5', highlight ? 'text-brand-400' : up === undefined ? 'text-ink-muted' : up ? 'text-gain' : 'text-loss')} />
          </div>
          <AnimatePresence mode="wait">
            <motion.span key={value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className={cn('metric-value text-xl',
                highlight ? (up ? 'text-gain' : 'text-loss') : up !== undefined ? (up ? 'text-gain' : 'text-loss') : 'text-ink-primary')}>
              {value}
            </motion.span>
          </AnimatePresence>
          {sub && <span className="text-xs text-ink-muted">{sub}</span>}
        </motion.div>
      ))}
    </div>
  )
}
