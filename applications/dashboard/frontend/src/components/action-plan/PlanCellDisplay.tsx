'use client'

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
      {/* Line 1: Buy: 22.3 | Current: 22.0 | Change: +2.3% */}
      <div className="flex items-center gap-1 tabular-nums flex-wrap">
        {changePctLabel !== null && (
          <>
            <span className="text-ink-disabled shrink-0">|</span>
            <span className="text-white shrink-0">CHNG:</span>
            <span className={cn('font-semibold shrink-0', changeColor)}>{changePctLabel}</span>
          </>
        )}
        <span className="text-white shrink-0">BUY:</span>
        <span className="text-yellow font-bold shrink-0">
          {hasBuy ? item.buy_price!.toFixed(1) : '—'}
        </span>
        <span className="text-ink-disabled shrink-0">|</span>
        <span className="text-white shrink-0">CURR</span>
        <span className="text-white font-bold shrink-0">
          {hasCur ? effectivePrice!.toFixed(1) : '—'}
        </span>
        {item.strategy && (
          <span className="text-white shrink-0 ml-auto">
            {STRATEGY_ABBR[item.strategy] ?? item.strategy}
          </span>
        )}
      </div>

      {/* Line 2: SL ← [★ ——▶ current] → TP */}
      {(hasTP || hasSL) && hasCur && (() => {
        const range = hasTP && hasSL ? item.tp! - item.sl! : 0
        const hasRange = range > 0
        const curPct = hasRange
          ? Math.max(0, Math.min(100, ((effectivePrice! - item.sl!) / range) * 100))
          : null
        const buyPct = hasRange && hasBuy
          ? Math.max(0, Math.min(100, ((item.buy_price! - item.sl!) / range) * 100))
          : null
        const isAboveBuy = hasBuy && effectivePrice != null ? effectivePrice >= item.buy_price! : null
        const arrowColor = isAboveBuy === null ? '#6b7280' : isAboveBuy ? '#10b981' : '#ef4444'
        return (
          <div className="flex items-center gap-0.5 mt-0.5">
            {hasSL && (
              <span className="text-[9px] text-loss tabular-nums shrink-0">{item.sl!.toFixed(1)}</span>
            )}
            <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">←</span>
            {curPct !== null && buyPct !== null ? (
              <div className="flex-1 relative mx-0.5" style={{ height: '18px' }}>
                {/* Background highlight bar — same as portfolio */}
                <div className="absolute left-0 right-0 h-1.5 bg-surface-overlay rounded-full top-1/2 -translate-y-1/2" />
                {/* Arrow line from star to current (overlays bar) */}
                <div
                  className="absolute top-1/2 -translate-y-1/2"
                  style={{
                    left: `${Math.min(buyPct, curPct)}%`,
                    right: `${100 - Math.max(buyPct, curPct)}%`,
                    height: '1px',
                    backgroundColor: arrowColor,
                  }}
                />
                {/* Arrowhead at current price */}
                {Math.abs(curPct - buyPct) > 0.5 && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 text-[7px] leading-none font-bold"
                    style={{
                      left: `${curPct}%`,
                      transform: curPct >= buyPct
                        ? 'translateY(-50%) translateX(-100%)'
                        : 'translateY(-50%)',
                      color: arrowColor,
                    }}
                  >
                    {curPct >= buyPct ? '▶' : '◀'}
                  </span>
                )}
                {/* ★ star at entry price — sits on the bar */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[15px] leading-none text-yellow-400"
                  style={{ left: `${buyPct}%` }}
                >
                  ★
                </span>
              </div>
            ) : (
              <span className="text-[9px] text-ink-disabled flex-1 text-center">
                {effectivePrice != null ? effectivePrice.toFixed(1) : '—'}
              </span>
            )}
            <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">→</span>
            {hasTP && (
              <span className="text-[9px] text-gain tabular-nums shrink-0">{item.tp!.toFixed(1)}</span>
            )}
          </div>
        )
      })()}
    </div>
  )
}
