'use client'

import { cn } from '@/lib/utils'
import type { PortfolioItem } from '@/services/actionPlan'

interface PortfolioCellDisplayProps {
  item: PortfolioItem
  dayPrice: number | null
  compact?: boolean
}

export function PortfolioCellDisplay({ item, dayPrice, compact = false }: PortfolioCellDisplayProps) {
  const effectivePrice = dayPrice
  const hasEntry = item.entry_price != null
  const hasCur   = effectivePrice != null
  const hasSL    = item.sl != null
  const hasTP    = item.tp != null

  const isProfit = hasEntry && hasCur
    ? effectivePrice! >= item.entry_price!
    : null

  const pnlPct = hasEntry && hasCur
    ? ((effectivePrice! - item.entry_price!) / item.entry_price!) * 100
    : null

  const range   = hasSL && hasTP ? item.tp! - item.sl! : 0
  const showSlTp = (hasSL || hasTP) && hasCur

  const slTpPct = hasSL && hasTP && range > 0
    ? Math.max(0, Math.min(100, ((effectivePrice! - item.sl!) / range) * 100))
    : null

  const buyPct = hasSL && hasTP && range > 0 && hasEntry
    ? Math.max(0, Math.min(100, ((item.entry_price! - item.sl!) / range) * 100))
    : null

  const textSize = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <div className={cn('space-y-0.5', textSize)}>
      {/* Line 1: ±pnl% | entry/current */}
      <div className="flex items-center gap-1.5 tabular-nums">
        {pnlPct !== null && (
          <span className={cn(
            'font-semibold shrink-0 tabular-nums',
            pnlPct >= 0 ? 'text-gain' : 'text-loss',
          )}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
          </span>
        )}
        {hasEntry && hasCur ? (
          <span className="text-[9px] text-ink-disabled tabular-nums flex-1 truncate">
            {item.entry_price!.toFixed(2)}
            <span className="mx-0.5">/</span>
            <span className={cn(isProfit ? 'text-gain' : 'text-loss')}>
              {effectivePrice!.toFixed(2)}
            </span>
          </span>
        ) : hasEntry ? (
          <span className="text-[9px] text-ink-disabled tabular-nums flex-1">
            @{item.entry_price!.toFixed(2)}
          </span>
        ) : null}
      </div>

      {/* Line 2: SL ← [bar with entry marker + current marker] → TP */}
      {showSlTp && (
        <div className="flex items-center gap-0.5 mt-0.5">
          {hasSL && (
            <span className="text-[9px] text-loss tabular-nums shrink-0">{item.sl!.toFixed(1)}</span>
          )}
          <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">←</span>
          {slTpPct !== null ? (
            <div className="flex-1 relative h-1.5 bg-surface-overlay rounded-full mx-0.5">
              {/* Entry price marker — purple dot */}
              {buyPct !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-400"
                  style={{ left: `${buyPct}%` }}
                />
              )}
              {/* Current price marker — green if profit, red if loss */}
              <div
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full',
                  isProfit ? 'bg-gain' : 'bg-loss',
                )}
                style={{ left: `${slTpPct}%` }}
              />
            </div>
          ) : (
            <span className={cn(
              'text-[9px] tabular-nums font-semibold flex-1 text-center',
              isProfit ? 'text-gain' : 'text-loss',
            )}>
              {effectivePrice!.toFixed(2)}
            </span>
          )}
          <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">→</span>
          {hasTP && (
            <span className="text-[9px] text-gain tabular-nums shrink-0">{item.tp!.toFixed(1)}</span>
          )}
        </div>
      )}
    </div>
  )
}
