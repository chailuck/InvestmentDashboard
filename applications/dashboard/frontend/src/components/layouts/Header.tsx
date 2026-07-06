'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Search, RefreshCw, Menu, Wifi, WifiOff, Wallet, TrendingUp, TrendingDown, Percent, Activity, Layers } from 'lucide-react'
import { useWebSocket } from '@/websocket/hooks'
import { useNotificationStore } from '@/store/notifications'
import {
  portfolioTrackerService,
  type SetIndex,
  type GlobalIndex,
} from '@/services/portfolioTracker'
import { investmentTransactionService } from '@/services/investmentTransaction'
import { portfolioDbService } from '@/services/portfolioDb'
import { cn } from '@/lib/utils'

interface HeaderProps {
  onMobileMenuOpen: () => void
  pageTitle?: string
}

export function Header({ onMobileMenuOpen, pageTitle = 'Dashboard' }: HeaderProps) {
  const { isConnected } = useWebSocket()
  const { notifications, markAllRead } = useNotificationStore()
  const [notifOpen, setNotifOpen] = useState(false)

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <header className="h-[60px] bg-surface-card/80 backdrop-blur-sm border-b border-border/50 flex items-center px-4 gap-3 shrink-0 sticky top-0 z-30">
      {/* Mobile menu button */}
      <button onClick={onMobileMenuOpen} className="btn-icon lg:hidden">
        <Menu className="w-4 h-4" />
      </button>

      {/* Page title (small screens only) */}
      <div className="flex-1 min-w-0 hidden sm:block lg:hidden">
        <h1 className="text-sm font-semibold text-ink-primary truncate">{pageTitle}</h1>
      </div>

      {/* Portfolio summary indicators */}
      <div className="hidden lg:flex items-center shrink-0 border-r border-border/30 pr-3 mr-1">
        <PortfolioIndicators />
      </div>

      {/* Market ticker strip — two-row layout */}
      <div className="hidden lg:flex items-center justify-center flex-1 min-w-0 overflow-hidden py-1">
        <MarketTicker />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* Live status */}
        <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium', isConnected ? 'text-gain' : 'text-ink-muted')}>
          {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          <span className="hidden sm:block">{isConnected ? 'Live' : 'Offline'}</span>
          {isConnected && <span className="live-dot" />}
        </div>

        {/* Search */}
        <button className="btn-icon" title="Search (⌘K)">
          <Search className="w-4 h-4" />
        </button>

        {/* Refresh */}
        <button className="btn-icon" title="Refresh data">
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            className="btn-icon relative"
            onClick={() => setNotifOpen(!notifOpen)}
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-loss text-white text-[10px] flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-10 w-80 card p-0 overflow-hidden z-50"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                    <span className="text-sm font-semibold text-ink-primary">Notifications</span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-center text-ink-muted text-sm py-8">No notifications</p>
                    ) : (
                      notifications.slice(0, 10).map(n => (
                        <NotificationItem key={n.id} notification={n} />
                      ))
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  )
}

// ── Portfolio summary indicators ───────────────────────────────────────────────

