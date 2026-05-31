'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Edit2, Save, X, Loader2, RefreshCw,
  TrendingDown, CornerDownRight, Undo2, AlertCircle,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { portfolioDbService, type DbPosition, type PositionInput } from '@/services/portfolioDb'

// ── Helpers ───────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

const fmt = (v: number | null, d = 2) =>
  v == null ? '—' : v.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })

const fmtDate = (iso: string | null) =>
  iso ? format(new Date(iso), 'dd MMM yy') : '—'

const fmtDateTime = (iso: string | null) =>
  iso ? format(new Date(iso), 'dd MMM yy HH:mm') : '—'

// ── Empty input with today as default entry_date ───────────────────────────────

const emptyInput = (): PositionInput => ({
  symbol: '', direction: 'LONG',
  entry_date: today(),        // default to today
  entry_price: null, position_size: null,
  sl: null, tp: null, status: 'active',
  exit_date: null, exit_price: null, remarks: null,
})

function positionToInput(p: DbPosition): PositionInput {
  return {
    symbol: p.symbol, direction: p.direction,
    entry_date: p.entryDate, entry_price: p.entryPrice,
    position_size: p.positionSize, sl: p.sl, tp: p.tp,
    status: p.status, exit_date: p.exitDate, exit_price: p.exitPrice,
    remarks: p.remarks,
  }
}

// ── Position form modal ────────────────────────────────────────────────────────

