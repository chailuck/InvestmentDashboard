'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Rows3, Columns3 } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { actionPlanService, type PurchaseItem, type PortfolioItem } from '@/services/actionPlan'
import { portfolioDbService } from '@/services/portfolioDb'
import { getWeekDays } from '@/lib/weekDates'
import { WeeklyPlanTable, type WeeklyPlanViewMode } from './WeeklyPlanTable'

const AnalyticsModal = dynamic(
  () => import('@/components/analytics/AnalyticsModal').then(m => ({ default: m.AnalyticsModal })),
  { ssr: false, loading: () => null },
)

export function WeeklyPlanDashboard() {
  const [modalSymbol, setModalSymbol] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState<number>(0)
  const [viewMode, setViewMode] = useState<WeeklyPlanViewMode>('by-date')

  const weekDays = getWeekDays(weekOffset)
  const dateFrom = weekDays[0].isoDate
  const dateTo   = weekDays[4].isoDate

  // Validate symbol against SET/DR ticker format before opening modal
  function handleSymbolClick(symbol: string) {
    if (/^[A-Z0-9\-\.]{1,12}$/i.test(symbol)) {
      setModalSymbol(symbol.toUpperCase())
    }
  }

  // ── Purchase plan queries (same cache keys as sidebar) ──────────────────────
  const { data: purchasePlans, isLoading: purchasePlansLoading, isError: purchasePlansError } = useQuery({
    queryKey: ['sidebar-purchase-plans'],
    queryFn: () => actionPlanService.list('purchase', null),
    staleTime: 2 * 60_000,
  })

  const latestPurchaseId = purchasePlans?.[0]?.id

  const { data: purchasePlan, isLoading: purchaseDetailLoading, isError: purchaseDetailError } = useQuery({
    queryKey: ['sidebar-purchase-plan-detail', latestPurchaseId],
    queryFn: () => actionPlanService.get(latestPurchaseId!),
    staleTime: 2 * 60_000,
    enabled: !!latestPurchaseId,
  })

  // ── Portfolio mode — determines data source for Portfolio Positions ──────────
  const { data: portfolioMode } = useQuery({
    queryKey: ['portfolio-mode'],
    queryFn: portfolioDbService.getMode,
    staleTime: 5 * 60_000,
  })
  const isDbMode = portfolioMode === 'db'

  // ── Portfolio plan queries (used in Excel mode only) ─────────────────────────
  const { data: portfolioPlans, isLoading: portfolioPlansLoading, isError: portfolioPlansError } = useQuery({
    queryKey: ['sidebar-portfolio-plans'],
    queryFn: () => actionPlanService.list('portfolio', null),
    staleTime: 2 * 60_000,
    enabled: portfolioMode === 'excel',
  })

  const latestPortfolioId = portfolioPlans?.[0]?.id

  const { data: portfolioPlan, isLoading: portfolioDetailLoading, isError: portfolioDetailError } = useQuery({
    queryKey: ['sidebar-portfolio-plan-detail', latestPortfolioId],
    queryFn: () => actionPlanService.get(latestPortfolioId!),
    staleTime: 2 * 60_000,
    enabled: !!latestPortfolioId && portfolioMode === 'excel',
  })

  // ── DB portfolio positions (used in DB mode) ─────────────────────────────────
  const { data: dbPositions, isLoading: dbPositionsLoading, isError: dbPositionsError } = useQuery({
    queryKey: ['portfolio-db-positions-weekly', 'active'],
    queryFn: () => portfolioDbService.getPositions('active'),
    staleTime: 60_000,
    enabled: isDbMode,
  })

  const purchaseItems: PurchaseItem[] = purchasePlan?.purchase_items ?? []

  // In DB mode: map active DB positions to PortfolioItem shape
  const portfolioItems: PortfolioItem[] = useMemo(() => {
    if (isDbMode) {
      return (dbPositions ?? []).map((p, idx) => ({
        id: p.id,
        sort_order: idx,
        symbol: p.symbol,
        current_price: p.currentPrice,
        size: p.positionSize,
        entry_price: p.entryPrice,
        tp: p.tp,
        sl: p.sl,
        order_size: p.positionSize,
      }))
    }
    return portfolioPlan?.portfolio_items ?? []
  }, [isDbMode, dbPositions, portfolioPlan])

  const isPurchaseLoading = purchasePlansLoading || purchaseDetailLoading
  const isPurchaseError   = purchasePlansError || purchaseDetailError
  const isPortfolioLoading = isDbMode ? dbPositionsLoading : (portfolioPlansLoading || portfolioDetailLoading)
  const isPortfolioError   = isDbMode ? dbPositionsError : (portfolioPlansError || portfolioDetailError)

  // ── Derive all unique symbols from plan data ────────────────────────────────
  const uniqueSymbols = useMemo(() => {
    const all = [
      ...purchaseItems.map(i => i.stock),
      ...portfolioItems.map(i => i.symbol),
    ].filter(Boolean)
    return [...new Set(all)]
  }, [purchaseItems, portfolioItems])

  // ── Price history query for the selected week ───────────────────────────────
  const { data: priceHistoryData, isLoading: priceHistoryLoading } = useQuery({
    queryKey: ['weekly-price-history', weekOffset, uniqueSymbols.slice().sort().join(','), dateFrom],
    queryFn: () => actionPlanService.getPriceHistory(uniqueSymbols, dateFrom, dateTo),
    staleTime: 5 * 60_000,
    enabled: uniqueSymbols.length > 0,
  })

  const priceMap = useMemo<Map<string, Map<string, number>>>(() => {
    const map = new Map<string, Map<string, number>>()
    if (!priceHistoryData?.prices) return map
    for (const [sym, daily] of Object.entries(priceHistoryData.prices)) {
      map.set(sym, new Map(Object.entries(daily)))
    }
    return map
  }, [priceHistoryData])

  // ── Live price fetch for today's column (avoids stale item.current_price) ──
  const [livePriceMap, setLivePriceMap] = useState<Map<string, number>>(new Map())

  const fetchLivePrices = useCallback(async () => {
    if (uniqueSymbols.length === 0) return
    const results = await Promise.allSettled(
      uniqueSymbols.map(sym =>
        actionPlanService.getStockPrice(sym).then(r => ({ sym, price: r.price })),
      ),
    )
    const map = new Map<string, number>()
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.price != null) {
        map.set(r.value.sym, r.value.price)
      }
    }
    setLivePriceMap(map)
  }, [uniqueSymbols])

  const symbolKey = uniqueSymbols.slice().sort().join(',')
  useEffect(() => {
    fetchLivePrices()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/50 flex items-center gap-3 flex-wrap">
        <CalendarDays className="w-4 h-4 text-brand-400 shrink-0" />
        <h2 className="text-sm font-semibold text-ink-primary flex-1 min-w-0">Weekly Plan Dashboard</h2>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-surface-elevated rounded-lg p-0.5 border border-border/40">
          <button
            onClick={() => setViewMode('by-stock')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              viewMode === 'by-stock'
                ? 'bg-brand-500/20 text-brand-400'
                : 'text-ink-muted hover:text-ink-primary',
            )}
            title="By Stock — rows are stocks, columns are dates"
          >
            <Rows3 className="w-3 h-3" />
            By Stock
          </button>
          <button
            onClick={() => setViewMode('by-date')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              viewMode === 'by-date'
                ? 'bg-brand-500/20 text-brand-400'
                : 'text-ink-muted hover:text-ink-primary',
            )}
            title="By Date — rows are dates, columns are stocks"
          >
            <Columns3 className="w-3 h-3" />
            By Date
          </button>
        </div>

        {/* Week selector */}
        <div className="flex items-center gap-1 text-xs text-ink-muted">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            disabled={weekOffset <= -52}
            className="p-1 rounded hover:bg-surface-elevated/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="tabular-nums min-w-[110px] text-center">
            {weekDays[0].dateLabel} – {weekDays[4].dateLabel}
            {weekOffset === 0 && <span className="text-ink-disabled ml-1">(this week)</span>}
          </span>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            disabled={weekOffset >= 0}
            className="p-1 rounded hover:bg-surface-elevated/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tables */}
      <div className="px-5 py-4 space-y-6">
        <WeeklyPlanTable
          variant="purchase"
          items={purchaseItems}
          weekDays={weekDays}
          isLoading={isPurchaseLoading || priceHistoryLoading}
          isError={isPurchaseError}
          hasActivePlan={!!latestPurchaseId}
          onSymbolClick={handleSymbolClick}
          priceMap={priceMap}
          livePriceMap={livePriceMap}
          isCurrentWeek={weekOffset === 0}
          viewMode={viewMode}
        />

        <WeeklyPlanTable
          variant="portfolio"
          items={portfolioItems}
          weekDays={weekDays}
          isLoading={isPortfolioLoading || priceHistoryLoading}
          isError={isPortfolioError}
          hasActivePlan={isDbMode ? true : !!latestPortfolioId}
          onSymbolClick={handleSymbolClick}
          priceMap={priceMap}
          livePriceMap={livePriceMap}
          isCurrentWeek={weekOffset === 0}
          viewMode={viewMode}
        />
      </div>

      {/* Analytics modal */}
      <AnimatePresence>
        {modalSymbol && (
          <AnalyticsModal
            symbol={modalSymbol}
            assetType="SET"
            onClose={() => setModalSymbol(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
