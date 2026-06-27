'use client'

import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ObjectiveFilter } from '@/services/objective'

const FILTERS: { key: ObjectiveFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: '1m',        label: '1 Month' },
  { key: '3m',        label: '3 Months' },
  { key: '6m',        label: '6 Months' },
  { key: 'week',      label: 'Last Weekday' },
  { key: 'week2',     label: 'Last 2 Weeks' },
  { key: 'no_reason', label: 'No Reason Only' },
]

interface Props {
  value: ObjectiveFilter
  onChange: (f: ObjectiveFilter) => void
  total: number
  pricesLoading: boolean
  onRefresh: () => void
}

export function ObjectiveFilterBar({ value, onChange, total, pricesLoading, onRefresh }: Props) {
  return (
    <div className="card p-3 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-ink-muted">Filter:</span>
      {FILTERS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors',
            value === key
              ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
              : 'border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
          )}
        >
          {label}
        </button>
      ))}
      <button
        onClick={onRefresh}
        disabled={pricesLoading}
        aria-label="Refresh prices"
        aria-busy={pricesLoading}
        className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', pricesLoading && 'animate-spin')} />
        Refresh Prices
      </button>
      <span className="ml-auto text-xs text-ink-muted">{total} position{total !== 1 ? 's' : ''}</span>
    </div>
  )
}
