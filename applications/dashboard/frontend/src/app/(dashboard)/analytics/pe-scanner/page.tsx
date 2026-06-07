'use client'

import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import {
  ScanLine, Loader2, AlertCircle, RefreshCw, PlayCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  weeklyScanService,
  type UserSymbolList,
  type WeekPriceEntry,
  type WeekPrices,
  type WeeklyScanItem,
  COLOR_MARKS,
} from '@/services/weeklyScan'
import { analyticsService, type AssetType } from '@/services/analytics'
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

// ── Shared sub-components ─────────────────────────────────────────────────────

function DrThbNote({ val }: { val: number | null | undefined }) {
  if (val == null) return null
  return (
    <span className="text-[9px] text-cyan-400 font-mono leading-none tabular-nums">
      ฿{val.toLocaleString('en', { maximumFractionDigits: 0 })}
    </span>
  )
}

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
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-none
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

// ── Row data shape ────────────────────────────────────────────────────────────

interface RowData {
  symbol: string
  isLoading: boolean
  isError: boolean
  refetch: () => void
  points: TimelinePoint[]
  best15: PeIndicator | null
  weekEntry: WeekPriceEntry | undefined
  isDr: boolean
  scanItem: WeeklyScanItem | null
}

// ── SymbolRow (pure display) ──────────────────────────────────────────────────

