'use client'

import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PurchaseItem, PortfolioItem } from '@/services/actionPlan'
import type { WeekDay } from '@/lib/weekDates'
import { PlanCellDisplay } from './PlanCellDisplay'
import { PortfolioCellDisplay } from './PortfolioCellDisplay'

interface WeeklyPlanTableProps {
  variant: 'purchase' | 'portfolio'
  items: PurchaseItem[] | PortfolioItem[]
  weekDays: WeekDay[]
  isLoading: boolean
  isError: boolean
  hasActivePlan: boolean
  onSymbolClick: (symbol: string) => void
  priceMap: Map<string, Map<string, number>>
  isCurrentWeek: boolean
}

export function WeeklyPlanTable({
  variant,
  items,
  weekDays,
  isLoading,
  isError,
  hasActivePlan,
  onSymbolClick,
  priceMap,
  isCurrentWeek,
}: WeeklyPlanTableProps) {
  const title = variant === 'purchase' ? 'Purchase Watchlist' : 'Portfolio Positions'
  const emptyLabel = variant === 'purchase' ? 'purchase' : 'portfolio'

  // Compute once — used to identify future days relative to today
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink-primary">{title}</p>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 py-6 text-loss text-sm">
          <AlertCircle className="w-4 h-4" />
          Failed to load plan data.
        </div>
      ) : !hasActivePlan ? (
        <p className="py-6 text-sm text-ink-muted">
          No active {emptyLabel} plan found.
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-ink-muted">
          No {emptyLabel} stocks found. Add stocks to your{' '}
          <span className="capitalize">{emptyLabel}</span> Action Plan above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-3 py-2 text-left text-ink-muted font-medium whitespace-nowrap min-w-[100px]">
                  Stock
                </th>
                {weekDays.map(day => (
                  <th
                    key={day.label}
                    className={cn(
                      'px-3 py-2 text-center text-ink-muted font-medium whitespace-nowrap min-w-[160px]',
                      day.isToday && 'bg-brand-500/10 text-brand-400',
                    )}
                  >
                    {day.label} {day.dateLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variant === 'purchase'
                ? (items as PurchaseItem[]).map((item, i) => (
                    <tr
                      key={item.id ?? i}
                      className="border-b border-border/25 hover:bg-surface-elevated/40 transition-colors"
                    >
                      {/* Row header: clickable symbol + SL/TP summary */}
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal align-top"
                      >
                        <button
                          onClick={() => onSymbolClick(item.stock)}
                          className={cn(
                            'font-mono font-bold hover:text-brand-400 transition-colors cursor-pointer text-left block w-full',
                            item.triggered ? 'text-gain' : 'text-ink-secondary',
                          )}
                          title={`Open analytics for ${item.stock}`}
                        >
                          {item.stock}{item.triggered ? '✓' : ''}
                        </button>
                        {(item.sl != null || item.tp != null) && (
                          <span className="text-[9px] text-ink-disabled tabular-nums block mt-0.5">
                            {item.sl != null ? <span className="text-loss">{item.sl.toFixed(1)}</span> : '—'}
                            {' / '}
                            {item.tp != null ? <span className="text-gain">{item.tp.toFixed(1)}</span> : '—'}
                          </span>
                        )}
                      </th>
                      {weekDays.map((day, dayIdx) => {
                        const isFuture = day.date > todayMidnight
                        const dayPrice: number | null = isFuture
                          ? null
                          : day.isToday && isCurrentWeek
                            ? item.current_price
                            : priceMap.get(item.stock)?.get(day.isoDate) ?? null
                        const prevDayPrice: number | null = dayIdx === 0
                          ? null
                          : priceMap.get(item.stock)?.get(weekDays[dayIdx - 1].isoDate) ?? null
                        return (
                          <td
                            key={day.label}
                            className={cn(
                              'px-3 py-2 align-top min-w-[160px]',
                              day.isToday && 'bg-brand-500/5',
                            )}
                          >
                            {isFuture ? null : (
                              <PlanCellDisplay item={item} dayPrice={dayPrice} prevDayPrice={prevDayPrice} />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                : (items as PortfolioItem[]).map((item, i) => (
                    <tr
                      key={item.id ?? i}
                      className="border-b border-border/25 hover:bg-surface-elevated/40 transition-colors"
                    >
                      {/* Row header: clickable symbol + SL/TP summary */}
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal align-top"
                      >
                        <button
                          onClick={() => onSymbolClick(item.symbol)}
                          className="font-mono font-bold text-ink-secondary hover:text-brand-400 transition-colors cursor-pointer text-left block w-full"
                          title={`Open analytics for ${item.symbol}`}
                        >
                          {item.symbol}
                        </button>
                        {(item.sl != null || item.tp != null) && (
                          <span className="text-[9px] text-ink-disabled tabular-nums block mt-0.5">
                            {item.sl != null ? <span className="text-loss">{item.sl.toFixed(1)}</span> : '—'}
                            {' / '}
                            {item.tp != null ? <span className="text-gain">{item.tp.toFixed(1)}</span> : '—'}
                          </span>
                        )}
                      </th>
                      {weekDays.map(day => {
                        const isFuture = day.date > todayMidnight
                        const dayPrice: number | null = isFuture
                          ? null
                          : day.isToday && isCurrentWeek
                            ? item.current_price
                            : priceMap.get(item.symbol)?.get(day.isoDate) ?? null
                        return (
                          <td
                            key={day.label}
                            className={cn(
                              'px-3 py-2 align-top min-w-[160px]',
                              day.isToday && 'bg-brand-500/5',
                            )}
                          >
                            {isFuture ? null : (
                              <PortfolioCellDisplay item={item} dayPrice={dayPrice} />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
