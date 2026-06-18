'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PurchaseItem } from '@/services/actionPlan'

const STRATEGY_ABBR: Record<string, string> = {
  'BREAK OUT': 'BO',
  'BUY ON DIP': 'BOD',
  'แท่งเทียนกลับตัว': 'ททกต',
  'ยยจท': 'ยยจท',
  'NEWS': 'NEWS',
  'AJ PAO': 'AJPAO',
  'OTHERS': 'OTHER',
}

interface PlanCellDisplayProps {
  item: PurchaseItem
  dayPrice: number | null
  prevDayPrice: number | null
  compact?: boolean
}

export function PlanCellDisplay({ item, dayPrice, prevDayPrice = null, compact = false }: PlanCellDisplayProps) {
  const effectivePrice = dayPrice
  const hasSL  = item.sl != null
  const hasTP  = item.tp != null
  const hasBuy = item.buy_price != null
  const hasCur = effectivePrice != null
  const range  = hasSL && hasTP ? item.tp! - item.sl! : 0
  const buyPct = range > 0 && hasBuy ? Math.max(0, Math.min(100, ((item.buy_price! - item.sl!) / range) * 100)) : null
  const curPct = range > 0 && hasCur ? Math.max(0, Math.min(100, ((effectivePrice! - item.sl!) / range) * 100)) : null
  const showBar = hasSL && hasTP && (buyPct !== null || curPct !== null)

  const textSize = compact ? 'text-[9px]' : 'text-[10px]'

  const changePct =
    prevDayPrice != null && prevDayPrice !== 0 && dayPrice != null
      ? ((dayPrice - prevDayPrice) / prevDayPrice) * 100
      : null

  const changePctLabel =
    changePct === null
      ? null
      : Math.abs(changePct) < 0.005
      ? '0.0%'
      : changePct > 0
      ? `+${changePct.toFixed(1)}%`
      : `${changePct.toFixed(1)}%`

  const changeColor =
    changePct === null
      ? ''
      : changePct >= 0
      ? 'text-gain'
      : 'text-loss'

  return (
    <div className={cn('space-y-0.5', textSize)}>
      {/* Line 1: %change | TARGET | buy_price / CURR | effective_price | strategy */}
      <div className="flex items-center gap-1 tabular-nums">
        {changePctLabel !== null && (
          <span className={cn('font-semibold shrink-0', changeColor)}>
            {changePctLabel}
          </span>
        )}
        <span className="text-[8px] text-ink-disabled shrink-0">TARGET:</span>
        <span className="text-yellow-300 font-bold shrink-0">
          {hasBuy ? item.buy_price!.toFixed(1) : '—'}
        </span>
        <span className="text-ink-disabled shrink-0">/</span>
        <span className="text-[8px] text-ink-disabled shrink-0">CURR:</span>
        <span className="text-white font-bold shrink-0">
          {hasCur ? effectivePrice!.toFixed(1) : '—'}
        </span>
        {item.strategy && (
          <span className="text-[8px] text-ink-disabled shrink-0 ml-auto">
            {STRATEGY_ABBR[item.strategy] ?? item.strategy}
          </span>
        )}
      </div>

      {/* Line 2: position bar */}
      {showBar && (
        <div className="flex items-center gap-0.5 mt-0.5">
          <span className="text-[9px] text-loss tabular-nums shrink-0">{item.sl!.toFixed(1)}</span>
          <span className="text-[9px] text-ink-disabled shrink-0">←</span>
          <div className="flex-1 relative h-1.5 bg-surface-overlay rounded-full mx-0.5">
            {/* White line from current price to buy price */}
            {buyPct !== null && curPct !== null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 h-0.5 bg-white/50"
                style={{
                  left: `${Math.min(buyPct, curPct)}%`,
                  width: `${Math.abs(buyPct - curPct)}%`,
                }}
              />
            )}
            {/* Current price — white dot */}
            {curPct !== null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white"
                style={{ left: `${curPct}%` }}
              />
            )}
            {/* Buy price — yellow star */}
            {buyPct !== null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                style={{ left: `${buyPct}%` }}
              >
                <Star className="w-3 h-3 text-yellow-300 fill-yellow-300" />
              </div>
            )}
          </div>
          <span className="text-[9px] text-ink-disabled shrink-0">→</span>
          <span className="text-[9px] text-gain tabular-nums shrink-0">{item.tp!.toFixed(1)}</span>
        </div>
      )}
    </div>
  )
}