function SymbolRow({
  row,
  weekLoading,
  fetchEnabled,
  onFetch,
  onOpen,
}: {
  row: RowData
  weekLoading: boolean
  fetchEnabled: boolean
  onFetch: () => void
  onOpen: (symbol: string) => void
}) {
  const { symbol, isDr, scanItem, weekEntry, isLoading, isError, best15, points } = row
  const bestLevel = best15 ? PE_INDICATOR_LEVELS.find(l => l.key === best15) : null
  const markCfg = scanItem?.color_mark ? COLOR_MARKS.find(c => c.value === scanItem.color_mark) : null

  const fmtPrice = (v: number | null | undefined, drStyle = false) => {
    if (v == null) return <span className="text-ink-disabled">—</span>
    return (
      <span className={cn('text-xs tabular-nums font-semibold', drStyle ? 'text-amber-300' : 'text-ink-primary')}>
        {drStyle ? '$' : ''}{v.toLocaleString('en', { maximumFractionDigits: 2 })}
      </span>
    )
  }

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

      {/* Current */}
      <td className="px-3 py-2 text-right">
        {weekLoading ? (
          <span className="text-ink-disabled text-[10px]">…</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            {fmtPrice(weekEntry?.current, isDr)}
            {isDr && <DrThbNote val={weekEntry?.dr_current_thb} />}
          </div>
        )}
      </td>

      {/* Chg */}
      <td className="px-3 py-2 text-right">
        {weekLoading ? (
          <span className="text-ink-disabled text-[10px]">…</span>
        ) : weekEntry?.change_pct != null ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className={cn('text-xs font-semibold tabular-nums', weekEntry.change_pct >= 0 ? 'text-gain' : 'text-loss')}>
              {weekEntry.change_pct >= 0 ? '+' : ''}{weekEntry.change_abs?.toFixed(2) ?? ''}
            </span>
            <span className={cn('text-[10px] tabular-nums', weekEntry.change_pct >= 0 ? 'text-gain/70' : 'text-loss/70')}>
              {weekEntry.change_pct >= 0 ? '+' : ''}{weekEntry.change_pct.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="text-ink-disabled">—</span>
        )}
      </td>

      {/* Indicator (best 15w) */}
      <td className="px-3 py-2">
        {!fetchEnabled ? (
          <span className="text-[10px] text-ink-disabled">—</span>
        ) : isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-ink-muted" />
        ) : isError ? (
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
        {!fetchEnabled ? (
          <div className="flex gap-px" style={{ height: 16 }}>
            {Array.from({ length: STRIP_WEEKS }).map((_, i) => (
              <div key={i} style={{ width: 5, height: 16, backgroundColor: '#1e293b', flexShrink: 0 }} />
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex gap-px" style={{ height: 16 }}>
            {Array.from({ length: STRIP_WEEKS }).map((_, i) => (
              <div key={i} className="skeleton rounded-none" style={{ width: 5, height: 16 }} />
            ))}
          </div>
        ) : (
          <IndicatorStrip points={points} />
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <button
          onClick={() => fetchEnabled ? row.refetch() : onFetch()}
          disabled={isLoading}
          title={fetchEnabled ? 'Refresh this symbol' : 'Fetch PE data'}
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

// ── List panel ────────────────────────────────────────────────────────────────

function ListPanel({
  list,
  scanItemMap,
  weekPrices,
  weekLoading,
  fetchEnabled,
  thresholds,
  onFetch,
  onRefreshWeekPrices,
  onOpen,
}: {
  list: UserSymbolList
  scanItemMap: Map<string, WeeklyScanItem>
  weekPrices: WeekPrices | null
  weekLoading: boolean
  fetchEnabled: boolean
  thresholds: { peThreshold: number; priceThreshold: number }
  onFetch: () => void
  onRefreshWeekPrices: () => Promise<void>
  onOpen: (symbol: string) => void
}) {
  const assetType: AssetType = list.is_dr ? 'DR' : (list.market as AssetType)
  const [filterText, setFilterText] = useState('')
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'symbol', dir: 'asc' })
  const [refreshingList, setRefreshingList] = useState(false)

  const toggleSort = (col: SortCol) => {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'symbol' || col === 'color' ? 'asc' : 'desc' })
  }

  // Batch PE queries for all symbols in this list
  const peResults = useQueries({
    queries: list.symbols.map(sym => ({
      queryKey: ['pe-scanner-row', sym, assetType],
      queryFn: () => analyticsService.getPeRatio(sym, assetType),
      staleTime: 10 * 60_000,
      retry: 1,
      enabled: fetchEnabled,
    })),
  })

  const handleRefreshList = async () => {
    if (refreshingList) return
    setRefreshingList(true)
    await Promise.all([
      ...peResults.map(r => r.refetch()),
      onRefreshWeekPrices(),
    ])
    setRefreshingList(false)
  }

  // Build row data
  const allRows: RowData[] = useMemo(
    () =>
      list.symbols.map((sym, i) => {
        const result = peResults[i]
        const data = result?.data
        const points =
          data?.found && data.price_data.length
            ? computeWeeklyIndicators(data.price_data, data.data, thresholds)
            : []
        const best15 = bestIndicatorIn(points)
        const weekEntry = weekPrices?.prices[sym]
        const isDr = weekEntry?.parent_symbol != null
        return {
          symbol: sym,
          isLoading: result?.isLoading ?? false,
          isError: result?.isError ?? false,
          refetch: result?.refetch ?? (() => undefined),
          points,
          best15,
          weekEntry,
          isDr,
          scanItem: scanItemMap.get(sym) ?? null,
        }
      }),
    // peResults changes reference each render but contains stable data — key on fetchEnabled
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.symbols, peResults, weekPrices, scanItemMap, thresholds],
  )

  // Filter
  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return q ? allRows.filter(r => r.symbol.toLowerCase().includes(q)) : allRows
  }, [allRows, filterText])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sort.col) {
        case 'symbol':
          cmp = a.symbol.localeCompare(b.symbol)
          break
        case 'color':
          cmp = (a.scanItem?.color_mark ?? '').localeCompare(b.scanItem?.color_mark ?? '')
          break
        case 'indicator': {
          const ap = a.best15 ? INDICATOR_PRIORITY[a.best15] : -1
          const bp = b.best15 ? INDICATOR_PRIORITY[b.best15] : -1
          cmp = ap - bp
          break
        }
        case 'current':
          cmp = (a.weekEntry?.current ?? -Infinity) - (b.weekEntry?.current ?? -Infinity)
          break
        case 'chg':
          cmp = (a.weekEntry?.change_pct ?? -Infinity) - (b.weekEntry?.change_pct ?? -Infinity)
          break
      }
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort])

  const Th = ({ col, label, className }: { col: SortCol; label: React.ReactNode; className?: string }) => (
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

        {/* Filter input */}
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
          {!fetchEnabled ? (
            <button
              onClick={onFetch}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-brand-500/40
                         bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 transition-colors"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              Fetch PE Data
            </button>
          ) : (
            <button
              onClick={handleRefreshList}
              disabled={refreshingList}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40
                         hover:bg-surface-elevated text-ink-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshingList && 'animate-spin')} />
              Refresh List
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-surface-elevated/30">
              <Th col="symbol" label="Symbol"  className="text-left min-w-[80px]" />
              <Th col="color"  label="Color"   className="text-left" />
              <th className="px-3 py-2.5 text-left font-semibold text-ink-muted">Strategy</th>
              <Th col="current" label="Current" className="text-right min-w-[72px]" />
              <Th col="chg"   label="Chg"     className="text-right min-w-[60px]" />
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
                weekLoading={weekLoading && fetchEnabled}
                fetchEnabled={fetchEnabled}
                onFetch={onFetch}
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
  const [fetchEnabled, setFetchEnabled] = useState(false)
  const queryClient = useQueryClient()

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

  // Heavy queries — only when user triggers
  const { data: weekPrices, isLoading: weekLoading } = useQuery({
    queryKey: ['pe-scanner-week-prices', latestScanId],
    queryFn: () => weeklyScanService.getWeekPrices(latestScanId!),
    staleTime: 10 * 60_000,
    enabled: fetchEnabled && !!latestScanId,
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

  const handleFetch = useCallback(() => setFetchEnabled(true), [])

  const handleRefreshWeekPrices = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['pe-scanner-week-prices'] })
  }, [queryClient])

  const handleOpen = (symbol: string) => {
    const list = lists[activeTab]
    const assetType: AssetType = list?.is_dr ? 'DR' : ((list?.market ?? 'SET') as AssetType)
    setModalSymbol({ symbol, assetType })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-brand-400" />
          PE Scanner
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          PE indicator history per symbol list · Indicator = best in last {BEST_INDICATOR_WEEKS} weeks · Hover strip cells for week date
        </p>
      </div>

      <div className="card px-4 py-3">
        <Legend />
      </div>

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
              weekPrices={weekPrices ?? null}
              weekLoading={weekLoading}
              fetchEnabled={fetchEnabled}
              thresholds={thresholds}
              onFetch={handleFetch}
              onRefreshWeekPrices={handleRefreshWeekPrices}
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
