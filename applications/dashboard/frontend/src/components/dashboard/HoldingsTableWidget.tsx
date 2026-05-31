'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { portfolioTrackerService, type Position } from '@/services/portfolioTracker'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

const fmt = (n: number, d = 2) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })

export function HoldingsTableWidget({ config }: { config: WidgetConfig }) {
  const [filter, setFilter] = useState('')
  const [analyticsSymbol, setAnalyticsSymbol] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-positions', undefined, undefined, 'active'],
    queryFn: () => portfolioTrackerService.getPositions({ status: 'active' }),
    refetchInterval: 60_000,
  })

  const positions = data?.positions ?? []
  const filtered = useMemo(
    () => filter ? positions.filter(p => p.symbol.toLowerCase().includes(filter.toLowerCase())) : positions,
    [positions, filter],
  )

  const pnlClass = (v: number) => v >= 0 ? 'text-gain font-semibold' : 'text-loss font-semibold'

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-border/30">
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by symbol…" className="input py-1.5 text-xs" />
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-8 rounded" />)}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-card">
              <tr className="border-b border-border/50 text-ink-muted">
                {['Symbol', 'Dir', 'Entry', 'Current', 'Size', 'Net P&L', '%'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-muted">No open positions.</td></tr>
              ) : filtered.map((pos: Position) => (
                <tr key={pos.id} className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setAnalyticsSymbol(pos.symbol)}
                      className="font-bold text-ink-primary hover:text-brand-400 transition-colors"
                      title={`Analytics: ${pos.symbol}`}
                    >
                      {pos.symbol}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className={pos.direction.toLowerCase().includes('short') ? 'text-loss' : 'text-gain'}>
                      {pos.direction.toLowerCase().includes('short') ? '↓S' : '↑L'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">{fmt(pos.entryPrice)}</td>
                  <td className="px-3 py-2 font-medium text-ink-primary">{fmt(pos.currentPrice)}</td>
                  <td className="px-3 py-2 text-ink-secondary">{pos.positionSize.toLocaleString()}</td>
                  <td className={cn('px-3 py-2', pnlClass(pos.netPnl))}>
                    {pos.netPnl >= 0 ? '+' : ''}{fmt(pos.netPnl, 0)}
                  </td>
                  <td className={cn('px-3 py-2', pnlClass(pos.pnlPct))}>
                    {pos.pnlPct >= 0 ? '+' : ''}{fmt(pos.pnlPct)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {analyticsSymbol && (
          <AnalyticsModal
            symbol={analyticsSymbol}
            assetType="SET"
            onClose={() => setAnalyticsSymbol(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