function PositionModal({
  initial, title, subtitle, onSave, onClose, saving,
}: {
  initial: PositionInput; title: string; subtitle?: string
  onSave: (i: PositionInput) => void; onClose: () => void; saving: boolean
}) {
  const [form, setForm] = useState<PositionInput>(initial)
  const set = (k: keyof PositionInput, v: any) => setForm(f => ({ ...f, [k]: v }))
  const num = (s: string) => s === '' ? null : parseFloat(s)
  const int = (s: string) => s === '' ? null : parseInt(s)

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
            {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs text-ink-muted mb-1">Symbol *</label>
              <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
                className="input text-sm uppercase font-mono" placeholder="BH" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Direction</label>
              <select value={form.direction} onChange={e => set('direction', e.target.value)} className="input text-sm">
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="input text-sm">
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Entry Date</label>
              <input type="date" value={form.entry_date ?? ''} onChange={e => set('entry_date', e.target.value || null)}
                className="input text-sm" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Entry Price</label>
              <input type="number" step="any" value={form.entry_price ?? ''}
                onChange={e => set('entry_price', num(e.target.value))}
                className="input text-sm text-right tabular-nums" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Size (shares)</label>
              <input type="number" step="1" value={form.position_size ?? ''}
                onChange={e => set('position_size', int(e.target.value))}
                className="input text-sm text-right tabular-nums" placeholder="1000" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Stop Loss</label>
              <input type="number" step="any" value={form.sl ?? ''}
                onChange={e => set('sl', num(e.target.value))}
                className="input text-sm text-right tabular-nums" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Take Profit</label>
              <input type="number" step="any" value={form.tp ?? ''}
                onChange={e => set('tp', num(e.target.value))}
                className="input text-sm text-right tabular-nums" placeholder="0.00" />
            </div>
            {form.status === 'closed' && <>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Exit Date</label>
                <input type="date" value={form.exit_date ?? ''} onChange={e => set('exit_date', e.target.value || null)}
                  className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Exit Price</label>
                <input type="number" step="any" value={form.exit_price ?? ''}
                  onChange={e => set('exit_price', num(e.target.value))}
                  className="input text-sm text-right tabular-nums" placeholder="0.00" />
              </div>
            </>}
            <div className="col-span-2">
              <label className="block text-xs text-ink-muted mb-1">Remarks</label>
              <input value={form.remarks ?? ''} onChange={e => set('remarks', e.target.value || null)}
                className="input text-sm" placeholder="Optional notes…" />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/50 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.symbol.trim()}
            className="btn-primary text-sm px-5 py-1.5 flex items-center gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Sell modal ────────────────────────────────────────────────────────────────

function SellModal({
  position, onClose, onSold,
}: {
  position: DbPosition; onClose: () => void; onSold: () => void
}) {
  const maxQty = position.positionSize ?? 0
  const [qty, setQty] = useState(maxQty)
  const [exitPrice, setExitPrice] = useState<number | ''>(position.currentPrice ?? position.entryPrice ?? '')
  const [exitDate, setExitDate] = useState(today())
  const [remarks, setRemarks] = useState('')
  const [selling, setSelling] = useState(false)
  const [error, setError] = useState('')

  const isPartial = qty > 0 && qty < maxQty
  const isFull = qty === maxQty

  const submit = async () => {
    if (!exitPrice || qty <= 0) { setError('Enter a valid quantity and exit price'); return }
    if (qty > maxQty) { setError(`Max sell quantity is ${maxQty}`); return }
    setSelling(true)
    setError('')
    try {
      await portfolioDbService.sell(position.id, qty, Number(exitPrice), exitDate, remarks || undefined)
      onSold()
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Sell failed')
    } finally {
      setSelling(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-loss" />
              Sell — {position.symbol}
            </h2>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {position.direction} · {maxQty.toLocaleString()} shares open · Entry {fmt(position.entryPrice)}
            </p>
          </div>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-loss bg-loss/8 border border-loss/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
            </div>
          )}

          {/* Quantity slider + input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-ink-muted">Sell Quantity</label>
              <span className={cn('text-xs font-semibold', isFull ? 'text-loss' : 'text-amber-400')}>
                {isFull ? 'Full sell' : `Partial — ${maxQty - qty} remaining`}
              </span>
            </div>
            <input
              type="range" min={1} max={maxQty} value={qty}
              onChange={e => setQty(parseInt(e.target.value))}
              className="w-full accent-brand-500 mb-2"
            />
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={maxQty} value={qty}
                onChange={e => setQty(Math.min(maxQty, Math.max(1, parseInt(e.target.value) || 1)))}
                className="input text-sm text-right tabular-nums flex-1" />
              <button onClick={() => setQty(maxQty)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-ink-muted hover:text-ink-primary transition-colors whitespace-nowrap">
                All {maxQty.toLocaleString()}
              </button>
            </div>
          </div>

          {/* Exit price */}
          <div>
            <label className="block text-xs text-ink-muted mb-1.5">Exit Price *</label>
            <input type="number" step="any" value={exitPrice}
              onChange={e => setExitPrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="input text-sm text-right tabular-nums" placeholder="0.00" />
            {exitPrice !== '' && position.entryPrice != null && (
              <p className={cn('text-xs mt-1', Number(exitPrice) >= position.entryPrice ? 'text-gain' : 'text-loss')}>
                {(() => {
                  const diff = (Number(exitPrice) - (position.entryPrice ?? 0))
                  const pct = position.entryPrice ? (diff / position.entryPrice * 100) : 0
                  const total = diff * qty
                  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) · Net ${total >= 0 ? '+' : ''}${total.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`
                })()}
              </p>
            )}
          </div>

          {/* Exit date */}
          <div>
            <label className="block text-xs text-ink-muted mb-1.5">Exit Date</label>
            <input type="date" value={exitDate} onChange={e => setExitDate(e.target.value)}
              className="input text-sm" />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs text-ink-muted mb-1.5">Remarks</label>
            <input value={remarks} onChange={e => setRemarks(e.target.value)}
              className="input text-sm" placeholder="Optional note for this sell…" />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/50 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
          <button onClick={submit} disabled={selling || !exitPrice || qty <= 0}
            className="text-sm px-5 py-1.5 rounded-lg bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors flex items-center gap-2 disabled:opacity-50">
            {selling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isFull ? 'Sell All' : `Sell ${qty.toLocaleString()}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Confirm delete modal ───────────────────────────────────────────────────────

function DeleteModal({ pos, onConfirm, onClose, loading }: {
  pos: DbPosition; onConfirm: () => void; onClose: () => void; loading: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-loss/15 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-loss" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-primary">Delete position?</p>
            <p className="text-xs text-ink-muted mt-1">
              <span className="font-medium text-ink-secondary">{pos.symbol}</span>
              {pos.positionSize ? ` · ${pos.positionSize.toLocaleString()} shares` : ''} will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            className="text-sm px-4 py-1.5 rounded-lg bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors flex items-center gap-2">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioDbPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'active' | 'closed' | 'all'>('active')
  const [editTarget, setEditTarget] = useState<DbPosition | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DbPosition | null>(null)
  const [sellTarget, setSellTarget] = useState<DbPosition | null>(null)
  const [mutating, setMutating] = useState(false)
  const [undoing, setUndoing] = useState<string | null>(null)

  const { data: positions = [], isLoading, refetch } = useQuery({
    queryKey: ['portfolio-db-positions', statusFilter],
    queryFn: () => portfolioDbService.getPositions(statusFilter),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['portfolio-db-positions'] })

  const handleCreate = async (input: PositionInput) => {
    setMutating(true)
    try { await portfolioDbService.create(input); setCreateOpen(false); await invalidate() }
    finally { setMutating(false) }
  }

  const handleUpdate = async (input: PositionInput) => {
    if (!editTarget) return
    setMutating(true)
    try { await portfolioDbService.update(editTarget.id, input); setEditTarget(null); await invalidate() }
    finally { setMutating(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setMutating(true)
    try { await portfolioDbService.delete(deleteTarget.id); setDeleteTarget(null); await invalidate() }
    finally { setMutating(false) }
  }

  const handleUndo = async (pos: DbPosition) => {
    setUndoing(pos.id)
    try { await portfolioDbService.undoSell(pos.id); await invalidate() }
    catch (e: any) { alert(e?.response?.data?.detail ?? 'Undo failed') }
    finally { setUndoing(null) }
  }

  const totalPnl = positions.reduce((s, p) => s + p.netPnl, 0)

  // Group: parents first, then children nested under their parent
  const parentRows = positions.filter(p => !p.parentId)
  const childMap = positions.reduce<Record<string, DbPosition[]>>((acc, p) => {
    if (p.parentId) { (acc[p.parentId] ??= []).push(p) }
    return acc
  }, {})

  const orderedRows: { pos: DbPosition; isChild: boolean }[] = []
  for (const parent of parentRows) {
    orderedRows.push({ pos: parent, isChild: false })
    for (const child of (childMap[parent.id] ?? []).sort((a, b) =>
      (a.createdAt ?? '') > (b.createdAt ?? '') ? -1 : 1)) {
      orderedRows.push({ pos: child, isChild: true })
    }
  }
  // Any orphaned children (parent in different filter view)
  const orphanChildren = positions.filter(p => p.parentId && !childMap[p.parentId.split('')[0]])
  for (const child of orphanChildren) {
    if (!orderedRows.find(r => r.pos.id === child.id)) {
      orderedRows.push({ pos: child, isChild: true })
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink-primary">Portfolio Manager</h1>
          <p className="text-xs text-ink-muted mt-0.5">Add, edit, and sell positions directly in the database.</p>
        </div>
        <div className="flex items-center gap-2">
          {(['active', 'closed', 'all'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                statusFilter === s ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                  : 'text-ink-muted border-border hover:text-ink-primary')}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <button onClick={() => refetch()} className="btn-icon" title="Refresh">
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Position
          </button>
        </div>
      </div>

      {/* Summary */}
      {positions.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-ink-muted">{positions.length} record{positions.length !== 1 ? 's' : ''}</span>
          <span className={cn('font-semibold', totalPnl >= 0 ? 'text-gain' : 'text-loss')}>
            Total P&L: {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿
          </span>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 1000 }}>
            <thead>
              <tr className="border-b border-border/50 bg-surface-elevated/40 text-ink-muted">
                {['SYMBOL', 'DIR', 'ENTRY DATE', 'ENTRY ฿', 'CURRENT / EXIT ฿', 'SIZE', 'NET P&L', 'P&L %', 'SL', 'TP', 'STATUS', 'CREATED', 'MODIFIED', ''].map(h => (
                  <th key={h} className="px-2.5 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…
                </td></tr>
              ) : orderedRows.length === 0 ? (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-ink-muted">
                  No positions. Click <span className="text-brand-400 font-medium">Add Position</span> to start.
                </td></tr>
              ) : orderedRows.map(({ pos, isChild }) => {
                const isUp = pos.netPnl >= 0
                const isActive = pos.status === 'active'
                return (
                  <tr key={pos.id} className={cn(
                    'border-b border-border/25 transition-colors',
                    isChild ? 'bg-surface-elevated/20 hover:bg-surface-elevated/40' : 'hover:bg-surface-elevated/30',
                  )}>
                    {/* Symbol */}
                    <td className="px-2.5 py-2">
                      {isChild ? (
                        <span className="flex items-center gap-1 text-ink-muted">
                          <CornerDownRight className="w-3 h-3 shrink-0 text-ink-disabled" />
                          <span className="font-semibold text-ink-secondary">{pos.symbol}</span>
                          <span className="text-[10px] text-ink-disabled font-normal">sold</span>
                        </span>
                      ) : (
                        <span className="font-bold text-ink-primary">{pos.symbol}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      <span className={pos.direction === 'LONG' ? 'text-gain font-medium' : 'text-loss font-medium'}>
                        {pos.direction === 'LONG' ? '↑ L' : '↓ S'}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-ink-muted">{fmtDate(pos.entryDate)}</td>
                    <td className="px-2.5 py-2 tabular-nums">{fmt(pos.entryPrice)}</td>
                    <td className="px-2.5 py-2 tabular-nums font-medium text-ink-primary">
                      {isActive ? fmt(pos.currentPrice) : (
                        <span className="text-ink-secondary">{fmt(pos.exitPrice)}</span>
                      )}
                      {!isActive && pos.exitDate && (
                        <div className="text-[10px] text-ink-disabled">{fmtDate(pos.exitDate)}</div>
                      )}
                    </td>
                    <td className="px-2.5 py-2 tabular-nums text-ink-secondary">
                      {pos.positionSize?.toLocaleString() ?? '—'}
                    </td>
                    <td className={cn('px-2.5 py-2 tabular-nums font-semibold', isUp ? 'text-gain' : 'text-loss')}>
                      {isUp ? '+' : ''}{fmt(pos.netPnl, 0)}
                    </td>
                    <td className={cn('px-2.5 py-2 tabular-nums', isUp ? 'text-gain' : 'text-loss')}>
                      {isUp ? '+' : ''}{fmt(pos.pnlPct)}%
                    </td>
                    <td className="px-2.5 py-2 tabular-nums text-ink-muted">{fmt(pos.sl)}</td>
                    <td className="px-2.5 py-2 tabular-nums text-ink-muted">{fmt(pos.tp)}</td>
                    <td className="px-2.5 py-2">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                        isActive ? 'bg-gain/15 text-gain' : 'bg-ink-muted/15 text-ink-muted')}>
                        {pos.status}
                      </span>
                    </td>
                    {/* Created / Modified */}
                    <td className="px-2.5 py-2 text-ink-disabled text-[10px] whitespace-nowrap">
                      {fmtDateTime(pos.createdAt)}
                    </td>
                    <td className="px-2.5 py-2 text-ink-disabled text-[10px] whitespace-nowrap">
                      {fmtDateTime(pos.updatedAt)}
                    </td>
                    {/* Actions */}
                    <td className="px-2.5 py-2 pr-3">
                      <div className="flex items-center gap-0.5">
                        {!isChild && (
                          <button onClick={() => setEditTarget(pos)} className="btn-icon" title="Edit">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isActive && !isChild && (
                          <button onClick={() => setSellTarget(pos)}
                            className="btn-icon text-loss/70 hover:text-loss" title="Sell">
                            <TrendingDown className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {pos.hasChildren && !isChild && (
                          <button
                            onClick={() => handleUndo(pos)}
                            disabled={undoing === pos.id}
                            className="btn-icon text-amber-500/70 hover:text-amber-400"
                            title="Undo last sell"
                          >
                            {undoing === pos.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Undo2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(pos)}
                          className="btn-icon text-ink-disabled hover:text-loss" title="Delete">
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
        {createOpen && (
          <PositionModal title="Add Position" initial={emptyInput()}
            onSave={handleCreate} onClose={() => setCreateOpen(false)} saving={mutating} />
        )}
        {editTarget && (
          <PositionModal
            title={`Edit — ${editTarget.symbol}`}
            subtitle={`Created ${fmtDateTime(editTarget.createdAt)} · Updated ${fmtDateTime(editTarget.updatedAt)}`}
            initial={positionToInput(editTarget)}
            onSave={handleUpdate} onClose={() => setEditTarget(null)} saving={mutating} />
        )}
        {sellTarget && (
          <SellModal position={sellTarget}
            onClose={() => setSellTarget(null)} onSold={invalidate} />
        )}
        {deleteTarget && (
          <DeleteModal pos={deleteTarget} loading={mutating}
            onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
