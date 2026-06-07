'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Search, RefreshCw, Menu, Wifi, WifiOff, BarChart3 } from 'lucide-react'
import { useWebSocket } from '@/websocket/hooks'
import { useNotificationStore } from '@/store/notifications'
import {
  portfolioTrackerService,
  type SetIndex,
  type GlobalIndex,
} from '@/services/portfolioTracker'
import { weeklyScanService, type ScanListSummary, COLOR_MARKS } from '@/services/weeklyScan'
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

      {/* Latest weekly scan chip */}
      <div className="hidden lg:block shrink-0">
        <WeeklyScanChip />
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

// ── Weekly scan chip ───────────────────────────────────────────────────────────

// Color dot metadata keyed by mark value for fast lookup
const DOT_COLORS: Record<string, string> = {
  CYAN:   '#22d3ee',
  GREEN:  '#10b981',
  YELLOW: '#f59e0b',
  RED:    '#ef4444',
  PURPLE: '#a855f7',
}

function WeeklyScanChip() {
  const { data: scans } = useQuery<ScanListSummary[]>({
    queryKey: ['header-weekly-scans'],
    queryFn: weeklyScanService.listScans,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const latest = scans?.[0]
  if (!latest) return null

  const dots = (Object.entries(latest.color_counts) as [string, number][])
    .filter(([key, count]) => key !== 'NONE' && count > 0)
    .sort((a, b) => {
      const order = ['CYAN', 'GREEN', 'YELLOW', 'RED', 'PURPLE']
      return order.indexOf(a[0]) - order.indexOf(b[0])
    })

  const total = latest.total ?? Object.values(latest.color_counts).reduce((s, n) => s + n, 0)

  return (
    <Link
      href={`/weekly-scan/${latest.id}`}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/40 bg-surface-elevated/40 hover:bg-surface-elevated hover:border-brand-500/30 transition-colors group"
      title={`Go to ${latest.name}`}
    >
      <BarChart3 className="w-3 h-3 text-brand-400 shrink-0" />
      <span className="text-[10px] font-semibold text-ink-secondary group-hover:text-ink-primary transition-colors truncate max-w-[90px]">
        {latest.name}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {dots.map(([key, count]) => (
          <span key={key} className="flex items-center gap-0.5" title={`${key}: ${count}`}>
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: DOT_COLORS[key] }}
            />
            <span className="text-[9px] text-ink-muted tabular-nums">{count}</span>
          </span>
        ))}
      </div>
      <span className="text-[9px] text-ink-disabled tabular-nums shrink-0">{total}</span>
    </Link>
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
