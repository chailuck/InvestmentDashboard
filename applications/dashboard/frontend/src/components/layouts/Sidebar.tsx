'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, TrendingUp, Bot, BarChart3, Settings,
  ChevronLeft, ChevronRight, LogOut, X, Users, ChevronDown, FileText, ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

const NAV_MAIN = [
  { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/portfolio',   label: 'Portfolio',   icon: TrendingUp },
  { href: '/action-plan', label: 'Action Plan', icon: ClipboardList },
  { href: '/analytics',   label: 'Analytics',   icon: BarChart3 },
  { href: '/ai-copilot',  label: 'AI Copilot',  icon: Bot, badge: 'AI' },
] as const

const SETTINGS_SUB = [
  { href: '/settings',             label: 'My Profile',  icon: Settings },
  { href: '/admin/users',          label: 'Users',        icon: Users,    adminOnly: true },
  { href: '/settings/documents',   label: 'Documents',    icon: FileText },
] as const

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, clearAuth } = useAuthStore()

  const inSettingsSection = pathname.startsWith('/settings') || pathname.startsWith('/admin') || pathname.startsWith('/settings/documents')
  const [settingsOpen, setSettingsOpen] = useState(inSettingsSection)

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  const NavLink = ({ href, label, icon: Icon, badge }: { href: string; label: string; icon: React.ElementType; badge?: string }) => {
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
            InvestPro
          </motion.span>
        )}
      </Link>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto no-scrollbar">
        {NAV_MAIN.map(item => <NavLink key={item.href} {...item} />)}

        {/* Settings accordion */}
        <div>
          <button
            onClick={() => !collapsed && setSettingsOpen(o => !o)}
            title={collapsed ? 'Settings' : undefined}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
              inSettingsSection
                ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
              collapsed && 'justify-center px-0',
            )}>
            <Settings className={cn('w-4 h-4 shrink-0', inSettingsSection && 'text-brand-400')} />
            {!collapsed && (
              <>
                <span className="text-sm font-medium flex-1 text-left">Settings</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', settingsOpen && 'rotate-180')} />
              </>
            )}
          </button>

          <AnimatePresence initial={false}>
            {settingsOpen && !collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden">
                <div className="ml-3 pl-3 border-l border-border/50 mt-0.5 space-y-0.5">
                  {SETTINGS_SUB
                    .filter(item => !('adminOnly' in item) || !item.adminOnly || user?.role === 'admin')
                    .map(({ href, label, icon: Icon }) => {
                      const active = isActive(href)
                      return (
                        <Link key={href} href={href} onClick={onMobileClose}
                          className={cn(
                            'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                            active ? 'text-brand-400 bg-brand-500/10' : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
                          )}>
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">{label}</span>
                        </Link>
                      )
                    })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

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
              className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onMobileClose} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="fixed left-0 top-0 bottom-0 w-[240px] bg-surface-card border-r border-border/50 z-50 lg:hidden">
              <button onClick={onMobileClose} className="absolute top-3.5 right-3 btn-icon">
                <X className="w-4 h-4" />
              </button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
