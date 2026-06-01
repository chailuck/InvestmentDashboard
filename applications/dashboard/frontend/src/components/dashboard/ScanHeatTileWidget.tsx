'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { weeklyScanService, colorMarkMeta } from '@/services/weeklyScan'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

export function ScanHeatTileWidget({ config }: { config: WidgetConfig }) {
  // Step 1: fetch scan list (sorted by created_at desc from API)
  const { data: scans = [], isLoading: scansLoading } = useQuery({
    queryKey: ['weekly-scan-list'],
    queryFn: () => weeklyScanService.listScans(),
    staleTime: 5 * 60_000,
  })

  const latestScan = scans[0] ?? null

  // Step 2: fetch full scan items once we have the scan id
  const { data: scanDetail, isLoading: scanDetailLoading } = useQuery({
    queryKey: ['weekly-scan-detail', latestScan?.id],
    queryFn: () => weeklyScanService.getScan(latestScan!.id),
    enabled: !!latestScan,
    staleTime: 5 * 60_000,
  })

  // Step 3: fetch active positions
  const { data: positionsData, isLoading: positionsLoading } = useQuery({
    queryKey: ['portfolio-positions', undefined, undefined, 'active'],
    queryFn: () => portfolioTrackerService.getPositions({ status: 'active' }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const isLoading = scansLoading || scanDetailLoading || positionsLoading

  // Step 4: compute intersection
  const matched = useMemo(() => {
    if (!scanDetail || !positionsData) return []
    const posMap = new Map(
      positionsData.positions.map((p) => [p.symbol.toUpperCase(), p]),
    )
    return scanDetail.items
      .filter((item) => posMap.has(item.symbol.toUpperCase()))
      .map((item) => ({
        item,
        position: posMap.get(item.symbol.toUpperCase())!,
      }))
  }, [scanDetail, positionsData])

  if (isLoading) {
    return <div className="skeleton h-full m-4 rounded-lg" />
  }

  if (!latestScan || !scanDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        <p className="text-sm text-ink-muted">No weekly scan found</p>
        <p className="text-xs text-ink-disabled">Create a weekly scan to see your picks here.</p>
      </div>
    )
  }

  if (matched.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-3 pt-2 pb-1.5 border-b border-border/30 shrink-0">
          <p
            className="text-xs font-semibold text-ink-primary truncate"
            title={scanDetail.name}
          >
            {scanDetail.name}
          </p>
          <p className="text-[10px] text-ink-muted">0 picks in portfolio</p>
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-4">
          <p className="text-sm text-ink-muted">No scan picks in portfolio</p>
          <p className="text-xs text-ink-disabled">
            Symbols from the latest scan will appear here when they match an active position.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-2 pb-1.5 border-b border-border/30 shrink-0">
        <p
          className="text-xs font-semibold text-ink-primary truncate"
          title={scanDetail.name}
        >
          {scanDetail.name}
        </p>
        <p className="text-[10px] text-ink-muted">{matched.length} picks in portfolio</p>
      </div>

      {/* Tiles */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {matched.map(({ item, position }) => {
            const meta = colorMarkMeta(item.color_mark)
            const pnlPct = position.pnlPct
            const isPositive = pnlPct >= 0

            return (
              <div
                key={item.symbol}
                className={cn(
                  'rounded-lg border px-2 py-2 flex flex-col gap-0.5',
                  meta
                    ? cn(meta.bg, meta.border)
                    : 'bg-surface-elevated border-border/40',
                )}
              >
                <span
                  className={cn(
                    'font-bold font-mono text-xs leading-tight truncate',
                    meta ? meta.text : 'text-ink-primary',
                  )}
                  title={item.symbol}
                >
                  {item.symbol}
                </span>
                <span
                  className={cn(
                    'text-[11px] font-semibold tabular-nums leading-tight',
                    isPositive ? 'text-gain' : 'text-loss',
                  )}
                >
                  {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
                </span>
                {meta && (
                  <span className={cn('text-[9px] leading-none', meta.text)}>
                    {meta.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
