'use client'

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ScanLine, ArrowLeft, RefreshCw, Plus, Trash2, X, Loader2,
  AlertCircle, ChevronDown, Play, ShoppingCart, Check, Filter,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  weeklyScanService, COLOR_MARKS, SCAN_STRATEGIES,
  colorMarkMeta, type WeeklyScanItem, type ColorMark,
} from '@/services/weeklyScan'
import { actionPlanService, type PlanSummary, type PurchaseItem } from '@/services/actionPlan'
import { portfolioDbService } from '@/services/portfolioDb'

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
  const [open, setOpen] = useState(false)
  const meta = value ? colorMarkMeta(value) : null

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} title="Change color mark"
        className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all',
          meta ? cn(meta.bg, meta.text, meta.border) : 'border-border text-ink-disabled hover:text-ink-muted hover:border-border-focus')}>
        {meta ? <><span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />{meta.label}</> : '— mark'}
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full mt-1 bg-surface-card border border-border/60 rounded-xl shadow-xl z-30 overflow-hidden w-36">
            <button onClick={() => { onChange(null); setOpen(false) }}
              className="w-full px-3 py-2 text-xs text-ink-muted hover:bg-surface-elevated transition-colors border-b border-border/20 text-left">
              Clear mark
            </button>
            {COLOR_MARKS.map(c => (
              <button key={c.value} onClick={() => { onChange(c.value as ColorMark); setOpen(false) }}
                className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold transition-colors', c.text,
                  value === c.value ? cn(c.bg) : 'hover:bg-surface-elevated')}>
                <span className={cn('w-2 h-2 rounded-full', c.dot)} />
                {c.label}
                {value === c.value && <Check className="w-3 h-3 ml-auto" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Strategy picker (inline) ──────────────────────────────────────────────────

function StrategyCell({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="text-xs text-ink-secondary hover:text-brand-400 transition-colors max-w-[120px] truncate text-left">
        {value || <span className="text-ink-disabled">— strategy</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full mt-1 bg-surface-card border border-border/60 rounded-xl shadow-xl z-30 overflow-hidden w-44">
            <button onClick={() => { onChange(null); setOpen(false) }}
              className="w-full px-3 py-2 text-xs text-ink-muted hover:bg-surface-elevated transition-colors border-b border-border/20 text-left">
              None
            </button>
            {SCAN_STRATEGIES.map(s => (
              <button key={s} onClick={() => { onChange(s); setOpen(false) }}
                className={cn('w-full px-3 py-1.5 text-xs transition-colors text-left',
                  value === s ? 'text-brand-400 bg-brand-500/10' : 'text-ink-secondary hover:bg-surface-elevated')}>
                {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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

function StartScanMenu({ scanId, hasItems }: { scanId: string; hasItems: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const go = (mode: string) => { router.push(`/weekly-scan/${scanId}/evaluate?mode=${mode}`); setOpen(false) }

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={!hasItems}
        className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
        <Play className="w-3.5 h-3.5" /> Start Scan <ChevronDown className="w-3 h-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 bg-surface-card border border-border/60 rounded-xl shadow-xl w-56 z-30 overflow-hidden">
            {[
              { label: 'All symbols',    mode: 'all',       desc: 'Every symbol in order' },
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
  const [deleteSymbol,  setDeleteSymbol]  = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  const [addToPlan,     setAddToPlan]     = useState<WeeklyScanItem | null>(null)
  const [markingPortfo, setMarkingPortfo] = useState(false)

  // Column filters
  const [filterSymbol,   setFilterSymbol]   = useState('')
  const [filterColors,   setFilterColors]   = useState<Set<string>>(new Set())
  const [filterStrategy, setFilterStrategy] = useState('')

  const { data: scan, isLoading, isError } = useQuery({
    queryKey: ['weekly-scan', id],
    queryFn: () => weeklyScanService.getScan(id),
    staleTime: 30_000,
  })

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['weekly-scan', id] }), [id, queryClient])

  // Sorted A-Z then filtered
  const sortedItems = scan
    ? [...scan.items]
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .filter(item => {
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
    try { await weeklyScanService.addItem(id, sym); setAddSymbol(''); await invalidate() }
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

  const counts = scan.color_counts

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

      {/* Toolbar */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:border-brand-500/40 transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          Refresh config
        </button>

        {/* Auto-mark portfolio purple */}
        <button onClick={markPortfolioSymbols} disabled={markingPortfo}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50">
          {markingPortfo
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <span className="w-3 h-3 rounded-full bg-purple-400 shrink-0" />}
          Mark portfolio purple
        </button>

        <form onSubmit={handleAdd} className="flex gap-2 flex-1 min-w-0">
          <input value={addSymbol} onChange={e => setAddSymbol(e.target.value.toUpperCase())}
            placeholder="Add symbol…"
            className="input text-xs font-mono uppercase flex-1 min-w-0 py-1.5" />
          <button type="submit" disabled={!addSymbol.trim() || addLoading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40">
            {addLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </form>

        <StartScanMenu scanId={id} hasItems={scan.items.length > 0} />
      </div>

      {/* Symbol table — inline editable */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-surface-elevated/30 text-ink-muted">
                <th className="px-3 py-2.5 text-left font-medium w-8">#</th>
                <th className="px-3 py-2.5 text-left font-medium">Symbol</th>
                <th className="px-3 py-2.5 text-left font-medium">Color</th>
                <th className="px-3 py-2.5 text-left font-medium">Strategy</th>
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
              <tr className="border-b border-border/40 bg-surface-base/60">
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
                <td colSpan={6} className="px-3 py-1.5">
                  {hasFilters && (
                    <span className="text-[10px] text-amber-400">
                      {sortedItems.length} of {scan?.items.length ?? 0} shown
                    </span>
                  )}
                </td>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-ink-muted">
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
                    <td className="px-3 py-2 font-bold font-mono text-ink-primary">{item.symbol}</td>
                    <td className="px-3 py-2">
                      <ColorPicker value={item.color_mark}
                        onChange={v => updateField(item.symbol, { color_mark: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <StrategyCell value={item.strategy}
                        onChange={v => updateField(item.symbol, { strategy: v })} />
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
