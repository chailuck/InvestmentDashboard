'use client'

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ScanLine, AlertCircle, RefreshCw, PlayCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Search, Clock, Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  weeklyScanService,
  type UserSymbolList,
  type WeeklyScanItem,
  type PeScanCachedEntry,
  type PeScanResultItem,
  COLOR_MARKS,
} from '@/services/weeklyScan'
import { analyticsService, type AssetType, type PeRatioData, type SearchResult } from '@/services/analytics'
import { appConfigService } from '@/services/appConfig'
import { INDICATOR_CONFIG } from '@/config/indicators'
import {
  computeWeeklyIndicators,
  INDICATOR_DOT,
  PE_INDICATOR_LEVELS,
  type PeIndicator,
  type TimelinePoint,
} from '@/lib/peIndicator'

const AnalyticsModal = dynamic(
  () => import('@/components/analytics/AnalyticsModal').then(m => ({ default: m.AnalyticsModal })),
  { ssr: false, loading: () => null },
)

const STRIP_WEEKS = 36
const BEST_INDICATOR_WEEKS = 15

const STRATEGY_ICON_MAP: Record<string, string> = {
  'BREAK OUT':         '🚀',
  'BUY ON DIP':        '📉',
  'แท่งเทียนกลับตัว': '🕯️',
  'ยยจท':             '📈',
  'NEWS':              '📰',
  'AJ PAO':            '🎯',
  'OTHERS':            '✦',
}

const INDICATOR_PRIORITY: Record<PeIndicator, number> = {
  very_good: 5, good: 4, normal: 3, bad: 2, very_bad: 1,
}

function bestIndicatorIn(points: TimelinePoint[], weeks = BEST_INDICATOR_WEEKS): PeIndicator | null {
  const slice = points.slice(-weeks)
  if (!slice.length) return null
  return slice.reduce(
    (b, pt) => (INDICATOR_PRIORITY[pt.state] > INDICATOR_PRIORITY[b.state] ? pt : b),
    slice[0],
  ).state
}

type SortCol = 'symbol' | 'color' | 'indicator' | 'current' | 'chg'

// ── Sub-components ────────────────────────────────────────────────────────────

