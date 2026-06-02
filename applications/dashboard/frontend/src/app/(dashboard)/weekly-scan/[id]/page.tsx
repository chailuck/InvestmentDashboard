'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ScanLine, ArrowLeft, RefreshCw, Plus, Trash2, X, Loader2,
  AlertCircle, ChevronDown, Play, ShoppingCart, Check, Filter, BookmarkCheck, Clipboard,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  weeklyScanService, COLOR_MARKS, SCAN_STRATEGIES,
  colorMarkMeta, type WeeklyScanItem, type ColorMark, type WeekPriceEntry,
} from '@/services/weeklyScan'
import { actionPlanService, type PlanSummary, type PurchaseItem } from '@/services/actionPlan'
import { portfolioDbService } from '@/services/portfolioDb'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'

// ── Inline editable cell ──────────────────────────────────────────────────────

function NumCell({ value, onBlur }: { value: number | null; onBlur: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value?.toString() ?? '')

  const commit = () => {
    setEditing(false)
    const n = text.trim() === '' ? null : parseFloat(text)
    onBlur(isNaN(n as number) ? null : n)
  }

  if (editing) return (
    <input autoFocus type="number" step="any" value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className="w-20 input text-xs py-0.5 px-1" />
  )
  return (
    <button onClick={() => { setText(value?.toString() ?? ''); setEditing(true) }}
      className="text-xs tabular-nums text-ink-secondary hover:text-brand-400 transition-colors min-w-[40px] text-left">
      {value != null ? value.toFixed(2) : <span className="text-ink-disabled">—</span>}
    </button>
  )
}

function TextCell({ value, onBlur, placeholder = '—' }: { value: string | null; onBlur: (v: string | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? '')

  const commit = () => {
    setEditing(false)
    onBlur(text.trim() || null)
  }

  if (editing) return (
    <input autoFocus value={text} onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className="w-28 input text-xs py-0.5 px-1" />
  )
  return (
    <button onClick={() => { setText(value ?? ''); setEditing(true) }}
      className="text-xs text-ink-secondary hover:text-brand-400 transition-colors max-w-[140px] truncate text-left">
      {value || <span className="text-ink-disabled">{placeholder}</span>}
    </button>
  )
}

// ── Color mark picker (inline) ────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: ColorMark | null; onChange: (v: ColorMark | null) => void }) {
  const selectedMeta = value ? colorMarkMeta(value) : null

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1">
        {COLOR_MARKS.map(c => {
          const isActive = value === c.value
          return (
            <button key={c.value} title={c.label}
              onClick={() => onChange(isActive ? null : c.value as ColorMark)}
              className={cn(
                'rounded-full transition-all border-2 flex-shrink-0',
                isActive
                  ? cn('w-3.5 h-3.5', c.dot, 'border-white/30')
                  : cn('w-2.5 h-2.5', c.dot, 'opacity-35 hover:opacity-65 border-transparent'),
              )}
            />
          )
        })}
      </div>
      {selectedMeta && (
        <span className={cn('text-[10px] font-semibold', selectedMeta.text)}>
          {selectedMeta.label}
        </span>
      )}
    </div>
  )
}

// ── Week price display cells ──────────────────────────────────────────────────

function WeekPriceCell({ entry, loading, field }: {
  entry: WeekPriceEntry | undefined
  loading: boolean
  field: 'mon' | 'fri'
}) {
  if (loading) return <span className="text-ink-disabled text-[10px]">…</span>
  const isDr = entry?.parent_symbol != null
  const val = entry?.[field]
  if (val == null) return <span className="text-ink-disabled">—</span>
  return (
    <span className={cn('text-xs tabular-nums', isDr ? 'text-amber-300' : 'text-ink-secondary')}>
      {isDr ? '$' : ''}{val.toLocaleString('en', { maximumFractionDigits: 2 })}
    </span>
  )
}

