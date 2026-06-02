'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, TrendingUp, Bot, BarChart3, Settings,
  ChevronLeft, ChevronRight, LogOut, X, Users, ChevronDown, FileText, ClipboardList,
  Database, ShoppingCart, Briefcase, ArrowUpRight, FlaskConical, HardDriveDownload, GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import { portfolioDbService } from '@/services/portfolioDb'
import { actionPlanService } from '@/services/actionPlan'

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
  { href: '/settings',              label: 'My Profile',  icon: Settings },
  { href: '/admin/users',           label: 'Users',        icon: Users,            adminOnly: true },
  { href: '/settings/documents',    label: 'Documents',    icon: FileText },
  { href: '/settings/dr-mappings',  label: 'DR Mappings',  icon: GitBranch },
  { href: '/settings/backup',       label: 'Backup',       icon: HardDriveDownload, adminOnly: true },
  { href: '/settings/testing',      label: 'Testing',      icon: FlaskConical,      adminOnly: true },
] as const

// ── Sidebar widgets ────────────────────────────────────────────────────────────

function PurchasePlanWidget() {
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

  const items = (plan?.purchase_items ?? []).slice(0, 5)

  return (
    <div className="px-3 py-2 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <ShoppingCart className="w-3 h-3 text-brand-400 shrink-0" />
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider flex-1 truncate">
          Purchase
        </span>
        <Link href={`/action-plan/purchase/${latest.id}`}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Open purchase plan">
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      {/* Items */}
      {items.length === 0 ? (
        <p className="text-[10px] text-ink-disabled pl-4">No items</p>
      ) : (
        <div className="space-y-0.5 pl-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px] tabular-nums">
              {/* Symbol */}
              <span className={cn(
                'font-mono font-bold text-[10px] shrink-0 w-[46px] truncate',
                item.triggered ? 'text-gain' : 'text-ink-secondary',
              )}>
                {item.stock}{item.triggered ? '✓' : ''}
              </span>
              {/* SL ← Buy → TP */}
              {item.sl != null && <span className="text-loss font-semibold shrink-0">{item.sl.toFixed(1)}</span>}
              {item.sl != null && <span className="text-ink-disabled shrink-0">←</span>}
              <span className="text-ink-primary font-bold shrink-0">
                {item.buy_price != null ? item.buy_price.toFixed(1) : '—'}
              </span>
              {item.tp != null && <span className="text-ink-disabled shrink-0">→</span>}
              {item.tp != null && <span className="text-gain font-semibold shrink-0">{item.tp.toFixed(1)}</span>}
            </div>
          ))}
          {(plan?.purchase_items?.length ?? 0) > 5 && (
            <p className="text-[10px] text-ink-disabled pl-1">
              +{(plan!.purchase_items.length - 5)} more
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PortfolioWidget({ isDbMode }: { isDbMode: boolean }) {
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
  type Row = { key: string; symbol: string; pnlPct: number | null; entryPrice: number | null; link: string }

  const rows: Row[] = isDbMode
    ? (dbPositions ?? [])
        .filter(p => !p.parentId)
        .sort((a, b) => Math.abs(b.pnlPct) - Math.abs(a.pnlPct))
        .slice(0, 5)
        .map(p => ({
          key: p.id,
          symbol: p.symbol,
          pnlPct: p.pnlPct,
          entryPrice: p.entryPrice,
          link: '/settings/portfolio-db',
        }))
    : (planDetail?.portfolio_items ?? [])
        .slice(0, 5)
        .map((it, i) => {
          const pnl = it.entry_price && it.current_price
            ? ((it.current_price - it.entry_price) / it.entry_price) * 100
            : null
          return {
            key: it.id ?? String(i),
            symbol: it.symbol,
            pnlPct: pnl,
            entryPrice: it.entry_price,
            link: latestPlan ? `/action-plan/portfolio/${latestPlan.id}` : '/action-plan',
          }
        })

  if (rows.length === 0) return null

  const linkHref = isDbMode ? '/settings/portfolio-db'
    : latestPlan ? `/action-plan/portfolio/${latestPlan.id}` : '/action-plan'

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Briefcase className="w-3 h-3 text-purple-400 shrink-0" />
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider flex-1 truncate">
          Portfolio <span className="text-ink-disabled font-normal">({rows.length})</span>
        </span>
        <Link href={linkHref}
          className="text-ink-disabled hover:text-brand-400 transition-colors shrink-0"
          title="Open portfolio">
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-0.5 pl-1">
        {rows.map(row => (
          <div key={row.key} className="flex items-center gap-1.5 text-[10px]">
            <span className="font-mono font-bold text-ink-secondary shrink-0 w-[52px] truncate">{row.symbol}</span>
            {row.pnlPct !== null ? (
              <>
                <span className={cn(
                  'font-semibold shrink-0 w-[42px] text-right tabular-nums',
                  row.pnlPct >= 0 ? 'text-gain' : 'text-loss',
                )}>
                  {row.pnlPct >= 0 ? '+' : ''}{row.pnlPct.toFixed(1)}%
                </span>
                <div className="flex-1 h-1 rounded-full bg-surface-overlay overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', row.pnlPct >= 0 ? 'bg-gain/60' : 'bg-loss/60')}
                    style={{ width: `${Math.min(Math.abs(row.pnlPct) * 5, 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="text-ink-disabled">
                {row.entryPrice != null ? `@ ${row.entryPrice.toFixed(2)}` : '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main sidebar ───────────────────────────────────────────────────────────────

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, clearAuth } = useAuthStore()

  const inPortfolioSection = pathname.startsWith('/portfolio') || pathname.startsWith('/settings/portfolio-db')
  const inSettingsSection = (pathname.startsWith('/settings') && !pathname.startsWith('/settings/portfolio-db'))
    || pathname.startsWith('/admin')

  const [portfolioOpen, setPortfolioOpen] = useState(inPortfolioSection)
  const [settingsOpen, setSettingsOpen] = useState(inSettingsSection)

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

        <AccordionGroup
          label="Portfolio" icon={TrendingUp}
          active={inPortfolioSection}
          open={portfolioOpen}
          onToggle={() => setPortfolioOpen(o => !o)}
        >
          <SubLink href="/portfolio" label="Portfolio Tracker" icon={TrendingUp} />
          {isDbMode && (
            <SubLink href="/settings/portfolio-db" label="Portfolio Manager" icon={Database} />
          )}
        </AccordionGroup>

        <NavLink href="/action-plan" label="Action Plan" icon={ClipboardList} />
        <NavLink href="/analytics"   label="Analytics"   icon={BarChart3} />
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
        <div className="shrink-0 border-t border-border/30 divide-y divide-border/20 max-h-[280px] overflow-y-auto no-scrollbar">
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
