'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { portfolioTrackerService, type SetIndex, type GlobalIndex } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

function PulseDot({ positive }: { positive: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span
        className={cn(
          'animate-ping absolute inline-flex h-2 w-2 rounded-full opacity-75',
          positive ? 'bg-gain' : 'bg-loss',
        )}
      />
      <span
        className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          positive ? 'bg-gain' : 'bg-loss',
        )}
      />
    </span>
  )
}

interface IndexPillProps {
  name: string
  value: number | null
  changePct: number | null
}

function IndexPill({ name, value, changePct }: IndexPillProps) {
  const isPositive = (changePct ?? 0) >= 0
  const fmtValue = value != null
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
  const fmtPct = changePct != null
    ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
    : '—'

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs shrink-0',
        'bg-surface-elevated border-border/40',
      )}
    >
      <PulseDot positive={isPositive} />
      <span className="font-semibold text-ink-secondary">{name}</span>
      <span className="text-ink-primary tabular-nums">{fmtValue}</span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums',
          isPositive ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss',
        )}
      >
        {fmtPct}
      </span>
    </div>
  )
}

export function MarketPulseWidget({ config }: { config: WidgetConfig }) {
  const fetchedAt = useMemo(() => new Date(), [])

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
    if (!ts) return null
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true })
  }, [setUpdatedAt, globalUpdatedAt])

  const isLoading = setLoading && globalLoading

  if (isLoading) {
    return <div className="skeleton h-full m-4 rounded-lg" />
  }

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-1.5">
      {/* Header row with timestamp */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
          Market Indices
        </span>
        {lastUpdated && (
          <span className="text-[10px] text-ink-disabled">
            Updated {lastUpdated}
          </span>
        )}
      </div>

      {/* SET indices row */}
      <div className="flex flex-wrap gap-1.5">
        {setIndices.length === 0 ? (
          <span className="text-[10px] text-ink-disabled italic">No SET data</span>
        ) : (
          setIndices.map((idx) => (
            <IndexPill
              key={idx.name}
              name={idx.name}
              value={idx.value}
              changePct={idx.changePct}
            />
          ))
        )}
      </div>

      {/* Global indices row */}
      <div className="flex flex-wrap gap-1.5">
        {globalIndices.length === 0 ? (
          <span className="text-[10px] text-ink-disabled italic">No global data</span>
        ) : (
          globalIndices.map((idx) => (
            <IndexPill
              key={idx.name}
              name={idx.name}
              value={idx.value}
              changePct={idx.changePct}
            />
          ))
        )}
      </div>
    </div>
  )
}
