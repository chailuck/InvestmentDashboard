'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ObjectivePosition } from '@/services/objective'
import { ObjectiveRow } from './ObjectiveRow'

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-2 py-2 text-left text-[10px] font-semibold text-white uppercase tracking-wider whitespace-nowrap', className)}>
      {children}
    </th>
  )
}

function GroupTH({ children, colSpan, className, noBorder }: { children: string; colSpan: number; className?: string; noBorder?: boolean }) {
  return (
    <th
      colSpan={colSpan}
      className={cn(
        'px-2 py-1 text-center text-[9px] font-semibold uppercase tracking-wider',
        !noBorder && 'border-b border-border/30',
        className,
      )}
    >
      {children}
    </th>
  )
}

function sortPositions(positions: ObjectivePosition[]): ObjectivePosition[] {
  return [...positions].sort((a, b) => {
    const aOpen = a.exit_date == null ? 0 : 1
    const bOpen = b.exit_date == null ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    // Within same group: entry_date DESC (null = oldest)
    const aDate = a.entry_date ?? '0000-00-00'
    const bDate = b.entry_date ?? '0000-00-00'
    return bDate.localeCompare(aDate)
  })
}

interface Props {
  positions: ObjectivePosition[]
  loading: boolean
  queryKey: readonly unknown[]
  priceMap: Map<string, number | null>
}

export function ObjectiveTable({ positions, loading, queryKey, priceMap }: Props) {
  const sorted = sortPositions(positions)

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            {/* Group headers */}
            <tr className="border-b border-border/30">
              <GroupTH colSpan={2} className="text-white border-r border-white/20">Overall</GroupTH>
              <GroupTH colSpan={4} className="text-gain/70 border-r border-white/20">Buy</GroupTH>
              <GroupTH colSpan={4} className="text-loss/70 border-r border-white/20">Sell</GroupTH>
            </tr>
            {/* Column headers */}
            <tr className="border-b border-border/20">
              <TH className="px-3 border-r border-white/20">Symbol</TH>
              <TH className="text-right border-r border-white/20">P&L / %</TH>
              <TH>Date</TH>
              <TH>P/Size</TH>
              <TH className="min-w-[176px]">Reason</TH>
              <TH className="border-r border-white/20">Feel</TH>
              <TH>Date</TH>
              <TH>P/Size</TH>
              <TH className="min-w-[80px]">Reason</TH>
              <TH>Feel</TH>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center">
                  <div className="flex items-center justify-center gap-2 text-ink-muted text-xs">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading positions…
                  </div>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-xs text-ink-muted">
                  No positions found for this filter.
                </td>
              </tr>
            ) : sorted.map(p => (
              <ObjectiveRow
                key={p.id}
                position={p}
                queryKey={queryKey}
                priceMap={priceMap}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
