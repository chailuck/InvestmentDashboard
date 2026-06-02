'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  GitBranch, Plus, Pencil, Trash2, Check, X, Loader2,
  Info, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  drMappingService, PARENT_MARKETS,
  type DrMapping, type DrMappingCreate,
} from '@/services/drMapping'

function autoDesc(parentSymbol: string, ratio: number, drSymbol: string): string {
  const r = ratio === Math.floor(ratio) ? ratio.toFixed(0) : ratio.toString()
  return `1 ${parentSymbol} = ${r} ${drSymbol}`
}
import { useAuthStore } from '@/store/auth'

// ── Inline form ───────────────────────────────────────────────────────────────

const BLANK: DrMappingCreate = {
  dr_symbol: '', parent_symbol: '', parent_market: 'CRYPTO', ratio: 1000,
  is_active: true,
}

function MappingForm({
  initial, onSave, onCancel, saving,
}: {
  initial: DrMappingCreate
  onSave: (v: DrMappingCreate) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof DrMappingCreate, v: any) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-surface-elevated/60 rounded-xl border border-border/50">
      {/* DR symbol */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">DR Symbol *</label>
        <input value={form.dr_symbol} onChange={e => set('dr_symbol', e.target.value.toUpperCase())}
          placeholder="BTCUSD-DR" className="input w-full text-xs py-1.5 font-mono" />
      </div>

      {/* Parent symbol */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Parent Symbol *</label>
        <input value={form.parent_symbol} onChange={e => set('parent_symbol', e.target.value.toUpperCase())}
          placeholder="BTC-USD" className="input w-full text-xs py-1.5 font-mono" />
      </div>

      {/* Parent market */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Parent Market *</label>
        <select value={form.parent_market} onChange={e => set('parent_market', e.target.value)}
          className="input w-full text-xs py-1.5">
          {PARENT_MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Ratio */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
          Unit Ratio *
          <span className="ml-1 text-ink-disabled font-normal normal-case">
            (1 parent = N DR units)
          </span>
        </label>
        <input type="number" step="1" min="1" value={form.ratio}
          onChange={e => set('ratio', parseFloat(e.target.value) || 1)}
          className="input w-full text-xs py-1.5 font-mono" />
      </div>

      {/* Auto-description preview */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Description (auto)</label>
        <div className="input w-full text-xs py-1.5 font-mono text-ink-muted bg-surface-elevated/40 select-none">
          {form.dr_symbol && form.parent_symbol
            ? autoDesc(form.parent_symbol, form.ratio, form.dr_symbol)
            : <span className="text-ink-disabled">Fill in symbols above…</span>}
        </div>
      </div>

      {/* Active toggle + buttons */}
      <div className="flex items-end gap-2">
        <button onClick={() => set('is_active', !form.is_active)}
          className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
            form.is_active
              ? 'border-gain/30 bg-gain/8 text-gain'
              : 'border-border text-ink-muted'
          )}>
          {form.is_active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
          {form.is_active ? 'Active' : 'Inactive'}
        </button>
        <button onClick={() => onSave(form)} disabled={saving || !form.dr_symbol || !form.parent_symbol || !form.ratio}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors disabled:opacity-40">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </button>
        <button onClick={onCancel} className="btn-ghost text-xs py-1.5 gap-1.5">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DrMappingsPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: mappings = [], isLoading } = useQuery<DrMapping[]>({
    queryKey: ['dr-mappings'],
    queryFn: () => drMappingService.list(),
    staleTime: 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['dr-mappings'] })

  const handleCreate = async (form: DrMappingCreate) => {
    setSaving(true); setError(null)
    try {
      await drMappingService.create(form)
      setAdding(false)
      refresh()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to create mapping')
    } finally { setSaving(false) }
  }

  const handleUpdate = async (id: number, form: DrMappingCreate) => {
    setSaving(true); setError(null)
    try {
      await drMappingService.update(id, form)
      setEditId(null)
      refresh()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to update mapping')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number, sym: string) => {
    if (!confirm(`Delete mapping for ${sym}?`)) return
    setDeletingId(id)
    try {
      await drMappingService.delete(id)
      refresh()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to delete')
    } finally { setDeletingId(null) }
  }

  return (
    <div className="max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GitBranch className="w-5 h-5 text-brand-400" />
          <div>
            <h1 className="text-lg font-bold text-ink-primary">DR Symbol Mappings</h1>
            <p className="text-xs text-ink-muted">
              Maps Thai-listed Depository Receipts to their parent assets with a price ratio.
              Global — visible to all users.
            </p>
          </div>
        </div>
        {isAdmin && !adding && (
          <button onClick={() => { setAdding(true); setEditId(null) }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Mapping
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-loss/30 bg-loss/8 text-xs text-loss">
          <X className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto shrink-0 btn-icon"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Add form */}
      {adding && isAdmin && (
        <MappingForm
          initial={BLANK}
          onSave={handleCreate}
          onCancel={() => setAdding(false)}
          saving={saving}
        />
      )}

      {/* Info box — formula explanation */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-brand-500/20 bg-brand-500/5 text-xs text-ink-secondary">
        <Info className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-ink-primary">How the ratio works</p>
          <p>
            <strong>Unit Ratio</strong> = how many DR units equal 1 parent unit
          </p>
          <p>
            <strong>DR price (฿)</strong> = parent price (USD) ÷ ratio × USD/THB rate
          </p>
          <p className="text-ink-muted">
            Example: BTCUSD-DR ratio = 1000 → 1 BTC-USD = 1,000 BTCUSD-DR.
            If BTC = $60,000 and USD/THB = 34 → DR ≈ (60,000 ÷ 1,000) × 34 = ฿2,040.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-ink-muted">
            <GitBranch className="w-8 h-8 opacity-30" />
            <p className="text-sm">No DR mappings configured yet.</p>
            {isAdmin && <p className="text-xs">Click <strong className="text-ink-secondary">Add Mapping</strong> to create one.</p>}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 bg-surface-elevated">
                <th className="px-4 py-2.5 text-left text-ink-muted font-semibold">DR Symbol</th>
                <th className="px-4 py-2.5 text-left text-ink-muted font-semibold">Parent Symbol</th>
                <th className="px-4 py-2.5 text-left text-ink-muted font-semibold">Market</th>
                <th className="px-4 py-2.5 text-right text-ink-muted font-semibold">Ratio</th>
                <th className="px-4 py-2.5 text-left text-ink-muted font-semibold">Description</th>
                <th className="px-4 py-2.5 text-center text-ink-muted font-semibold">Status</th>
                {isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                editId === m.id && isAdmin ? (
                  <tr key={m.id}>
                    <td colSpan={isAdmin ? 7 : 6} className="p-2">
                      <MappingForm
                        initial={{
                          dr_symbol: m.dr_symbol,
                          parent_symbol: m.parent_symbol,
                          parent_market: m.parent_market,
                          ratio: m.ratio,
                          is_active: m.is_active,
                        }}
                        onSave={form => handleUpdate(m.id, form)}
                        onCancel={() => setEditId(null)}
                        saving={saving}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id} className="border-b border-border/20 last:border-0 hover:bg-surface-elevated/40">
                    <td className="px-4 py-3 font-mono font-bold text-ink-primary">{m.dr_symbol}</td>
                    <td className="px-4 py-3 font-mono text-brand-400">{m.parent_symbol}</td>
                    <td className="px-4 py-3 text-ink-secondary">{m.parent_market}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-ink-primary">
                      {m.ratio.toPrecision(4)}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{m.description ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('badge text-[10px]',
                        m.is_active ? 'badge-green' : 'text-ink-disabled border border-border/50 px-1.5 py-0.5 rounded'
                      )}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => { setEditId(m.id); setAdding(false) }}
                            className="btn-icon text-ink-muted hover:text-brand-400">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(m.id, m.dr_symbol)}
                            disabled={deletingId === m.id}
                            className="btn-icon text-ink-muted hover:text-loss">
                            {deletingId === m.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tailwind classes for badge */}
      <style jsx>{`
        .badge-green { background: rgb(26 58 42 / 1); color: #3fb950; padding: 0.1em 0.5em; border-radius: 4px; font-weight: 600; }
      `}</style>
    </div>
  )
}