function WeekPnlCell({ entry, loading }: { entry: WeekPriceEntry | undefined; loading: boolean }) {
  if (loading) return <span className="text-ink-disabled text-[10px]">…</span>
  const { mon, fri } = entry ?? {}
  if (mon == null || fri == null || mon === 0) return <span className="text-ink-disabled">—</span>
  const pct = (fri - mon) / mon * 100
  return (
    <span className={cn('text-xs font-semibold', pct >= 0 ? 'text-gain' : 'text-loss')}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function DrPriceCell({ entry, loading, field }: {
  entry: WeekPriceEntry | undefined
  loading: boolean
  field: 'dr_mon_thb' | 'dr_fri_thb'
}) {
  if (loading) return <span className="text-ink-disabled text-[10px]">…</span>
  if (!entry?.parent_symbol) return <span className="text-ink-disabled text-[10px]">—</span>
  const val = entry[field]
  if (val == null) return <span className="text-ink-disabled">—</span>
  return (
    <span className="text-xs tabular-nums text-cyan-400 font-mono">
      ฿{val.toLocaleString('en', { maximumFractionDigits: 0 })}
    </span>
  )
}

// ── Strategy picker (inline icons) ───────────────────────────────────────────

const STRATEGY_ICONS: Record<string, { icon: string; short: string; base: string; active: string }> = {
  'BREAK OUT':          { icon: '🚀', short: 'BO',    base: 'hover:bg-emerald-500/20 hover:border-emerald-500/30', active: 'bg-emerald-500/20 border-emerald-500/40' },
  'BUY ON DIP':         { icon: '📉', short: 'BOD',   base: 'hover:bg-sky-500/20 hover:border-sky-500/30',         active: 'bg-sky-500/20 border-sky-500/40'         },
  'แท่งเทียนกลับตัว':  { icon: '🕯️', short: 'ททกต', base: 'hover:bg-amber-500/20 hover:border-amber-500/30',    active: 'bg-amber-500/20 border-amber-500/40'    },
  'ยยจท':              { icon: '📈', short: 'ยยจท',  base: 'hover:bg-orange-500/20 hover:border-orange-500/30',   active: 'bg-orange-500/20 border-orange-500/40'   },
  'NEWS':               { icon: '📰', short: 'NEWS',  base: 'hover:bg-blue-500/20 hover:border-blue-500/30',       active: 'bg-blue-500/20 border-blue-500/40'       },
  'AJ PAO':             { icon: '🎯', short: 'PAO',   base: 'hover:bg-purple-500/20 hover:border-purple-500/30',   active: 'bg-purple-500/20 border-purple-500/40'   },
  'OTHERS':             { icon: '✦',  short: 'OTH.',  base: 'hover:bg-zinc-500/20 hover:border-zinc-500/30',       active: 'bg-zinc-500/20 border-zinc-500/40'       },
}

const NAMED_STRATEGIES = SCAN_STRATEGIES.filter(s => s !== 'OTHERS')

function StrategyCell({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const isOthers = value !== null && !NAMED_STRATEGIES.includes(value)
  const [othText, setOthText] = useState(() =>
    value !== null && !NAMED_STRATEGIES.includes(value) && value !== 'OTHERS' ? value : ''
  )

  useEffect(() => {
    if (value === null || NAMED_STRATEGIES.includes(value)) setOthText('')
    else if (value !== 'OTHERS') setOthText(value)
  }, [value])

  const commitOth = (text: string) => onChange(text.trim() || 'OTHERS')

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {SCAN_STRATEGIES.map(s => {
        const meta = STRATEGY_ICONS[s] ?? { icon: s[0], short: s, base: '', active: '' }
        const isActive = s === 'OTHERS' ? isOthers : value === s
        return (
          <button key={s} title={s}
            onClick={() => {
              if (s === 'OTHERS') {
                if (isOthers) { onChange(null); setOthText('') }
                else { onChange('OTHERS'); setOthText('') }
              } else {
                onChange(isActive ? null : s)
              }
            }}
            className={cn(
              'flex flex-col items-center justify-center w-8 h-8 rounded border transition-all',
              isActive ? meta.active : cn('border-transparent opacity-30 hover:opacity-80', meta.base),
            )}>
            <span className="text-sm leading-none">{meta.icon}</span>
            <span className="text-[8px] leading-none font-medium mt-0.5 tracking-tight">{meta.short}</span>
          </button>
        )
      })}
      {isOthers && (
        <input
          autoFocus={value === 'OTHERS'}
          value={othText}
          onChange={e => setOthText(e.target.value)}
          onBlur={() => commitOth(othText)}
          onKeyDown={e => { if (e.key === 'Enter') commitOth(othText) }}
          placeholder="type…"
          className="ml-1 w-20 bg-surface-elevated border border-border/50 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary placeholder:text-ink-disabled focus:outline-none focus:border-brand-500/50"
        />
      )}
    </div>
  )
}

// ── Add to purchase plan modal ────────────────────────────────────────────────

function AddToPlanModal({
  item,
  onClose,
}: {
  item: WeeklyScanItem
  onClose: () => void
}) {
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useState(() => {
    actionPlanService.list('purchase', null).then(all => {
      const latest5 = all.slice(0, 5)
      setPlans(latest5)
      if (latest5.length > 0) setSelectedId(latest5[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  })

  const confirm = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const plan = await actionPlanService.get(selectedId)
      const existing = plan.purchase_items
      const newItem: Omit<PurchaseItem, 'id'> = {
        sort_order: existing.length,
        stock:         item.symbol,
        current_price: null,
        size:          item.size   ?? null,
        buy_price:     item.buy_price ?? null,
        tp:            item.tp    ?? null,
        sl:            item.sl    ?? null,
        strategy:      item.strategy ?? null,
        reason:        item.remark ?? null,
        triggered:     false,
      }
      await actionPlanService.update(selectedId, {
        name: plan.name,
        purchase_items: [...existing.map(({ id: _id, ...r }) => r), newItem],
      })
      setDone(true)
      setTimeout(onClose, 900)
    } catch { } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-brand-400" />
            Add <span className="font-mono">{item.symbol}</span> to purchase plan
          </h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-ink-muted text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading plans…</div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-ink-muted">No purchase plans found. Create one first.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">Select a purchase plan (latest 5):</p>
              {plans.map(p => (
                <label key={p.id} className={cn('flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                  selectedId === p.id ? 'border-brand-500/50 bg-brand-500/8' : 'border-border hover:border-border-focus')}>
                  <input type="radio" value={p.id} checked={selectedId === p.id}
                    onChange={() => setSelectedId(p.id)} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-primary truncate">{p.name}</p>
                    <p className="text-[10px] text-ink-muted">{format(new Date(p.created_at), 'dd MMM yyyy')}</p>
                  </div>
                  {selectedId === p.id && <Check className="w-3.5 h-3.5 text-brand-400 ml-auto shrink-0" />}
                </label>
              ))}
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 text-gain text-xs px-3 py-2 rounded-lg bg-gain/10 border border-gain/20">
              <Check className="w-3.5 h-3.5" /> Added to plan!
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button onClick={confirm} disabled={!selectedId || saving || done || plans.length === 0}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Add
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Start scan dropdown ───────────────────────────────────────────────────────

function StartScanMenu({ scanId, hasItems, activeList }: {
  scanId: string; hasItems: boolean; activeList: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const go = (mode: string) => {
    const params = new URLSearchParams({ mode })
    if (activeList) params.set('list', activeList)
    router.push(`/weekly-scan/${scanId}/evaluate?${params.toString()}`)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={!hasItems}
        className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
        <Play className="w-3.5 h-3.5" />
        {activeList ? `Scan: ${activeList}` : 'Start Scan'}
        <ChevronDown className="w-3 h-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 bg-surface-card border border-border/60 rounded-xl shadow-xl w-60 z-30 overflow-hidden">
            {activeList && (
              <div className="px-4 py-2 border-b border-border/30 bg-brand-500/8">
                <span className="text-[10px] text-brand-400 font-semibold">Scanning: {activeList}</span>
              </div>
            )}
            {[
              { label: 'All symbols',    mode: 'all',       desc: activeList ? `All in ${activeList}` : 'Every symbol in order' },
              { label: 'Remaining only', mode: 'remaining', desc: 'Not yet colour-marked' },
              ...COLOR_MARKS.map(c => ({ label: `${c.label} only`, mode: `color_${c.value}`, desc: `${c.value} marked symbols` })),
            ].map(item => (
              <button key={item.mode} onClick={() => go(item.mode)}
                className="w-full flex flex-col items-start px-4 py-2.5 hover:bg-surface-elevated transition-colors border-b border-border/20 last:border-0">
                <span className="text-xs font-medium text-ink-primary">{item.label}</span>
                <span className="text-[10px] text-ink-muted">{item.desc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WeeklyScanPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [addSymbol,     setAddSymbol]     = useState('')
  const [addLoading,    setAddLoading]    = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const [deleteSymbol,    setDeleteSymbol]    = useState<string | null>(null)
  const [analyticsSymbol, setAnalyticsSymbol] = useState<{ symbol: string; market: string } | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  const [addToPlan,     setAddToPlan]     = useState<WeeklyScanItem | null>(null)
  const [markingPortfo,  setMarkingPortfo]  = useState(false)
  const [savingConfig,   setSavingConfig]   = useState<'idle' | 'saving' | 'done'>('idle')
  const [copied,         setCopied]         = useState(false)
  const [addToList,      setAddToList]      = useState<string>('')

  // Symbol list tab — defaults to the first list when tabs load for the first time
  const [activeListTab, setActiveListTab] = useState<string | null>(null)
  const defaultTabApplied = useRef(false)

  // Column filters
  const [filterSymbol,   setFilterSymbol]   = useState('')
  const [filterColors,   setFilterColors]   = useState<Set<string>>(new Set())
  const [filterStrategy, setFilterStrategy] = useState('')

  const { data: scan, isLoading, isError } = useQuery({
    queryKey: ['weekly-scan', id],
    queryFn: () => weeklyScanService.getScan(id),
    staleTime: 30_000,
  })

  const { data: weekPrices, isLoading: pricesLoading } = useQuery({
    queryKey: ['weekly-scan-prices', id],
    queryFn: () => weeklyScanService.getWeekPrices(id),
    staleTime: 5 * 60_000,
    enabled: !!scan,
  })

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['weekly-scan', id] }), [id, queryClient])

  // Derive unique list tabs from items (preserve insertion order)
  const listTabs = scan
    ? [...new Set(scan.items.map(i => i.list_name).filter((n): n is string => !!n))]
    : []

  // Auto-select first list tab on initial load (only once per page visit)
  useEffect(() => {
    if (!defaultTabApplied.current && listTabs.length > 0) {
      setActiveListTab(listTabs[0])
      defaultTabApplied.current = true
    }
  }, [listTabs.length]) // eslint-disable-line

  // Sorted A-Z then filtered (tab + column filters)
  const sortedItems = scan
    ? [...scan.items]
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .filter(item => {
          if (activeListTab !== null && item.list_name !== activeListTab) return false
          if (filterSymbol && !item.symbol.toUpperCase().includes(filterSymbol.toUpperCase())) return false
          if (filterColors.size > 0) {
            const key = item.color_mark ?? 'NONE'
            if (!filterColors.has(key)) return false
          }
          if (filterStrategy && !(item.strategy ?? '').toLowerCase().includes(filterStrategy.toLowerCase())) return false
          return true
        })
    : []

  const hasFilters = filterSymbol || filterColors.size > 0 || filterStrategy
  const clearFilters = () => { setFilterSymbol(''); setFilterColors(new Set()); setFilterStrategy('') }

  const toggleColorFilter = (v: string) =>
    setFilterColors(prev => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })

  // Inline update helper — debounce not needed; fires on blur
  const updateField = async (symbol: string, fields: Partial<Pick<WeeklyScanItem,
    'color_mark' | 'strategy' | 'buy_price' | 'size' | 'tp' | 'sl' | 'remark'>>) => {
    await weeklyScanService.upsertItem(id, symbol, fields)
    await invalidate()
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await weeklyScanService.refreshScan(id); await invalidate() }
    catch { } finally { setRefreshing(false) }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const sym = addSymbol.trim().toUpperCase()
    if (!sym) return
    setAddLoading(true)
    const targetList = activeListTab ?? (addToList || null)
    // Derive market from the target list (look at existing items in that list)
    const marketForList = targetList
      ? (scan?.items.find(i => i.list_name === targetList)?.market ?? 'SET')
      : 'SET'
    try { await weeklyScanService.addItem(id, sym, targetList, marketForList); setAddSymbol(''); await invalidate() }
    catch { } finally { setAddLoading(false) }
  }

  const handleDelete = async () => {
    if (!deleteSymbol) return
    setDeleting(true)
    try { await weeklyScanService.deleteItem(id, deleteSymbol); setDeleteSymbol(null); await invalidate() }
    catch { } finally { setDeleting(false) }
  }

  // Auto-mark PURPLE for symbols that are in the active portfolio
  const markPortfolioSymbols = async () => {
    if (!scan) return
    setMarkingPortfo(true)
    try {
      const positions = await portfolioDbService.getPositions('active')
      const activeSymbols = new Set(positions.map(p => p.symbol.toUpperCase()))

      // Also get latest purchase plan for strategy mapping
      const allPlans = await actionPlanService.list('purchase', null)
      let strategyMap: Record<string, string> = {}
      if (allPlans.length > 0) {
        const latest = await actionPlanService.get(allPlans[0].id)
        for (const item of latest.purchase_items) {
          if (item.strategy) strategyMap[item.stock.toUpperCase()] = item.strategy
        }
      }

      const toMark = scan.items.filter(i => activeSymbols.has(i.symbol.toUpperCase()))
      await Promise.all(toMark.map(item =>
        weeklyScanService.upsertItem(id, item.symbol, {
          color_mark: 'PURPLE',
          strategy: strategyMap[item.symbol.toUpperCase()] ?? item.strategy ?? undefined,
        })
      ))
      await invalidate()
    } catch { } finally { setMarkingPortfo(false) }
  }

  const saveAsConfig = async () => {
    if (!scan || savingConfig === 'saving') return
    setSavingConfig('saving')
    try {
      const symbols = (activeListTab
        ? scan.items.filter(i => i.list_name === activeListTab)
        : scan.items
      ).map(i => i.symbol)
      await weeklyScanService.updateConfig(symbols)
      setSavingConfig('done')
      setTimeout(() => setSavingConfig('idle'), 2000)
    } catch { setSavingConfig('idle') }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading scan…
    </div>
  )
  if (isError || !scan) return (
    <div className="flex items-center justify-center h-64 gap-2 text-loss">
      <AlertCircle className="w-5 h-5" /> Failed to load scan.
    </div>
  )

  // Counts reflect the active tab (only items in that tab)
  const tabFilteredItems = activeListTab === null
    ? scan.items
    : scan.items.filter(i => i.list_name === activeListTab)
  const counts = {
    CYAN:   tabFilteredItems.filter(i => i.color_mark === 'CYAN').length,
    GREEN:  tabFilteredItems.filter(i => i.color_mark === 'GREEN').length,
    YELLOW: tabFilteredItems.filter(i => i.color_mark === 'YELLOW').length,
    RED:    tabFilteredItems.filter(i => i.color_mark === 'RED').length,
    PURPLE: tabFilteredItems.filter(i => i.color_mark === 'PURPLE').length,
    NONE:   tabFilteredItems.filter(i => !i.color_mark).length,
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => router.push('/action-plan')} className="btn-icon mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-brand-400 shrink-0" />
            <h1 className="text-lg font-bold text-ink-primary font-mono">{scan.name}</h1>
          </div>
          <p className="text-xs text-ink-muted mt-0.5 ml-7">
            Created {format(new Date(scan.created_at), 'dd MMM yyyy')} ·
            Modified {format(new Date(scan.updated_at), 'dd MMM yyyy HH:mm')} ·
            {scan.items.length} symbols
          </p>
        </div>
      </div>

      {/* Colour legend */}
      <div className="flex flex-wrap gap-2">
        {COLOR_MARKS.map(c => (
          <div key={c.value} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', c.bg, c.text, c.border)}>
            <span className={cn('w-2 h-2 rounded-full', c.dot)} />
            {c.label} <span className="font-bold">{counts[c.value]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-surface-elevated text-ink-muted">
          Pending <span className="font-bold">{counts.NONE}</span>
        </div>
      </div>

      {/* Symbol list tabs — above toolbar */}
      {listTabs.length === 0 && scan.items.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-brand-500/20 bg-brand-500/8 text-xs text-brand-400">
          <span className="opacity-60">💡</span>
          No symbol list tabs yet. Click <strong className="font-semibold">"Refresh config"</strong> below to assign symbols to tabs from your configured symbol lists.
        </div>
      )}

      {listTabs.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setActiveListTab(null)}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
              activeListTab === null
                ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
            )}>
            All <span className="ml-1 text-[10px] opacity-60">{scan.items.length}</span>
          </button>
          {listTabs.map(name => {
            const count = scan.items.filter(i => i.list_name === name).length
            return (
              <button key={name}
                onClick={() => setActiveListTab(name)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                  activeListTab === name
                    ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                    : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
                )}>
                {name} <span className="ml-1 text-[10px] opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Toolbar — below tabs, list-context aware */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:border-brand-500/40 transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          Refresh config
        </button>

        <button onClick={saveAsConfig} disabled={savingConfig === 'saving'}
          title={activeListTab ? `Save "${activeListTab}" symbols as config` : 'Save all symbols as config'}
          className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50',
            savingConfig === 'done'
              ? 'border-gain/40 bg-gain/10 text-gain'
              : 'border-brand-500/30 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20',
          )}>
          {savingConfig === 'saving'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <BookmarkCheck className="w-3.5 h-3.5" />}
          {savingConfig === 'done'
            ? 'Saved!'
            : activeListTab ? `Save "${activeListTab}" as config` : 'Save as config'}
        </button>

        {/* Auto-mark portfolio purple */}
        <button onClick={markPortfolioSymbols} disabled={markingPortfo}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50">
          {markingPortfo
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <span className="w-3 h-3 rounded-full bg-purple-400 shrink-0" />}
          Mark portfolio purple
        </button>

        <form onSubmit={handleAdd} className="flex gap-1.5 flex-1 min-w-0">
          {/* List selector — only when on "All" tab and multiple lists exist */}
          {activeListTab === null && listTabs.length > 0 && (
            <select value={addToList} onChange={e => setAddToList(e.target.value)}
              className="bg-surface-elevated border border-border/50 rounded px-2 py-1 text-xs text-ink-secondary focus:outline-none focus:border-brand-500/50 shrink-0 max-w-[110px]">
              <option value="">No list</option>
              {listTabs.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <input value={addSymbol} onChange={e => setAddSymbol(e.target.value.toUpperCase())}
            placeholder={activeListTab ? `Add to ${activeListTab}…` : addToList ? `Add to ${addToList}…` : 'Add symbol…'}
            className="input text-xs font-mono uppercase flex-1 min-w-0 py-1.5" />
          <button type="submit" disabled={!addSymbol.trim() || addLoading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40">
            {addLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </form>

        <StartScanMenu scanId={id} hasItems={sortedItems.length > 0} activeList={activeListTab} />
      </div>

      {/* Symbol table — inline editable */}
      <div className="card overflow-hidden">
        {weekPrices?.usd_thb && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/30 bg-surface-elevated/50">
            <span className="text-[10px] text-ink-muted">Exchange rate:</span>
            <span className="text-[10px] font-mono font-semibold text-amber-400">
              1 USD = ฿{weekPrices.usd_thb.toFixed(2)}
            </span>
            <span className="text-[10px] text-ink-disabled">(used for DR price estimates)</span>
          </div>
        )}
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-340px)] min-h-[240px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/50 bg-surface-elevated text-ink-muted">
                <th className="px-3 py-2.5 text-left font-medium w-8">#</th>
                <th className="px-3 py-2.5 text-left font-medium">Symbol</th>
                <th className="px-3 py-2.5 text-left font-medium">Color</th>
                <th className="px-3 py-2.5 text-left font-medium">Strategy</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[72px]">
                  <div className="flex flex-col items-end leading-tight">
                    <span>Mon</span>
                    <span className="text-[10px] font-normal text-ink-disabled">
                      {weekPrices?.mon_date ? format(new Date(weekPrices.mon_date), 'dd MMM') : '—'}
                    </span>
                  </div>
                </th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[72px]">
                  <div className="flex flex-col items-end leading-tight">
                    <span>Fri</span>
                    <span className="text-[10px] font-normal text-ink-disabled">
                      {weekPrices?.fri_date ? format(new Date(weekPrices.fri_date), 'dd MMM') : '—'}
                    </span>
                  </div>
                </th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[60px]">W-P&L</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[80px]">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-cyan-500">DR Mon</span>
                    <span className="text-[10px] font-normal text-ink-disabled">est. ฿</span>
                  </div>
                </th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[80px]">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-cyan-500">DR Fri</span>
                    <span className="text-[10px] font-normal text-ink-disabled">est. ฿</span>
                  </div>
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Buy</th>
                <th className="px-3 py-2.5 text-left font-medium">Size</th>
                <th className="px-3 py-2.5 text-left font-medium">TP</th>
                <th className="px-3 py-2.5 text-left font-medium">SL</th>
                <th className="px-3 py-2.5 text-left font-medium">Remark</th>
                <th className="px-3 py-2.5 text-left font-medium">
                  <div className="flex items-center gap-1">
                    Actions
                    {hasFilters && (
                      <button onClick={clearFilters} title="Clear filters"
                        className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors">
                        ✕ filters
                      </button>
                    )}
                  </div>
                </th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-border/40 bg-surface-card">
                <td className="px-3 py-1.5">
                  <Filter className="w-3 h-3 text-ink-disabled" />
                </td>
                {/* Symbol filter */}
                <td className="px-3 py-1.5">
                  <input value={filterSymbol} onChange={e => setFilterSymbol(e.target.value.toUpperCase())}
                    placeholder="Search…"
                    className="w-full bg-surface-elevated border border-border/50 rounded px-2 py-0.5 text-[11px] font-mono text-ink-secondary placeholder:text-ink-disabled focus:outline-none focus:border-brand-500/50" />
                </td>
                {/* Color filter — multi-select dots */}
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {[...COLOR_MARKS, { value: 'NONE', label: 'None', dot: 'bg-border' } as const].map(c => (
                      <button key={c.value}
                        onClick={() => toggleColorFilter(c.value)}
                        title={c.label}
                        className={cn('w-3.5 h-3.5 rounded-full border-2 transition-all',
                          'dot' in c ? c.dot : 'bg-border',
                          filterColors.has(c.value) ? 'border-white scale-125' : 'border-transparent opacity-50 hover:opacity-80'
                        )} />
                    ))}
                  </div>
                </td>
                {/* Strategy filter */}
                <td className="px-3 py-1.5">
                  <input value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)}
                    placeholder="Filter…"
                    className="w-full bg-surface-elevated border border-border/50 rounded px-2 py-0.5 text-[11px] text-ink-secondary placeholder:text-ink-disabled focus:outline-none focus:border-brand-500/50" />
                </td>
                <td className="px-3 py-1.5 text-right text-[10px] text-ink-disabled">{pricesLoading ? '…' : ''}</td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                <td colSpan={6} className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    {hasFilters && (
                      <span className="text-[10px] text-amber-400">
                        {sortedItems.length} of {scan?.items.length ?? 0} shown
                      </span>
                    )}
                    <button
                      onClick={() => {
                        const csv = sortedItems.map(i => i.symbol).join(',')
                        navigator.clipboard.writeText(csv)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      title="Copy filtered symbols as comma-separated list"
                      className={cn(
                        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                        copied
                          ? 'border-gain/40 bg-gain/10 text-gain'
                          : 'border-border/50 text-ink-disabled hover:text-ink-secondary hover:border-brand-500/30',
                      )}>
                      {copied ? <Check className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
                      {copied ? 'Copied!' : `Copy ${sortedItems.length}`}
                    </button>
                  </div>
                </td>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-ink-muted">
                    No symbols yet. Add symbols or click <strong>Refresh config</strong>.
                  </td>
                </tr>
              ) : sortedItems.map((item, idx) => {
                const meta = item.color_mark ? colorMarkMeta(item.color_mark) : null
                return (
                  <tr key={item.id}
                    className={cn('border-b border-border/20 transition-colors',
                      meta ? `${meta.bg.replace('/20', '/5')} hover:${meta.bg.replace('/20', '/10')}` : 'hover:bg-surface-elevated/40')}>
                    <td className="px-3 py-2 text-ink-disabled">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => setAnalyticsSymbol({ symbol: item.symbol, market: item.market ?? 'SET' })}
                        className="font-bold font-mono text-ink-primary hover:text-brand-400 transition-colors">
                        {item.symbol}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <ColorPicker value={item.color_mark}
                        onChange={v => updateField(item.symbol, { color_mark: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <StrategyCell value={item.strategy}
                        onChange={v => updateField(item.symbol, { strategy: v })} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <WeekPriceCell entry={weekPrices?.prices[item.symbol]} loading={pricesLoading} field="mon" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <WeekPriceCell entry={weekPrices?.prices[item.symbol]} loading={pricesLoading} field="fri" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <WeekPnlCell entry={weekPrices?.prices[item.symbol]} loading={pricesLoading} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <DrPriceCell entry={weekPrices?.prices[item.symbol]} loading={pricesLoading} field="dr_mon_thb" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <DrPriceCell entry={weekPrices?.prices[item.symbol]} loading={pricesLoading} field="dr_fri_thb" />
                    </td>
                    <td className="px-3 py-2">
                      <NumCell value={item.buy_price}
                        onBlur={v => updateField(item.symbol, { buy_price: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <NumCell value={item.size}
                        onBlur={v => updateField(item.symbol, { size: v != null ? Math.round(v) : null })} />
                    </td>
                    <td className="px-3 py-2">
                      <NumCell value={item.tp}
                        onBlur={v => updateField(item.symbol, { tp: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <NumCell value={item.sl}
                        onBlur={v => updateField(item.symbol, { sl: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <TextCell value={item.remark}
                        onBlur={v => updateField(item.symbol, { remark: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setAddToPlan(item)} title="Add to purchase plan"
                          className="btn-icon text-brand-400/60 hover:text-brand-400">
                          <ShoppingCart className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteSymbol(item.symbol)} title="Remove"
                          className="btn-icon text-loss/60 hover:text-loss">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {analyticsSymbol && (
          <AnalyticsModal
            symbol={analyticsSymbol.symbol}
            assetType={(analyticsSymbol.market as any) ?? 'SET'}
            onClose={() => setAnalyticsSymbol(null)}
          />
        )}
        {addToPlan && (
          <AddToPlanModal item={addToPlan} onClose={() => setAddToPlan(null)} />
        )}
        {deleteSymbol && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDeleteSymbol(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-loss/15 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-loss" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink-primary">Remove symbol?</p>
                  <p className="text-xs text-ink-muted mt-1">
                    <span className="font-mono font-medium text-ink-secondary">{deleteSymbol}</span> will be removed.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteSymbol(null)} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="text-sm px-4 py-1.5 rounded-lg bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors flex items-center gap-2">
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
