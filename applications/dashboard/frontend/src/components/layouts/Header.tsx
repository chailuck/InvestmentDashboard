'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Search, RefreshCw, Menu, Wifi, WifiOff } from 'lucide-react'
import { useWebSocket } from '@/websocket/hooks'
import { useNotificationStore } from '@/store/notifications'
import { cn } from '@/lib/utils'

interface HeaderProps {
  onMobileMenuOpen: () => void
  pageTitle?: string
}

export function Header({ onMobileMenuOpen, pageTitle = 'Dashboard' }: HeaderProps) {
  const { isConnected } = useWebSocket()
  const { notifications, markAllRead } = useNotificationStore()
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <header className="h-[60px] bg-surface-card/80 backdrop-blur-sm border-b border-border/50 flex items-center px-4 gap-4 shrink-0 sticky top-0 z-30">
      {/* Mobile menu button */}
      <button onClick={onMobileMenuOpen} className="btn-icon lg:hidden">
        <Menu className="w-4 h-4" />
      </button>

      {/* Page title */}
      <div className="flex-1 min-w-0 hidden sm:block">
        <h1 className="text-sm font-semibold text-ink-primary truncate">{pageTitle}</h1>
      </div>

      {/* Market status ticker strip */}
      <div className="hidden xl:flex items-center gap-4 flex-1 justify-center">
        <MarketTicker />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Live status */}
        <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium', isConnected ? 'text-gain' : 'text-ink-muted')}>
          {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          <span className="hidden sm:block">{isConnected ? 'Live' : 'Offline'}</span>
          {isConnected && <span className="live-dot" />}
        </div>

        {/* Search */}
        <button className="btn-icon" onClick={() => setSearchOpen(true)} title="Search (⌘K)">
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

function MarketTicker() {
  const indices = [
    { name: 'S&P 500', value: '5,842.47', change: '+0.34%', up: true },
    { name: 'NASDAQ', value: '18,432.10', change: '+0.51%', up: true },
    { name: 'DOW', value: '43,628.90', change: '-0.12%', up: false },
    { name: 'BTC', value: '$97,230', change: '+2.14%', up: true },
  ]

  return (
    <div className="flex items-center gap-5">
      {indices.map(idx => (
        <div key={idx.name} className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">{idx.name}</span>
          <span className="text-xs font-semibold text-ink-primary tabular">{idx.value}</span>
          <span className={cn('text-xs font-semibold tabular', idx.up ? 'text-gain' : 'text-loss')}>
            {idx.change}
          </span>
        </div>
      ))}
    </div>
  )
}

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
