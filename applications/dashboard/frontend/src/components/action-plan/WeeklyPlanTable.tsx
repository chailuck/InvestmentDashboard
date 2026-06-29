'use client'

import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PurchaseItem, PortfolioItem } from '@/services/actionPlan'
import type { WeekDay } from '@/lib/weekDates'
import { PlanCellDisplay } from './PlanCellDisplay'
import { PortfolioCellDisplay } from './PortfolioCellDisplay'

export type WeeklyPlanViewMode = 'by-stock' | 'by-date'

interface WeeklyPlanTableProps {
  variant: 'purchase' | 'portfolio'
  items: PurchaseItem[] | PortfolioItem[]
  weekDays: WeekDay[]
  isLoading: boolean
  isError: boolean
  hasActivePlan: boolean
  onSymbolClick: (symbol: string) => void
  priceMap: Map<string, Map<string, number>>
  livePriceMap?: Map<string, number>
  isCurrentWeek: boolean
  viewMode?: WeeklyPlanViewMode
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
  livePriceMap,
  isCurrentWeek,
  viewMode = 'by-stock',
}: WeeklyPlanTableProps) {
  const title = variant === 'purchase' ? 'Purchase Watchlist' : 'Portfolio Positions'
  const emptyLabel = variant === 'purchase' ? 'purchase' : 'portfolio'

  // Compute once — used to identify future days relative to today
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  // ── Shared: resolve the display price for a given item + day ─────────────────
  function getDayPrice(symbol: string, currentPrice: number | null, day: WeekDay): number | null {
    const isFuture = day.date > todayMidnight
    if (isFuture) return null
    if (day.isToday && isCurrentWeek) {
      // Prefer live-fetched price over stale stored current_price
      return livePriceMap?.get(symbol) ?? currentPrice
    }
    return priceMap.get(symbol)?.get(day.isoDate) ?? null
  }

  function getPrevDayPrice(symbol: string, dayIdx: number): number | null {
    if (dayIdx === 0) return null
    return priceMap.get(symbol)?.get(weekDays[dayIdx - 1].isoDate) ?? null
  }

  // ── Guard states ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <div className="flex items-center gap-2 py-6 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <div className="flex items-center gap-2 py-6 text-loss text-sm">
          <AlertCircle className="w-4 h-4" />
          Failed to load plan data.
        </div>
      </div>
    )
  }

  if (!hasActivePlan) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <p className="py-6 text-sm text-ink-muted">No active {emptyLabel} plan found.</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <p className="py-6 text-sm text-ink-muted">
          No {emptyLabel} stocks found. Add stocks to your{' '}
          <span className="capitalize">{emptyLabel}</span> Action Plan above.
        </p>
      </div>
    )
  }

  // ── By-Stock view (default) — rows = stocks, columns = Mon–Fri ──────────────
  if (viewMode === 'by-stock') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink-primary">{title}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: `${160 + weekDays.length * 165}px` }}>
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
                      <th scope="row" className="px-3 py-2 text-left font-normal align-top">
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
                        const dayPrice = getDayPrice(item.stock, item.current_price, day)
                        const prevDayPrice = getPrevDayPrice(item.stock, dayIdx)
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
                      <th scope="row" className="px-3 py-2 text-left font-normal align-top">
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
                      {weekDays.map((day, dayIdx) => {
                        const isFuture = day.date > todayMidnight
                        const dayPrice = getDayPrice(item.symbol, item.current_price, day)
                        const prevDayPrice = getPrevDayPrice(item.symbol, dayIdx)
                        return (
                          <td
                            key={day.label}
                            className={cn(
                              'px-3 py-2 align-top min-w-[160px]',
                              day.isToday && 'bg-brand-500/5',
                            )}
                          >
                            {isFuture ? null : (
                              <PortfolioCellDisplay item={item} dayPrice={dayPrice} prevDayPrice={prevDayPrice} />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── By-Date view — rows = Mon–Fri, columns = stocks (chunked into rows of 5, always 5 cols wide) ─
  const CHUNK_SIZE = 5
  // Fixed table width: date col (90px) + 5 stock cols (160px each)
  const BY_DATE_TABLE_WIDTH = 90 + CHUNK_SIZE * 160

  function chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }

  const purchaseItems = variant === 'purchase' ? (items as PurchaseItem[]) : []
  const portfolioItems = variant === 'portfolio' ? (items as PortfolioItem[]) : []

  const purchaseChunks = chunk(purchaseItems, CHUNK_SIZE)
  const portfolioChunks = chunk(portfolioItems, CHUNK_SIZE)
  const chunks = variant === 'purchase' ? purchaseChunks : portfolioChunks

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink-primary">{title}</p>
      <div className="space-y-4">
        {chunks.map((chunkItems, chunkIdx) => {
          // Pad chunk to always have exactly CHUNK_SIZE slots
          const padCount = CHUNK_SIZE - chunkItems.length
          return (
            <div key={chunkIdx} className="overflow-x-auto">
              <table
                className="w-full text-xs border-collapse"
                style={{ minWidth: `${BY_DATE_TABLE_WIDTH}px` }}
              >
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-3 py-2 text-left text-ink-muted font-medium whitespace-nowrap w-[90px]">
                      Date
                    </th>
                    {variant === 'purchase'
                      ? (chunkItems as PurchaseItem[]).map((item, i) => (
                          <th
                            key={item.id ?? i}
                            className="px-3 py-2 text-center text-ink-muted font-medium whitespace-nowrap w-[160px]"
                          >
                            <button
                              onClick={() => onSymbolClick(item.stock)}
                              className={cn(
                                'font-mono font-bold hover:text-brand-400 transition-colors cursor-pointer',
                                item.triggered ? 'text-gain' : 'text-ink-secondary',
                              )}
                              title={`Open analytics for ${item.stock}`}
                            >
                              {item.stock}{item.triggered ? '✓' : ''}
                            </button>
                            {(item.sl != null || item.tp != null) && (
                              <span className="text-[9px] text-ink-disabled tabular-nums block mt-0.5">
                                {item.tp != null ? <span className="text-gain">TP: {item.tp.toFixed(1)}</span> : null}
                                {item.tp != null && item.sl != null ? <span className="mx-0.5"> / </span> : null}
                                {item.sl != null ? <span className="text-loss">SL: {item.sl.toFixed(1)}</span> : null}
                              </span>
                            )}
                          </th>
                        ))
                      : (chunkItems as PortfolioItem[]).map((item, i) => (
                          <th
                            key={item.id ?? i}
                            className="px-3 py-2 text-center text-ink-muted font-medium whitespace-nowrap w-[160px]"
                          >
                            <button
                              onClick={() => onSymbolClick(item.symbol)}
                              className="font-mono font-bold text-ink-secondary hover:text-brand-400 transition-colors cursor-pointer"
                              title={`Open analytics for ${item.symbol}`}
                            >
                              {item.symbol}
                            </button>
                            {(item.sl != null || item.tp != null) && (
                              <span className="text-[9px] text-ink-disabled tabular-nums block mt-0.5">
                                {item.tp != null ? <span className="text-gain">TP: {item.tp.toFixed(1)}</span> : null}
                                {item.tp != null && item.sl != null ? <span className="mx-0.5"> / </span> : null}
                                {item.sl != null ? <span className="text-loss">SL: {item.sl.toFixed(1)}</span> : null}
                              </span>
                            )}
                          </th>
                        ))}
                    {/* Blank padding columns to always fill 5 */}
                    {Array.from({ length: padCount }).map((_, i) => (
                      <th key={`pad-${i}`} className="w-[160px]" />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekDays.map((day, dayIdx) => {
                    const isFuture = day.date > todayMidnight
                    return (
                      <tr
                        key={day.label}
                        className={cn(
                          'border-b border-border/25 transition-colors',
                          day.isToday ? 'bg-brand-500/5 hover:bg-brand-500/8' : 'hover:bg-surface-elevated/40',
                        )}
                      >
                        {/* Date column */}
                        <th
                          scope="row"
                          className={cn(
                            'px-3 py-2 text-left font-medium whitespace-nowrap align-top w-[90px]',
                            day.isToday ? 'text-brand-400' : 'text-ink-muted',
                          )}
                        >
                          <span className="block text-xs">{day.label}</span>
                          <span className="block text-[10px] text-ink-disabled font-normal">{day.dateLabel}</span>
                        </th>
                        {/* One cell per stock in this chunk */}
                        {variant === 'purchase'
                          ? (chunkItems as PurchaseItem[]).map((item, i) => {
                              const dayPrice = getDayPrice(item.stock, item.current_price, day)
                              const prevDayPrice = getPrevDayPrice(item.stock, dayIdx)
                              return (
                                <td
                                  key={item.id ?? i}
                                  className="px-3 py-2 align-top w-[160px]"
                                >
                                  {isFuture ? null : (
                                    <PlanCellDisplay item={item} dayPrice={dayPrice} prevDayPrice={prevDayPrice} />
                                  )}
                                </td>
                              )
                            })
                          : (chunkItems as PortfolioItem[]).map((item, i) => {
                              const dayPrice = getDayPrice(item.symbol, item.current_price, day)
                              const prevDayPrice = getPrevDayPrice(item.symbol, dayIdx)
                              return (
                                <td
                                  key={item.id ?? i}
                                  className="px-3 py-2 align-top w-[160px]"
                                >
                                  {isFuture ? null : (
                                    <PortfolioCellDisplay item={item} dayPrice={dayPrice} prevDayPrice={prevDayPrice} />
                                  )}
                                </td>
                              )
                            })}
                        {/* Blank padding cells */}
                        {Array.from({ length: padCount }).map((_, i) => (
                          <td key={`pad-${i}`} className="w-[160px]" />
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
