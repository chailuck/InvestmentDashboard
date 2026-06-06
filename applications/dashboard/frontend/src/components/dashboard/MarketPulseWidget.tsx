'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { portfolioTrackerService, type SetIndex, type GlobalIndex } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

function fmtValue(v: number | null): string {
  if (v == null) return '—'
  if (Math.abs(v) >= 10_000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1_000)  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface IndexCardProps {
  name: string
  value: number | null
  change: number | null
  changePct: number | null
}

function IndexCard({ name, value, change, changePct }: IndexCardProps) {
  const up = (changePct ?? 0) >= 0
  const Icon = up ? TrendingUp : TrendingDown

  const fmtPct = changePct != null
    ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
    : '—'
  const fmtChg = change != null
    ? `${change >= 0 ? '+' : ''}${Math.abs(change) >= 1 ? change.toFixed(1) : change.toFixed(2)}`
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-elevated rounded-xl flex flex-col gap-0.5 p-2.5 sm:p-3 min-w-0"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="metric-label text-[10px] sm:text-xs leading-tight font-semibold text-ink-muted uppercase tracking-wider truncate">
          {name}
        </span>
        <Icon className={cn('w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0', up ? 'text-gain' : 'text-loss')} />
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={String(value)}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          className="font-bold tabular-nums leading-tight text-sm sm:text-base text-ink-primary"
        >
          {fmtValue(value)}
        </motion.span>
      </AnimatePresence>
      <div className="flex items-center gap-1 flex-wrap">
        <span className={cn(
          'text-[10px] font-semibold px-1 py-0.5 rounded tabular-nums',
          up ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss',
        )}>
          {fmtPct}
        </span>
        {fmtChg && (
          <span className={cn('text-[10px] tabular-nums', up ? 'text-gain' : 'text-loss')}>
            {fmtChg}
          </span>
        )}
      </div>
    </motion.div>
  )
}

export function MarketPulseWidget({ config }: { config: WidgetConfig }) {
  const { data: setIndices = [], isLoading: setLoading, dataUpdatedAt: setUpdatedAt } = useQuery<SetIndex[]>({
    queryKey: ['market-set-indices'],
    queryFn: () => portfolioTrackerService.getSetIndices(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const { data: globalIndices = [], isLoading: globalLoading, dataUpdatedAt: globalUpdatedAt } = useQuery<GlobalIndex[]>({
    queryKey: ['market-global-indices'],
    queryFn: () => portfolioTrackerService.getGlobalIndices(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const lastUpdated = useMemo(() => {
    const ts = Math.max(setUpdatedAt ?? 0, globalUpdatedAt ?? 0)
    return ts ? formatDistanceToNowStrict(new Date(ts), { addSuffix: true }) : null
  }, [setUpdatedAt, globalUpdatedAt])

  const isLoading = setLoading && globalLoading

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-2 overflow-auto">
      {/* Timestamp */}
      {lastUpdated && (
        <div className="flex justify-end shrink-0">
          <span className="text-[10px] text-ink-disabled">Updated {lastUpdated}</span>
        </div>
      )}

      {/* SET section */}
      {setIndices.length > 0 && (
        <div className="space-y-1 shrink-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Thai Market</span>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${setIndices.length}, minmax(0, 1fr))` }}>
            {setIndices.map(idx => (
              <IndexCard key={idx.name} name={idx.name} value={idx.value} change={idx.change} changePct={idx.changePct} />
            ))}
          </div>
        </div>
      )}

      {/* Global section */}
      {globalIndices.length > 0 && (
        <div className="space-y-1 shrink-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Global Market</span>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${globalIndices.length}, minmax(0, 1fr))` }}>
            {globalIndices.map(idx => (
              <IndexCard key={idx.name} name={idx.name} value={idx.value} change={idx.change} changePct={idx.changePct} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