function IndicatorStrip({ points }: { points: TimelinePoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const last36 = points.slice(-STRIP_WEEKS)
  if (!last36.length) return <span className="text-[10px] text-ink-disabled">No data</span>
  return (
    <div className="flex gap-px items-stretch" style={{ height: 16 }}>
      {last36.map((pt, i) => {
        const isHov = hovered === i
        const level = PE_INDICATOR_LEVELS.find(l => l.key === pt.state)
        return (
          <div
            key={pt.date}
            className="relative cursor-default"
            style={{ width: 5, flexShrink: 0, backgroundColor: INDICATOR_DOT[pt.state], opacity: isHov ? 1 : 0.85 }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {isHov && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-none
                             bg-surface-card border border-border/60 rounded px-2 py-1 text-[10px]
                             whitespace-nowrap shadow-lg"
                   style={{ color: INDICATOR_DOT[pt.state] }}
              >
                <div className="font-semibold">{level?.label}</div>
                <div className="text-ink-muted">{pt.date.slice(0, 10)}</div>
                {pt.peChg != null && (
                  <div className="text-ink-disabled">PE {pt.peChg >= 0 ? '+' : ''}{pt.peChg.toFixed(1)}%</div>
                )}
                <div className="text-ink-disabled">Price {pt.priceChg >= 0 ? '+' : ''}{pt.priceChg.toFixed(1)}%</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SortIcon({ col, sort }: { col: SortCol; sort: { col: SortCol; dir: 'asc' | 'desc' } }) {
  if (sort.col !== col) return <ArrowUpDown className="w-3 h-3 ml-0.5 opacity-30" />
  return sort.dir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-0.5 text-brand-400" />
    : <ArrowDown className="w-3 h-3 ml-0.5 text-brand-400" />
}

// ── Row data ──────────────────────────────────────────────────────────────────

interface RowData {
  symbol: string
  isLoading: boolean
  isErrorPe: boolean
  points: TimelinePoint[]
  best15: PeIndicator | null
  currentPrice: number | null
  changePct: number | null
  isDr: boolean
  scanItem: WeeklyScanItem | null
  isCached: boolean  // data is from DB cache (not a live query)
}

// ── SymbolRow ─────────────────────────────────────────────────────────────────

function SymbolRow({
  row,
  onRefresh,
  onOpen,
}: {
  row: RowData
  onRefresh: (sym: string) => void
  onOpen: (sym: string) => void
}) {
  const { symbol, isDr, scanItem, isLoading, isErrorPe, best15, points, currentPrice, changePct, isCached } = row
  const bestLevel = best15 ? PE_INDICATOR_LEVELS.find(l => l.key === best15) : null
  const markCfg = scanItem?.color_mark ? COLOR_MARKS.find(c => c.value === scanItem.color_mark) : null

  return (
    <tr className="border-b border-border/20 hover:bg-surface-elevated/40 transition-colors">
      {/* Symbol */}
      <td className="px-3 py-2">
        <button
          onClick={() => onOpen(symbol)}
          className="font-mono font-bold text-xs text-ink-primary hover:text-brand-400 transition-colors"
        >
          {symbol}
        </button>
        {isCached && !isLoading && (
          <div className="text-[9px] text-ink-disabled leading-none mt-0.5">cached</div>
        )}
      </td>

      {/* Color */}
      <td className="px-3 py-2">
        {markCfg ? (
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', markCfg.bg, markCfg.text, markCfg.border)}>
            {markCfg.label}
          </span>
        ) : (
          <span className="text-ink-disabled text-[10px]">—</span>
        )}
      </td>

      {/* Strategy */}
      <td className="px-3 py-2">
        {scanItem?.strategy ? (
          <span className="flex items-center gap-1">
            <span className="text-sm leading-none">{STRATEGY_ICON_MAP[scanItem.strategy] ?? '✦'}</span>
            <span className="text-[10px] text-ink-secondary">{scanItem.strategy}</span>
          </span>
        ) : (
          <span className="text-[10px] text-ink-disabled">—</span>
        )}
      </td>

      {/* Current price */}
      <td className="px-3 py-2 text-right">
        {isLoading ? (
          <span className="text-ink-disabled text-[10px]">…</span>
        ) : currentPrice != null ? (
          <span className={cn('text-xs tabular-nums font-semibold', isDr ? 'text-amber-300' : 'text-ink-primary')}>
            {currentPrice.toLocaleString('en', { maximumFractionDigits: 2 })}
          </span>
        ) : (
          <span className="text-ink-disabled">—</span>
        )}
      </td>

      {/* Chg% */}
      <td className="px-3 py-2 text-right">
        {isLoading ? (
          <span className="text-ink-disabled text-[10px]">…</span>
        ) : changePct != null ? (
          <span className={cn('text-xs font-semibold tabular-nums', changePct >= 0 ? 'text-gain' : 'text-loss')}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        ) : (
          <span className="text-ink-disabled">—</span>
        )}
      </td>

      {/* Best indicator (15w) */}
      <td className="px-3 py-2">
        {isLoading ? (
          <span className="text-[10px] text-ink-disabled">…</span>
        ) : isErrorPe ? (
          <span className="text-[10px] text-ink-disabled">No PE</span>
        ) : bestLevel ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: INDICATOR_DOT[bestLevel.key] }} />
            <span className="text-[10px] font-semibold" style={{ color: INDICATOR_DOT[bestLevel.key] }}>
              {bestLevel.label}
            </span>
          </span>
        ) : (
          <span className="text-[10px] text-ink-disabled">—</span>
        )}
      </td>

      {/* 36-week strip */}
      <td className="px-3 py-2">
        {isLoading ? (
          <div className="flex gap-px" style={{ height: 16 }}>
            {Array.from({ length: STRIP_WEEKS }).map((_, i) => (
              <div key={i} className="skeleton rounded-none" style={{ width: 5, height: 16 }} />
            ))}
          </div>
        ) : points.length > 0 ? (
          <IndicatorStrip points={points} />
        ) : (
          <div className="flex gap-px" style={{ height: 16 }}>
            {Array.from({ length: STRIP_WEEKS }).map((_, i) => (
              <div key={i} style={{ width: 5, height: 16, backgroundColor: '#1e293b', flexShrink: 0 }} />
            ))}
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <button
          onClick={() => onRefresh(symbol)}
          disabled={isLoading}
          title="Refresh this symbol"
          className="flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors
                     border-border/40 text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary disabled:opacity-40"
        >
          <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </td>
    </tr>
  )
}

// ── ListPanel ─────────────────────────────────────────────────────────────────

function ListPanel({
  list,
  scanItemMap,
  thresholds,
  onRefreshed,
  onOpen,
}: {
  list: UserSymbolList
  scanItemMap: Map<string, WeeklyScanItem>
  thresholds: { peThreshold: number; priceThreshold: number }
  onRefreshed: (refreshedAt: string) => void
  onOpen: (symbol: string) => void
}) {
  const assetType: AssetType = list.is_dr ? 'DR' : (list.market as AssetType)
  const queryClient = useQueryClient()

  const [filterText, setFilterText] = useState('')
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'symbol', dir: 'asc' })
  // Tracks which symbols are currently being fetched (for loading display)
  const [loadingSymbols, setLoadingSymbols] = useState<Set<string>>(new Set())
  const [fetchingAll, setFetchingAll] = useState(false)
  // savingRef prevents double-saves for the same in-flight symbol
  const savingRef = useRef<Set<string>>(new Set())

  const toggleSort = (col: SortCol) =>
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'symbol' || col === 'color' ? 'asc' : 'desc' })

  // ── Load cached results from DB ───────────────────────────────────────────
  const { data: cached } = useQuery({
    queryKey: ['pe-scan-cache', list.id],
    queryFn: () => weeklyScanService.getPeScanResults(list.id),
    staleTime: Infinity,  // never auto-refetch; only invalidated after save
  })

  // Surface last_refreshed to parent on initial cache load
  useEffect(() => {
    if (cached?.last_refreshed) {
      onRefreshed(cached.last_refreshed)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached?.last_refreshed])

  const cachedMap = useMemo<Map<string, PeScanCachedEntry>>(() => {
    if (!cached?.results?.length) return new Map()
    return new Map(cached.results.map(r => [r.symbol, r]))
  }, [cached])

  // ── Helpers to read from / write to query cache ───────────────────────────

  const getRowData = useCallback((sym: string): { points: TimelinePoint[]; best15: PeIndicator | null; price: number | null; changePct: number | null } => {
    const peData = queryClient.getQueryData<PeRatioData>(['pe-scanner-row', sym, assetType])
    const priceData = queryClient.getQueryData<SearchResult>(['pe-scanner-price', sym, assetType])
    const points = peData?.found && peData.price_data.length
      ? computeWeeklyIndicators(peData.price_data, peData.data, thresholds)
      : []
    return {
      points,
      best15: bestIndicatorIn(points),
      price: priceData?.price ?? null,
      changePct: priceData?.change_pct ?? null,
    }
  }, [assetType, queryClient, thresholds])

  const buildSaveItem = useCallback((sym: string): PeScanResultItem => {
    const { points, best15, price, changePct } = getRowData(sym)
    return { symbol: sym, indicator: best15, current_price: price, change_pct: changePct, points: points as object[] }
  }, [getRowData])

  const saveToDb = useCallback(async (items: PeScanResultItem[]) => {
    if (!items.length) return
    try {
      const { refreshed_at } = await weeklyScanService.savePeScanResults(list.id, items)
      onRefreshed(refreshed_at)
      queryClient.invalidateQueries({ queryKey: ['pe-scan-cache', list.id] })
    } catch (err) {
      console.error('PE scan save failed', err)
    }
  }, [list.id, onRefreshed, queryClient])

  // ── Per-row refresh ───────────────────────────────────────────────────────

  const handleRefreshRow = useCallback(async (sym: string) => {
    if (savingRef.current.has(sym)) return
    savingRef.current.add(sym)
    setLoadingSymbols(prev => new Set([...prev, sym]))

    try {
      await Promise.allSettled([
        queryClient.fetchQuery({
          queryKey: ['pe-scanner-row', sym, assetType],
          queryFn: () => analyticsService.getPeRatio(sym, assetType),
          staleTime: 0,
        }),
        queryClient.fetchQuery({
          queryKey: ['pe-scanner-price', sym, assetType],
          queryFn: () => analyticsService.search(sym, assetType),
          staleTime: 0,
        }),
      ])
      await saveToDb([buildSaveItem(sym)])
    } finally {
      savingRef.current.delete(sym)
      setLoadingSymbols(prev => { const n = new Set(prev); n.delete(sym); return n })
    }
  }, [assetType, queryClient, buildSaveItem, saveToDb])

  // ── Fetch / refresh all ───────────────────────────────────────────────────

  const handleRefreshAll = useCallback(async () => {
    if (fetchingAll) return
    setFetchingAll(true)
    setLoadingSymbols(new Set(list.symbols))

    try {
      await Promise.allSettled(
        list.symbols.flatMap(sym => [
          queryClient.fetchQuery({
            queryKey: ['pe-scanner-row', sym, assetType],
            queryFn: () => analyticsService.getPeRatio(sym, assetType),
            staleTime: 0,
          }),
          queryClient.fetchQuery({
            queryKey: ['pe-scanner-price', sym, assetType],
            queryFn: () => analyticsService.search(sym, assetType),
            staleTime: 0,
          }),
        ])
      )
      await saveToDb(list.symbols.map(sym => buildSaveItem(sym)))
    } finally {
      setFetchingAll(false)
      setLoadingSymbols(new Set())
    }
  }, [fetchingAll, list.symbols, assetType, queryClient, buildSaveItem, saveToDb])

  // ── Build row data (live cache + DB cache) ────────────────────────────────

  const allRows: RowData[] = useMemo(() =>
    list.symbols.map(sym => {
      const isLoading = loadingSymbols.has(sym)

      // Prefer live query cache; fall back to DB-cached entry
      const livePe  = queryClient.getQueryData<PeRatioData>(['pe-scanner-row', sym, assetType])
      const livePrice = queryClient.getQueryData<SearchResult>(['pe-scanner-price', sym, assetType])
      const dbEntry  = cachedMap.get(sym)

      let points: TimelinePoint[]
      let best15: PeIndicator | null
      let currentPrice: number | null
      let changePct: number | null
      let isCached = false

      if (livePe !== undefined || livePrice !== undefined) {
        // Live query data is in the cache
        const pd = livePe
        points = pd?.found && pd.price_data.length
          ? computeWeeklyIndicators(pd.price_data, pd.data, thresholds)
          : []
        best15 = bestIndicatorIn(points)
        currentPrice = livePrice?.price ?? null
        changePct = livePrice?.change_pct ?? null
      } else if (dbEntry) {
        // Fall back to persisted DB cache
        points = dbEntry.points as TimelinePoint[]
        best15 = (dbEntry.indicator as PeIndicator | null)
        currentPrice = dbEntry.current_price
        changePct = dbEntry.change_pct
        isCached = true
      } else {
        points = []
        best15 = null
        currentPrice = null
        changePct = null
      }

      return {
        symbol: sym,
        isLoading,
        isErrorPe: false,
        points,
        best15,
        currentPrice,
        changePct,
        isDr: list.is_dr,
        scanItem: scanItemMap.get(sym) ?? null,
        isCached,
      }
    }),
    // loadingSymbols changes trigger re-render; queryClient cache changes need explicit subscription
    // We intentionally re-compute on every render when loading is active
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.symbols, list.is_dr, loadingSymbols, cachedMap, scanItemMap, thresholds, assetType],
  )

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return q ? allRows.filter(r => r.symbol.toLowerCase().includes(q)) : allRows
  }, [allRows, filterText])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sort.col) {
      case 'symbol':    cmp = a.symbol.localeCompare(b.symbol); break
      case 'color':     cmp = (a.scanItem?.color_mark ?? '').localeCompare(b.scanItem?.color_mark ?? ''); break
      case 'indicator': {
        const ap = a.best15 ? INDICATOR_PRIORITY[a.best15] : -1
        const bp = b.best15 ? INDICATOR_PRIORITY[b.best15] : -1
        cmp = ap - bp; break
      }
      case 'current': cmp = (a.currentPrice ?? -Infinity) - (b.currentPrice ?? -Infinity); break
      case 'chg':     cmp = (a.changePct ?? -Infinity) - (b.changePct ?? -Infinity); break
    }
    return sort.dir === 'asc' ? cmp : -cmp
  }), [filtered, sort])

  // ── Render ────────────────────────────────────────────────────────────────

  const hasData = cachedMap.size > 0 || loadingSymbols.size > 0

  const Th = ({ col, label, className }: { col: SortCol; label: ReactNode; className?: string }) => (
    <th
      className={cn('px-3 py-2.5 font-semibold text-ink-muted cursor-pointer select-none hover:text-ink-primary transition-colors', className)}
      onClick={() => toggleSort(col)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon col={col} sort={sort} />
      </span>
    </th>
  )

  return (
    <div className="card overflow-hidden">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wider shrink-0">
          {list.name} · {list.symbols.length} symbols
          <span className="ml-2 font-normal normal-case text-ink-muted">{list.market}{list.is_dr ? ' · DR' : ''}</span>
        </span>

        {/* Filter */}
        <div className="relative flex-1 min-w-[140px] max-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-disabled" />
          <input
            type="text"
            placeholder="Filter symbols…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[11px] bg-surface-elevated border border-border/40 rounded-md
                       text-ink-primary placeholder:text-ink-disabled focus:outline-none focus:border-brand-500/50"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRefreshAll}
            disabled={fetchingAll}
            className={cn(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
              hasData
                ? 'border-border/40 hover:bg-surface-elevated text-ink-secondary disabled:opacity-50'
                : 'border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400',
            )}
          >
            {hasData
              ? <><RefreshCw className={cn('w-3.5 h-3.5', fetchingAll && 'animate-spin')} />Refresh All</>
              : <><PlayCircle className="w-3.5 h-3.5" />Fetch All</>
            }
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-surface-elevated/30">
              <Th col="symbol" label="Symbol"    className="text-left min-w-[72px]" />
              <Th col="color"  label="Color"     className="text-left" />
              <th className="px-3 py-2.5 text-left font-semibold text-ink-muted">Strategy</th>
              <Th col="current" label="Current"  className="text-right min-w-[72px]" />
              <Th col="chg"    label="Chg"       className="text-right min-w-[60px]" />
              <Th col="indicator" label={
                <span>
                  Indicator
                  <span className="ml-1 text-[9px] font-normal text-ink-disabled">best {BEST_INDICATOR_WEEKS}w</span>
                </span>
              } className="text-left min-w-[88px]" />
              <th className="px-3 py-2.5 text-left font-semibold text-ink-muted">
                Overall · Last {STRIP_WEEKS}w →
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-ink-muted w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <SymbolRow
                key={row.symbol}
                row={row}
                onRefresh={handleRefreshRow}
                onOpen={onOpen}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && filterText && (
          <div className="px-4 py-6 text-center text-xs text-ink-disabled">
            No symbols match &ldquo;{filterText}&rdquo;
          </div>
        )}
      </div>
    </div>
  )
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {PE_INDICATOR_LEVELS.map(l => (
        <div key={l.key} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.dot }} />
          <span className="text-[10px] font-semibold" style={{ color: l.dot }}>{l.label}</span>
          <span className="text-[10px] text-ink-disabled">{l.desc}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PeScannerPage() {
  const [activeTab, setActiveTab] = useState(0)
  const [modalSymbol, setModalSymbol] = useState<{ symbol: string; assetType: AssetType } | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)

  const handleRefreshed = useCallback((refreshedAt: string) => {
    setLastRefreshed(refreshedAt)
  }, [])

  // Lightweight queries — always auto-fetch
  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: ['pe-scanner-symbol-lists'],
    queryFn: weeklyScanService.getSymbolLists,
    staleTime: 5 * 60_000,
  })

  const { data: scans } = useQuery({
    queryKey: ['pe-scanner-scans'],
    queryFn: weeklyScanService.listScans,
    staleTime: 5 * 60_000,
  })
  const latestScanId = scans?.[0]?.id

  const { data: latestScan } = useQuery({
    queryKey: ['pe-scanner-latest-scan', latestScanId],
    queryFn: () => weeklyScanService.getScan(latestScanId!),
    staleTime: 5 * 60_000,
    enabled: !!latestScanId,
  })

  const scanItemMap = useMemo<Map<string, WeeklyScanItem>>(() => {
    if (!latestScan?.items) return new Map()
    return new Map(latestScan.items.map(it => [it.symbol, it]))
  }, [latestScan])

  const { data: globalCfg } = useQuery({
    queryKey: ['app-config'],
    queryFn: appConfigService.get,
    staleTime: 60_000,
  })
  const thresholds = {
    peThreshold:    globalCfg?.pe_threshold    ?? INDICATOR_CONFIG.peThreshold,
    priceThreshold: globalCfg?.price_threshold ?? INDICATOR_CONFIG.priceThreshold,
  }

  const activeList = lists[activeTab]

  const handleOpen = (symbol: string) => {
    const list = lists[activeTab]
    const assetType: AssetType = list?.is_dr ? 'DR' : ((list?.market ?? 'SET') as AssetType)
    setModalSymbol({ symbol, assetType })
  }

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en', { dateStyle: 'short', timeStyle: 'medium' })
    } catch { return iso }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-brand-400" />
            PE Scanner
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Indicator = best in last {BEST_INDICATOR_WEEKS} weeks · Results saved to DB after each fetch
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {lastRefreshed ? (
            <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
              <Save className="w-3 h-3 text-brand-400" />
              <span>Saved {formatTime(lastRefreshed)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-ink-disabled">
              <Clock className="w-3 h-3" />
              <span>No saved data yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="card px-4 py-3">
        <Legend />
      </div>

      {/* Tabs + panel */}
      {listsLoading ? (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-8 w-24 rounded-lg" />)}
        </div>
      ) : lists.length === 0 ? (
        <div className="card p-8 text-center">
          <AlertCircle className="w-8 h-8 text-ink-muted mx-auto mb-3" />
          <p className="text-sm text-ink-muted">No symbol lists found. Create lists in the Weekly Scan settings.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 flex-wrap border-b border-border/40 pb-0 -mb-px">
            {lists.map((list, i) => (
              <button
                key={list.id}
                onClick={() => setActiveTab(i)}
                className={cn(
                  'px-4 py-2 text-xs font-semibold rounded-t-lg border border-b-0 transition-colors',
                  i === activeTab
                    ? 'bg-surface-card border-border/60 text-ink-primary'
                    : 'bg-surface-elevated/40 border-transparent text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
                )}
              >
                {list.name}
                <span className="ml-1.5 text-[10px] text-ink-disabled">{list.symbols.length}</span>
              </button>
            ))}
          </div>

          {activeList && (
            <ListPanel
              key={activeList.id}
              list={activeList}
              scanItemMap={scanItemMap}
              thresholds={thresholds}
              onRefreshed={handleRefreshed}
              onOpen={handleOpen}
            />
          )}
        </>
      )}

      {modalSymbol && (
        <AnalyticsModal
          symbol={modalSymbol.symbol}
          assetType={modalSymbol.assetType}
          onClose={() => setModalSymbol(null)}
        />
      )}
    </div>
  )
}
