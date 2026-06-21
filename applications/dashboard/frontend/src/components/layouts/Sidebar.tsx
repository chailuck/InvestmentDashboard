'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, TrendingUp, Bot, BarChart3, Settings, SlidersHorizontal,
  ChevronLeft, ChevronRight, LogOut, X, Users, ChevronDown, FileText, ClipboardList,
  ShoppingCart, Briefcase, ArrowUpRight, FlaskConical, HardDriveDownload, GitBranch, ScanLine, Search,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import { portfolioDbService } from '@/services/portfolioDb'
import { actionPlanService } from '@/services/actionPlan'
import { weeklyScanService, type ScanListSummary } from '@/services/weeklyScan'
import dynamic from 'next/dynamic'

const AnalyticsModal = dynamic(
  () => import('@/components/analytics/AnalyticsModal').then(m => ({ default: m.AnalyticsModal })),
  { ssr: false, loading: () => null },
)

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

const NAV_TOP = [
  { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/action-plan', label: 'Action Plan', icon: ClipboardList },
  { href: '/analytics',   label: 'Analytics',   icon: BarChart3 },
  { href: '/ai-copilot',  label: 'AI Copilot',  icon: Bot, badge: 'AI' },
] as const

const SETTINGS_SUB = [
  { href: '/settings',                 label: 'My Profile',    icon: Settings },
  { href: '/settings/configuration',   label: 'Configuration', icon: SlidersHorizontal, adminOnly: true },
  { href: '/admin/users',              label: 'Users',          icon: Users,              adminOnly: true },
  { href: '/settings/documents',       label: 'Documents',      icon: FileText },
  { href: '/settings/dr-mappings',     label: 'DR Mappings',    icon: GitBranch },
  { href: '/settings/backup',          label: 'Backup',         icon: HardDriveDownload,  adminOnly: true },
  { href: '/settings/testing',         label: 'Testing',        icon: FlaskConical,        adminOnly: true },
] as const

// ── Sidebar widgets ────────────────────────────────────────────────────────────

const DOT_COLORS: Record<string, string> = {
  CYAN:   '#22d3ee',
  GREEN:  '#10b981',
  YELLOW: '#f59e0b',
  RED:    '#ef4444',
  PURPLE: '#a855f7',
}
const DOT_ORDER = ['CYAN', 'GREEN', 'YELLOW', 'RED', 'PURPLE']

function WeeklyScanWidget() {
  const [expanded, setExpanded] = useState(true)
  const [modalSymbol, setModalSymbol] = useState<string | null>(null)

  const { data: scans } = useQuery<ScanListSummary[]>({
    queryKey: ['sidebar-weekly-scans'],
    queryFn: weeklyScanService.listScans,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const latest = scans?.[0]

  const { data: scan } = useQuery({
    queryKey: ['sidebar-weekly-scan-detail', latest?.id],
    queryFn: () => weeklyScanService.getScan(latest!.id),
    staleTime: 5 * 60_000,
    enabled: !!latest,
  })

  if (!latest) return null

  const dots = (Object.entries(latest.color_counts) as [string, number][])
    .filter(([key, count]) => key !== 'NONE' && count > 0)
    .sort((a, b) => DOT_ORDER.indexOf(a[0]) - DOT_ORDER.indexOf(b[0]))

  const total = latest.total ?? Object.values(latest.color_counts).reduce((s, n) => s + n, 0)

  const cyanSymbols  = (scan?.items ?? []).filter(i => i.color_mark === 'CYAN').map(i => i.symbol)
  const greenSymbols = (scan?.items ?? []).filter(i => i.color_mark === 'GREEN').map(i => i.symbol)

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="w-3 h-3 text-brand-400 shrink-0" />
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider flex-1 truncate">
          Weekly Scan
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-ink-disabled hover:text-ink-primary transition-colors shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
        </button>
        <Link
          href={`/weekly-scan/${latest.id}`}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Open latest scan"
        >
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-1.5"
          >
            <Link href={`/weekly-scan/${latest.id}`} className="block pl-1 space-y-0.5 group">
              <div className="text-[10px] text-ink-secondary group-hover:text-ink-primary transition-colors truncate">
                {latest.name}
              </div>
              <div className="flex items-center gap-1">
                {dots.map(([key, count]) => (
                  <span key={key} className="flex items-center gap-0.5" title={`${key}: ${count}`}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DOT_COLORS[key] }} />
                    <span className="text-[9px] text-ink-muted tabular-nums">{count}</span>
                  </span>
                ))}
                <span className="text-[9px] text-ink-disabled tabular-nums ml-0.5">{total}</span>
              </div>
            </Link>

            {cyanSymbols.length > 0 && (
              <div className="pl-1 space-y-0.5">
                <p className="text-[8px] font-semibold text-cyan-400/80 uppercase tracking-wider">Potential</p>
                <p className="text-[9px] text-cyan-400 leading-relaxed break-words">
                  {cyanSymbols.map((sym, i) => (
                    <span key={sym}>
                      <button
                        onClick={() => setModalSymbol(sym)}
                        className="hover:text-brand-400 transition-colors cursor-pointer"
                        title={`Open analytics for ${sym}`}
                      >
                        {sym}
                      </button>
                      {i < cyanSymbols.length - 1 && <span className="mx-0.5">·</span>}
                    </span>
                  ))}
                </p>
              </div>
            )}

            {greenSymbols.length > 0 && (
              <div className="pl-1 space-y-0.5">
                <p className="text-[8px] font-semibold text-gain/80 uppercase tracking-wider">Good</p>
                <p className="text-[9px] text-gain leading-relaxed break-words">
                  {greenSymbols.map((sym, i) => (
                    <span key={sym}>
                      <button
                        onClick={() => setModalSymbol(sym)}
                        className="hover:text-brand-400 transition-colors cursor-pointer"
                        title={`Open analytics for ${sym}`}
                      >
                        {sym}
                      </button>
                      {i < greenSymbols.length - 1 && <span className="mx-0.5">·</span>}
                    </span>
                  ))}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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

const STRATEGY_ABBR: Record<string, string> = {
  'BREAK OUT': 'BO',
  'BUY ON DIP': 'BOD',
  'แท่งเทียนกลับตัว': 'ททกต',
  'ยยจท': 'ยยจท',
  'NEWS': 'NEWS',
  'AJ PAO': 'AJPAO',
  'OTHERS': 'OTHER',
}

function PurchasePlanWidget() {
  const [expanded, setExpanded] = useState(true)
  const [modalSymbol, setModalSymbol] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()

  const { data: plans } = useQuery({
    queryKey: ['sidebar-purchase-plans'],
    queryFn: () => actionPlanService.list('purchase', null),
    staleTime: 2 * 60_000,
  })

  const latest = plans?.[0]

  const { data: plan } = useQuery({
    queryKey: ['sidebar-purchase-plan-detail', latest?.id],
    queryFn: () => actionPlanService.get(latest!.id),
    staleTime: 2 * 60_000,
    enabled: !!latest,
  })

  if (!latest) return null

  const items = plan?.purchase_items ?? []

  const handleRefresh = async () => {
    setRefreshing(true)
    let shouldInvalidate = false
    try {
      if (!latest) return

      // Step 1: Fetch authoritative server state (bypasses React Query cache).
      // Abort if this fails — no stale data is ever written back to the server.
      const serverPlan = await actionPlanService.get(latest.id)
      shouldInvalidate = true  // server reached; invalidate cache regardless of subsequent steps

      const symbolItems = serverPlan.purchase_items.filter(item => item.stock && item.stock.trim() !== '')

      if (symbolItems.length > 0) {
        // Step 2: Fetch live prices concurrently — individual failures return null (graceful degradation).
        const priceResults = await Promise.all(
          symbolItems.map(item =>
            actionPlanService.getStockPrice(item.stock.trim())
              .then(result => ({ stock: item.stock.trim(), price: result.price }))
              .catch(() => ({ stock: item.stock.trim(), price: null as number | null }))
          )
        )

        const priceMap = new Map<string, number | null>()
        for (const r of priceResults) {
          priceMap.set(r.stock, r.price)
        }

        // Step 3: Merge — server fields authoritative, live price overwrites current_price only.
        // Spread-and-override ensures any future PurchaseItem fields are preserved automatically.
        const updatedItems = serverPlan.purchase_items.map(item => ({
          ...item,
          current_price: (item.stock && priceMap.has(item.stock.trim()) && priceMap.get(item.stock.trim()) !== null)
            ? priceMap.get(item.stock.trim())!
            : item.current_price,
        }))

        // Step 4: Persist merged result
        await actionPlanService.update(latest.id, { purchase_items: updatedItems })
      }
    } finally {
      // Step 5: Always invalidate if the server was reached, even if the write failed,
      // so the widget re-renders from the most recently known server state.
      if (shouldInvalidate) {
        await queryClient.invalidateQueries({ queryKey: ['sidebar-purchase-plan-detail'] })
        await queryClient.invalidateQueries({ queryKey: ['sidebar-purchase-plans'] })
      }
      setRefreshing(false)
    }
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <ShoppingCart className="w-3 h-3 text-brand-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Purchase</span>
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[8px] text-ink-disabled">Entry / Current</span>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Refresh prices"
        >
          <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
        </button>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-ink-disabled hover:text-ink-primary transition-colors shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
        </button>
        <Link href={`/action-plan/purchase/${latest.id}`}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Open purchase plan">
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden space-y-1.5"
        >

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-[10px] text-ink-disabled pl-4">No items</p>
      ) : (
        <div className="space-y-1.5 pl-1">
          {items.map((item, i) => {
            const hasSL  = item.sl != null
            const hasTP  = item.tp != null
            const hasBuy = item.buy_price != null
            const hasCur = item.current_price != null

            return (
              <div key={i} className="text-[10px]">
                {/* Line 1: text format */}
                <div className="flex items-center gap-1 text-[9px] tabular-nums">
                  <button
                    onClick={() => setModalSymbol(item.stock)}
                    className={cn(
                      'font-mono font-bold text-[10px] shrink-0 w-[46px] truncate text-left',
                      'hover:text-brand-400 transition-colors cursor-pointer',
                      item.triggered ? 'text-gain' : 'text-ink-secondary',
                    )}
                    title={`Open analytics for ${item.stock}`}
                  >
                    {item.stock}{item.triggered ? '✓' : ''}
                  </button>
                  <span className="text-[8px] text-ink-disabled shrink-0">Entry </span>
                  <span className="text-white font-bold shrink-0">
                    {hasBuy ? item.buy_price!.toFixed(1) : '—'}
                  </span>
                  <span className="text-ink-disabled shrink-0">/</span>
                  <span className="text-[8px] text-ink-disabled shrink-0">Current </span>
                  <span className="text-white font-bold shrink-0">
                    {hasCur ? item.current_price!.toFixed(1) : '—'}
                  </span>
                  {item.strategy && (
                    <span className="text-[8px] text-white shrink-0 ml-auto">{STRATEGY_ABBR[item.strategy] ?? item.strategy}</span>
                  )}
                </div>
                {/* Line 2: SL ← [★ ——▶ current] → TP */}
                {(hasTP || hasSL) && hasCur && (() => {
                  const range = hasTP && hasSL ? item.tp! - item.sl! : 0
                  const hasRange = range > 0
                  const curPct = hasRange
                    ? Math.max(0, Math.min(100, ((item.current_price! - item.sl!) / range) * 100))
                    : null
                  const buyPct = hasRange && hasBuy
                    ? Math.max(0, Math.min(100, ((item.buy_price! - item.sl!) / range) * 100))
                    : null
                  const isAboveBuy = hasBuy ? item.current_price! >= item.buy_price! : null
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
                          {/* Arrow line from star to current */}
                          <div
                            className="absolute top-1/2 -translate-y-1/2"
                            style={{
                              left: `${Math.min(buyPct, curPct)}%`,
                              right: `${100 - Math.max(buyPct, curPct)}%`,
                              height: '1px',
                              backgroundColor: arrowColor,
                            }}
                          />
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
                          {/* ★ star at entry price — larger */}
                          <span
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[12px] leading-none text-yellow-400"
                            style={{ left: `${buyPct}%` }}
                          >
                            ★
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9px] text-ink-disabled flex-1 text-center">
                          {item.current_price != null ? item.current_price.toFixed(1) : '—'}
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
          })}
        </div>
      )}

      {/* Latest list name link */}
      <Link
        href={`/action-plan/purchase/${latest.id}`}
        className="block text-[9px] text-ink-disabled hover:text-brand-400 transition-colors truncate pl-1"
        title={latest.name}
      >
        {latest.name}
      </Link>

        </motion.div>
        )}
      </AnimatePresence>

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

function PortfolioWidget({ isDbMode }: { isDbMode: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const [modalSymbol, setModalSymbol] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()

  // DB mode: live positions from portfolio manager
  const { data: dbPositions } = useQuery({
    queryKey: ['sidebar-portfolio-positions'],
    queryFn: () => portfolioDbService.getPositions('active'),
    staleTime: 2 * 60_000,
    enabled: isDbMode,
  })

  // Excel / fallback: latest portfolio action plan items
  const { data: planList } = useQuery({
    queryKey: ['sidebar-portfolio-plans'],
    queryFn: () => actionPlanService.list('portfolio', null),
    staleTime: 2 * 60_000,
    enabled: !isDbMode,
  })
  const latestPlan = planList?.[0]
  const { data: planDetail } = useQuery({
    queryKey: ['sidebar-portfolio-plan-detail', latestPlan?.id],
    queryFn: () => actionPlanService.get(latestPlan!.id),
    staleTime: 2 * 60_000,
    enabled: !!latestPlan && !isDbMode,
  })

  // Normalise both sources into a common row shape
  type Row = {
    key: string; symbol: string; pnlPct: number | null
    entryPrice: number | null; currentPrice: number | null
    sl: number | null; tp: number | null; link: string
  }

  const rows: Row[] = isDbMode
    ? (dbPositions ?? [])
        .filter(p => !p.parentId)
        .sort((a, b) => Math.abs(b.pnlPct) - Math.abs(a.pnlPct))
        .map(p => ({
          key: p.id,
          symbol: p.symbol,
          pnlPct: p.pnlPct,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice,
          sl: p.sl,
          tp: p.tp,
          link: '/settings/portfolio-db',
        }))
    : (planDetail?.portfolio_items ?? [])
        .map((it, i) => {
          const pnl = it.entry_price && it.current_price
            ? ((it.current_price - it.entry_price) / it.entry_price) * 100
            : null
          return {
            key: it.id ?? String(i),
            symbol: it.symbol,
            pnlPct: pnl,
            entryPrice: it.entry_price,
            currentPrice: it.current_price,
            sl: it.sl,
            tp: it.tp,
            link: latestPlan ? `/action-plan/portfolio/${latestPlan.id}` : '/action-plan',
          }
        })

  if (rows.length === 0) return null

  const linkHref = isDbMode ? '/settings/portfolio-db'
    : latestPlan ? `/action-plan/portfolio/${latestPlan.id}` : '/action-plan'

  const listLabel = isDbMode ? 'DB Portfolio' : (latestPlan?.name ?? '')

  const handleRefresh = async () => {
    setRefreshing(true)
    let shouldInvalidate = false
    try {
      if (!isDbMode && latestPlan) {
        // Fetch authoritative server state (bypasses React Query cache) before writing.
        // This prevents stale cached entry_price, sl, tp from overwriting server-side edits.
        const serverPlan = await actionPlanService.get(latestPlan.id)
        shouldInvalidate = true  // server reached; invalidate cache regardless of subsequent steps

        const symbolItems = serverPlan.portfolio_items.filter(item => item.symbol && item.symbol.trim() !== '')
        if (symbolItems.length > 0) {
          const priceResults = await Promise.all(
            symbolItems.map(item =>
              actionPlanService.getStockPrice(item.symbol.trim())
                .then(result => ({ symbol: item.symbol.trim(), price: result.price }))
                .catch(() => ({ symbol: item.symbol.trim(), price: null as number | null }))
            )
          )
          const priceMap = new Map(priceResults.map(r => [r.symbol, r.price]))
          // Spread-and-override: server fields authoritative, live price overwrites current_price only.
          const updatedItems = serverPlan.portfolio_items.map((item, i) => ({
            ...item,
            sort_order: item.sort_order ?? i,
            current_price: priceMap.has(item.symbol.trim()) ? (priceMap.get(item.symbol.trim()) ?? item.current_price) : item.current_price,
          }))
          await actionPlanService.update(latestPlan.id, { portfolio_items: updatedItems })
        }
      } else {
        // DB mode — no plan write, but always invalidate to refresh live positions
        shouldInvalidate = true
      }
    } finally {
      // Always invalidate if the server was reached (or in DB mode), even if the write failed,
      // so the widget re-renders from the most recently known server state.
      if (shouldInvalidate) {
        await queryClient.invalidateQueries({ queryKey: ['sidebar-portfolio-positions'] })
        await queryClient.invalidateQueries({ queryKey: ['sidebar-portfolio-plans'] })
        await queryClient.invalidateQueries({ queryKey: ['sidebar-portfolio-plan-detail'] })
      }
      setRefreshing(false)
    }
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Briefcase className="w-3 h-3 text-purple-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
            Portfolio <span className="text-ink-disabled font-normal">({rows.length})</span>
          </span>
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[8px] text-ink-disabled">SL ·</span>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
            <span className="text-[8px] text-ink-disabled">Buy / Price · TP</span>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Refresh prices"
        >
          <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
        </button>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-ink-disabled hover:text-ink-primary transition-colors shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
        </button>
        <Link href={linkHref}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Open portfolio">
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden space-y-1.5"
        >

      <div className="space-y-1.5 pl-1">
        {rows.map(row => {
          const isProfit = row.entryPrice !== null && row.currentPrice !== null
            ? row.currentPrice >= row.entryPrice
            : (row.pnlPct ?? 0) >= 0
          const hasSL = row.sl !== null
          const hasTP = row.tp !== null
          const showSlTp = (hasSL || hasTP) && row.currentPrice !== null
          const slTpPct = hasSL && hasTP
            ? Math.max(0, Math.min(100, ((row.currentPrice! - row.sl!) / (row.tp! - row.sl!)) * 100))
            : null
          const buyPct = hasSL && hasTP && row.entryPrice !== null
            ? Math.max(0, Math.min(100, ((row.entryPrice - row.sl!) / (row.tp! - row.sl!)) * 100))
            : null

          return (
            <div key={row.key} className="text-[10px]">
              {/* Line 1: symbol | ±pnl% | entry/current */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setModalSymbol(row.symbol)}
                  className="font-mono font-bold text-ink-secondary shrink-0 w-[52px] truncate text-left hover:text-brand-400 transition-colors cursor-pointer"
                  title={`Open analytics for ${row.symbol}`}
                >
                  {row.symbol}
                </button>
                {row.pnlPct !== null && (
                  <span className={cn(
                    'font-semibold shrink-0 w-[36px] text-right tabular-nums',
                    row.pnlPct >= 0 ? 'text-gain' : 'text-loss',
                  )}>
                    {row.pnlPct >= 0 ? '+' : ''}{row.pnlPct.toFixed(1)}%
                  </span>
                )}
                {row.entryPrice !== null && row.currentPrice !== null ? (
                  <span className="text-[9px] tabular-nums flex-1 truncate">
                    <span className="text-white">{row.entryPrice.toFixed(2)}</span>
                    <span className="text-ink-disabled mx-0.5">/</span>
                    <span className={isProfit ? 'text-gain' : 'text-loss'}>{row.currentPrice.toFixed(2)}</span>
                  </span>
                ) : row.entryPrice !== null ? (
                  <span className="text-[9px] text-ink-disabled tabular-nums flex-1">@<span className="text-white">{row.entryPrice.toFixed(2)}</span></span>
                ) : null}
              </div>

              {/* Line 2: SL ← [current marker on bar] → TP */}
              {showSlTp && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  {hasSL && (
                    <span className="text-[9px] text-loss tabular-nums shrink-0">{row.sl!.toFixed(1)}</span>
                  )}
                  <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">←</span>
                  {slTpPct !== null ? (
                    <div className="flex-1 relative h-1.5 bg-surface-overlay rounded-full mx-0.5">
                      {/* Buy price marker — purple */}
                      {buyPct !== null && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-400"
                          style={{ left: `${buyPct}%` }}
                        />
                      )}
                      {/* Current price marker — green if profit, red if loss */}
                      <div
                        className={cn('absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full', isProfit ? 'bg-gain' : 'bg-loss')}
                        style={{ left: `${slTpPct}%` }}
                      />
                    </div>
                  ) : (
                    <span className={cn('text-[9px] tabular-nums font-semibold flex-1 text-center', isProfit ? 'text-gain' : 'text-loss')}>
                      {row.currentPrice!.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[9px] text-ink-disabled shrink-0 px-0.5">→</span>
                  {hasTP && (
                    <span className="text-[9px] text-gain tabular-nums shrink-0">{row.tp!.toFixed(1)}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Latest list name link */}
      {listLabel && (
        <Link
          href={linkHref}
          className="block text-[9px] text-ink-disabled hover:text-brand-400 transition-colors truncate pl-1"
          title={listLabel}
        >
          {listLabel}
        </Link>
      )}

        </motion.div>
        )}
      </AnimatePresence>

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

// ── Main sidebar ───────────────────────────────────────────────────────────────

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, clearAuth } = useAuthStore()

  const inSettingsSection = pathname.startsWith('/settings') || pathname.startsWith('/admin')

  const [settingsOpen,  setSettingsOpen]  = useState(inSettingsSection)
  const [analyticsOpen, setAnalyticsOpen] = useState(pathname.startsWith('/analytics'))

  const { data: modeData } = useQuery({
    queryKey: ['portfolio-mode'],
    queryFn: portfolioDbService.getMode,
    staleTime: 60_000,
  })
  const isDbMode = modeData === 'db'

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
      || pathname === href

  const NavLink = ({ href, label, icon: Icon, badge }: {
    href: string; label: string; icon: React.ElementType; badge?: string
  }) => {
    const active = isActive(href)
    return (
      <Link href={href} onClick={onMobileClose} title={collapsed ? label : undefined}
        className={cn(
          'group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 relative',
          active ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                 : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
          collapsed && 'justify-center px-0',
        )}>
        {active && (
          <motion.div layoutId="active-nav"
            className="absolute inset-0 bg-brand-500/10 rounded-lg border border-brand-500/20"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
        )}
        <Icon className={cn('w-4 h-4 shrink-0 relative z-10', active && 'text-brand-400')} />
        {!collapsed && <span className="text-sm font-medium relative z-10 flex-1">{label}</span>}
        {!collapsed && badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 relative z-10">
            {badge}
          </span>
        )}
      </Link>
    )
  }

  const SubLink = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link href={href} onClick={onMobileClose}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
          active ? 'text-brand-400 bg-brand-500/10' : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
        )}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">{label}</span>
      </Link>
    )
  }

  const AccordionGroup = ({
    label, icon: Icon, active, open, onToggle: toggle, children,
  }: {
    label: string; icon: React.ElementType; active: boolean
    open: boolean; onToggle: () => void; children: React.ReactNode
  }) => (
    <div>
      <button
        onClick={() => !collapsed && toggle()}
        title={collapsed ? label : undefined}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
          active ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                 : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
          collapsed && 'justify-center px-0',
        )}>
        <Icon className={cn('w-4 h-4 shrink-0', active && 'text-brand-400')} />
        {!collapsed && (
          <>
            <span className="text-sm font-medium flex-1 text-left">{label}</span>
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && !collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden">
            <div className="ml-3 pl-3 border-l border-border/50 mt-0.5 space-y-0.5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <Link href="/dashboard" onClick={onMobileClose}
        className={cn(
          'flex items-center gap-3 px-4 h-[60px] border-b border-border/50 shrink-0 hover:bg-surface-elevated/40 transition-colors',
          collapsed && 'justify-center px-0',
        )}>
        <div className="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-brand-400" />
        </div>
        {!collapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="font-bold text-ink-primary text-sm whitespace-nowrap">
            POP Investment Planner
          </motion.span>
        )}
      </Link>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto no-scrollbar">
        <NavLink href="/dashboard" label="Dashboard" icon={LayoutDashboard} />

        <NavLink href="/portfolio" label="Portfolio" icon={TrendingUp} />

        <NavLink href="/action-plan" label="Action Plan" icon={ClipboardList} />
        <AccordionGroup
          label="Analytics" icon={BarChart3}
          active={pathname.startsWith('/analytics')}
          open={analyticsOpen}
          onToggle={() => setAnalyticsOpen(o => !o)}
        >
          <SubLink href="/analytics"             label="Search"     icon={Search} />
          <SubLink href="/analytics/pe-scanner"  label="PE Scanner" icon={ScanLine} />
        </AccordionGroup>
        <NavLink href="/ai-copilot"  label="AI Copilot"  icon={Bot} badge="AI" />

        <AccordionGroup
          label="Settings" icon={Settings}
          active={inSettingsSection}
          open={settingsOpen}
          onToggle={() => setSettingsOpen(o => !o)}
        >
          {SETTINGS_SUB
            .filter(item => !('adminOnly' in item) || !item.adminOnly || user?.role === 'admin')
            .map(({ href, label, icon: Icon }) => (
              <SubLink key={href} href={href} label={label} icon={Icon} />
            ))}
        </AccordionGroup>
      </nav>

      {/* Bottom widgets — hidden when collapsed */}
      {!collapsed && (
        <div className="shrink-0 border-t border-border/30 divide-y divide-border/20">
          <WeeklyScanWidget />
          <PurchasePlanWidget />
          <PortfolioWidget isDbMode={isDbMode} />
        </div>
      )}

      {/* User section */}
      <div className={cn('border-t border-border/50 p-3 shrink-0', collapsed && 'px-2')}>
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-purple-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {user?.name?.[0] ?? 'U'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-ink-primary truncate">{user?.name ?? 'User'}</p>
              <p className="text-[10px] text-ink-muted truncate">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={clearAuth} className="btn-icon opacity-60 hover:opacity-100" title="Sign out">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside animate={{ width: collapsed ? 60 : 240 }}
        transition={{ type: 'spring', stiffness: 500, damping: 50 }}
        className="hidden lg:flex flex-col shrink-0 bg-surface-card border-r border-border/50 relative z-20 overflow-hidden"
        style={{ minHeight: '100vh' }}>
        <SidebarContent />
        <button onClick={onToggle}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-5 h-5 rounded-full
                     bg-surface-elevated border border-border text-ink-muted hover:text-ink-primary
                     flex items-center justify-center transition-colors z-30">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={onMobileClose} />
            <motion.aside
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="fixed left-0 top-0 bottom-0 w-64 bg-surface-card border-r border-border/50 z-50 lg:hidden flex flex-col">
              <div className="absolute top-3 right-3">
                <button onClick={onMobileClose} className="btn-icon">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