function PortfolioIndicators() {
  const { data: txData } = useQuery({
    queryKey: ['inv-balance-widget-tx'],
    queryFn: () => investmentTransactionService.list({}),
    staleTime: 120_000,
    refetchInterval: 5 * 60_000,
  })

  const { data: trackerSummary, isLoading } = useQuery({
    queryKey: ['portfolio-tracker-summary-alltime'],
    queryFn: () => portfolioTrackerService.getSummary({}),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })

  const { data: dbSummary } = useQuery({
    queryKey: ['portfolio-db-summary'],
    queryFn: portfolioDbService.getSummary,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })

  if (isLoading || !txData || !trackerSummary) {
    return (
      <div className="flex items-center gap-3">
        {['Total', 'P&L', 'P&L%', 'Open P&L', 'Total Port'].map(n => (
          <div key={n} className="flex items-center gap-1">
            <span className="text-[10px] text-ink-muted">{n}</span>
            <span className="skeleton w-14 h-2.5 rounded" />
          </div>
        ))}
      </div>
    )
  }

  const netInvestment = txData.summary.net_investment
  const accumulatedPnl = trackerSummary.accumulated_pnl
  const openPnl      = dbSummary?.openPnl ?? 0
  const totalValue   = netInvestment + accumulatedPnl
  const totalWithOpen = totalValue + openPnl
  const totalPnl     = accumulatedPnl
  const totalPnlPct  = netInvestment !== 0 ? (accumulatedPnl / netInvestment) * 100 : 0

  const isUp     = totalPnl >= 0
  const openIsUp = openPnl >= 0
  const pnlHex    = isUp ? '#22C55E' : '#EF4444'
  const openHex   = openIsUp ? '#22C55E' : '#EF4444'
  const sign = (n: number) => n >= 0 ? '+' : ''
  const PnlIcon  = isUp ? TrendingUp : TrendingDown
  const OpenIcon = openIsUp ? TrendingUp : TrendingDown

  const fmt = (n: number) =>
    Math.abs(n) >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : Math.abs(n) >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : n.toFixed(0)

  const pnlChipStyle: React.CSSProperties = {
    background: isUp ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
    border: `1px solid ${isUp ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 9px',
    flexShrink: 0,
  }

  const totalChipStyle: React.CSSProperties = {
    background: '#1C2333',
    border: '1px solid rgba(42,52,80,0.6)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 9px',
    flexShrink: 0,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '8.5px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#334155',
    fontWeight: 500,
    lineHeight: 1,
  }

  const valueStyle = (color: string): React.CSSProperties => ({
    fontSize: '12px',
    fontWeight: 700,
    color,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    lineHeight: 1,
    marginTop: '2px',
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {/* Total chip */}
      <div style={totalChipStyle}>
        <Wallet style={{ width: 14, height: 14, color: '#60A5FA', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={labelStyle}>Total</span>
          <span style={valueStyle('#E2E8F0')}>฿{fmt(totalValue)}</span>
        </div>
      </div>

      {/* P&L chip */}
      <div style={pnlChipStyle}>
        <PnlIcon style={{ width: 14, height: 14, color: pnlHex, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={labelStyle}>P&amp;L</span>
          <span style={valueStyle(pnlHex)}>{sign}฿{fmt(totalPnl)}</span>
        </div>
      </div>

      {/* P&L% chip */}
      <div style={pnlChipStyle}>
        <Percent style={{ width: 14, height: 14, color: pnlHex, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={labelStyle}>P&amp;L%</span>
          <span style={valueStyle(pnlHex)}>{sign}{totalPnlPct.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Ticker item ────────────────────────────────────────────────────────────────

type TickerEntry = SetIndex | GlobalIndex

function TickerItem({ item, compact = false }: { item: TickerEntry; compact?: boolean }) {
  const up = (item.changePct ?? 0) >= 0

  const valStr = item.value != null
    ? item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

  const chgStr = item.changePct != null
    ? `${up ? '+' : ''}${item.changePct.toFixed(2)}%`
    : '—'

  if (compact) {
    return (
      <div className="flex items-center gap-1 px-2 border-r border-border/25 last:border-r-0 shrink-0">
        <span className="text-[10px] text-ink-muted">{item.name}</span>
        <span className="text-[10px] font-semibold text-ink-primary tabular-nums">{valStr}</span>
        <span className={cn('text-[9px] font-semibold tabular-nums', item.changePct == null ? 'text-ink-muted' : up ? 'text-gain' : 'text-loss')}>
          {chgStr}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-3 border-r border-border/30 last:border-r-0 shrink-0">
      <span className="text-[11px] text-ink-muted font-medium">{item.name}</span>
      <span className="text-[11px] font-semibold text-ink-primary tabular-nums">{valStr}</span>
      <span className={cn('text-[10px] font-semibold tabular-nums', item.changePct == null ? 'text-ink-muted' : up ? 'text-gain' : 'text-loss')}>
        {chgStr}
      </span>
    </div>
  )
}

// ── Two-row ticker ─────────────────────────────────────────────────────────────

function MarketTicker() {
  const { data: setIndices = [], isLoading: setLoading } = useQuery<SetIndex[]>({
    queryKey: ['set-indices'],
    queryFn: portfolioTrackerService.getSetIndices,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
    retry: 1,
  })

  const { data: globalIndices = [], isLoading: globalLoading } = useQuery<GlobalIndex[]>({
    queryKey: ['global-indices'],
    queryFn: portfolioTrackerService.getGlobalIndices,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
    retry: 1,
  })

  const isLoading = setLoading && globalLoading

  if (isLoading) {
    return (
      <div className="flex flex-col gap-0.5 w-full">
        <div className="flex items-center gap-3">
          {['SET50', 'SET100', 'sSET'].map(n => (
            <div key={n} className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink-muted">{n}</span>
              <span className="skeleton w-12 h-2.5 rounded" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {['S&P500', 'NASDAQ', 'DOW', 'BTC', 'XAUUSD'].map(n => (
            <div key={n} className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink-muted">{n}</span>
              <span className="skeleton w-12 h-2.5 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 w-full overflow-hidden">
      {/* Row 1: Thai SET indices */}
      <div className="flex items-center gap-0 border-b border-border/20 pb-0.5">
        <span className="text-[9px] text-ink-disabled font-medium uppercase tracking-wider mr-2 shrink-0">TH</span>
        {setIndices.map(item => <TickerItem key={item.name} item={item} compact />)}
      </div>
      {/* Row 2: Global indices */}
      <div className="flex items-center gap-0 pt-0.5">
        <span className="text-[9px] text-ink-disabled font-medium uppercase tracking-wider mr-2 shrink-0">GL</span>
        {globalIndices.map(item => <TickerItem key={item.name} item={item} compact />)}
      </div>
    </div>
  )
}

// ── Notification item ──────────────────────────────────────────────────────────

function NotificationItem({ notification }: { notification: any }) {
  const colors: Record<string, string> = {
    success: 'bg-gain', error: 'bg-loss', warning: 'bg-warning', info: 'bg-info', alert: 'bg-brand-500',
  }
  return (
    <div className={cn('px-4 py-3 border-b border-border/30 hover:bg-surface-elevated/50 transition-colors cursor-pointer', !notification.read && 'bg-brand-500/3')}>
      <div className="flex gap-3">
        <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', colors[notification.type] ?? 'bg-ink-muted')} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-ink-primary">{notification.title}</p>
          <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{notification.message}</p>
        </div>
      </div>
    </div>
  )
}
