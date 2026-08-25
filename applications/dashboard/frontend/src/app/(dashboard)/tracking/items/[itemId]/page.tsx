'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import {
  ArrowLeft, Save, Loader2, AlertCircle, Plus, Edit2, Trash2, X,
  BookOpen, Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  trackingService, TRACKING_ITEM_TYPES,
  type TrackingItem, type TrackingItemType, type Entry,
} from '@/services/tracking'
import { extractApiError } from '@/services/api'
import { ConfirmDeleteModal } from '@/components/tracking/ConfirmDeleteModal'

const todayIso = () => format(new Date(), 'yyyy-MM-dd')

// ── Yes/No segmented toggle ────────────────────────────────────────────────────

function YesNoToggle({
  id, label, value, onChange, hint, disabled,
}: {
  id: string
  label: string
  value: boolean
  onChange: (v: boolean) => void
  hint?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <span id={`${id}-label`} className="block text-xs font-medium text-ink-secondary">{label}</span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex gap-1 w-fit">
        {[{ v: true, text: 'Yes' }, { v: false, text: 'No' }].map(opt => (
          <button
            key={String(opt.v)}
            type="button"
            disabled={disabled}
            aria-pressed={value === opt.v}
            onClick={() => onChange(opt.v)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50',
              value === opt.v
                ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                : 'border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
            )}
          >
            {opt.text}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11px] text-ink-disabled">{hint}</p>}
    </div>
  )
}

// ── Ledger entry form (add / edit) ────────────────────────────────────────────

function EntryForm({
  initial, onClose, onSave,
}: {
  initial?: Entry | null
  onClose: () => void
  onSave: (entryDate: string, amount: number) => Promise<void>
}) {
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? todayIso())
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt === 0) {
      setError('Amount must be a non-zero number (use a negative value to reduce the balance).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(entryDate, amt)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="card p-4 border border-brand-500/20 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">{initial ? 'Edit Entry' : 'New Entry'}</h3>
        <button onClick={onClose} className="btn-icon" aria-label="Close entry form"><X className="w-4 h-4" /></button>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="entry-date" className="text-xs font-medium text-ink-secondary">Date</label>
          <input
            id="entry-date"
            type="date"
            className="input text-sm"
            value={entryDate}
            onChange={e => setEntryDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="entry-amount" className="text-xs font-medium text-ink-secondary">
            Amount <span className="text-ink-disabled">(negative to reduce)</span>
          </label>
          <input
            id="entry-amount"
            type="number"
            step="0.01"
            className="input text-sm w-40"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 1000 or -500"
            required
          />
        </div>
        <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {initial ? 'Update' : 'Add'}
        </button>
      </form>
      {error && (
        <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">{error}</p>
      )}
    </motion.div>
  )
}

// ── Ledger section ─────────────────────────────────────────────────────────────

function LedgerSection({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [deleteEntry, setDeleteEntry] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tracking-running-total', itemId],
    queryFn: () => trackingService.getRunningTotal(itemId),
    staleTime: 10_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tracking-running-total', itemId] })

  const handleAdd = async (entryDate: string, amount: number) => {
    await trackingService.createEntry(itemId, { entryDate, amount })
    setShowAdd(false)
    await invalidate()
    toast.success('Entry added')
  }

  const handleEdit = async (entryDate: string, amount: number) => {
    if (!editEntry) return
    await trackingService.updateEntry(editEntry.id, { entryDate, amount })
    setEditEntry(null)
    await invalidate()
    toast.success('Entry updated')
  }

  const handleDelete = async () => {
    if (!deleteEntry) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await trackingService.deleteEntry(deleteEntry.id)
      setDeleteEntry(null)
      await invalidate()
    } catch (err) {
      setDeleteError(extractApiError(err))
    } finally {
      setDeleting(false)
    }
  }

  const fmtAmount = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)
  const fmtDate = (iso: string) => format(new Date(iso), 'dd MMM yyyy')

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-brand-400" /> Initial Investment Ledger
          </h2>
          {data && (
            <p className="text-xs text-ink-muted mt-0.5">
              Current total: <span className="font-semibold text-ink-primary font-mono">{fmtAmount(data.currentTotal)}</span>
            </p>
          )}
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Entry
        </button>
      </div>

      <AnimatePresence>
        {showAdd && <EntryForm onClose={() => setShowAdd(false)} onSave={handleAdd} />}
        {editEntry && <EntryForm initial={editEntry} onClose={() => setEditEntry(null)} onSave={handleEdit} />}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading ledger…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-8 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Failed to load ledger entries.
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="py-8 text-center text-ink-muted text-sm">
          No entries yet. Click <span className="text-brand-400 font-medium">Add Entry</span> to record the first investment amount.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-ink-muted">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Running Total</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map(entry => (
                <tr key={entry.id} className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-3 py-2 text-ink-secondary whitespace-nowrap">{fmtDate(entry.entryDate)}</td>
                  <td className={cn('px-3 py-2 text-right font-mono font-medium', entry.amount >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtAmount(entry.amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary">{fmtAmount(entry.runningTotal)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditEntry(entry)} aria-label={`Edit entry on ${fmtDate(entry.entryDate)}`} className="btn-icon w-7 h-7">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteEntry(entry)} aria-label={`Delete entry on ${fmtDate(entry.entryDate)}`} className="btn-icon w-7 h-7 text-loss/70 hover:text-loss">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {deleteEntry && (
          <ConfirmDeleteModal
            entityLabel="ledger entry"
            entityName={`${fmtDate(deleteEntry.entryDate)} — ${fmtAmount(deleteEntry.amount)}`}
            loading={deleting}
            error={deleteError}
            onConfirm={handleDelete}
            onClose={() => { setDeleteEntry(null); setDeleteError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TrackingItemDetailPage() {
  const params = useParams<{ itemId: string }>()
  const itemId = params.itemId
  const queryClient = useQueryClient()

  const { data: item, isLoading, isError } = useQuery({
    queryKey: ['tracking-item', itemId],
    queryFn: () => trackingService.getItem(itemId),
  })

  // Editable form state, hydrated once from the loaded item.
  const [form, setForm] = useState<{
    name: string
    type: TrackingItemType
    initialInvestmentTracking: boolean
    exclusive: boolean
    description: string
    accountName: string
    remark: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (item && !form) {
      setForm({
        name: item.name,
        type: item.type,
        initialInvestmentTracking: item.initialInvestmentTracking,
        exclusive: item.exclusive,
        description: item.description ?? '',
        accountName: item.accountName ?? '',
        remark: item.remark ?? '',
      })
    }
  }, [item, form])

  const setField = <K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) =>
    setForm(prev => (prev ? { ...prev, [key]: value } : prev))

  const handleSave = async () => {
    if (!form) return
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setSaveError('Name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await trackingService.updateItem(itemId, {
        name: trimmedName,
        type: form.type,
        initialInvestmentTracking: form.initialInvestmentTracking,
        exclusive: form.exclusive,
        description: form.description.trim() || null,
        accountName: form.accountName.trim() || null,
        remark: form.remark.trim() || null,
      })
      await queryClient.invalidateQueries({ queryKey: ['tracking-item', itemId] })
      toast.success('Item saved')
    } catch (err) {
      setSaveError(extractApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Breadcrumb — this page has no sidebar entry of its own */}
      <Link
        href="/tracking/category"
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-400 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Category page
      </Link>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading item…
        </div>
      ) : isError || !item || !form ? (
        <div className="flex items-center justify-center py-16 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Failed to load this tracking item.
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-bold text-ink-primary">{item.name}</h1>
            <p className="text-xs text-ink-muted mt-0.5">Tracking Item detail</p>
          </div>

          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="item-name" className="block text-xs font-medium text-ink-secondary">Name</label>
                <input
                  id="item-name"
                  className="input w-full text-sm"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="item-type" className="block text-xs font-medium text-ink-secondary">Type</label>
                <select
                  id="item-type"
                  className="input w-full text-sm"
                  value={form.type}
                  onChange={e => setField('type', e.target.value as TrackingItemType)}
                >
                  {TRACKING_ITEM_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <YesNoToggle
                id="initial-investment-tracking"
                label="Initial Investment Tracking"
                value={form.initialInvestmentTracking}
                onChange={v => setField('initialInvestmentTracking', v)}
                hint="When Yes, a ledger appears below to record the original investment amount over time."
              />
              <YesNoToggle
                id="exclusive"
                label="Exclusive"
                value={form.exclusive}
                onChange={v => setField('exclusive', v)}
                hint="Reserved for future rollup reporting — has no visible effect yet in this phase."
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="item-account-name" className="block text-xs font-medium text-ink-secondary">Account name</label>
              <input
                id="item-account-name"
                className="input w-full text-sm"
                value={form.accountName}
                onChange={e => setField('accountName', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="item-description" className="block text-xs font-medium text-ink-secondary">Description</label>
              <textarea
                id="item-description"
                rows={2}
                className="input w-full text-sm resize-none"
                value={form.description}
                onChange={e => setField('description', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="item-remark" className="block text-xs font-medium text-ink-secondary">Remark</label>
              <textarea
                id="item-remark"
                rows={2}
                className="input w-full text-sm resize-none"
                value={form.remark}
                onChange={e => setField('remark', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 text-[11px] text-ink-disabled">
              <Info className="w-3.5 h-3.5 shrink-0" />
              Order: {item.order} (change from the Category page using the item's up/down controls)
            </div>

            {saveError && (
              <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">{saveError}</p>
            )}

            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>

          {/*
            Gated on `item.initialInvestmentTracking` — the persisted, server-confirmed
            value from the query cache — NOT `form.initialInvestmentTracking` (the local,
            possibly-unsaved pending edit). The backend 400s both GET running-total and
            POST entries until the item's persisted flag is true, so mounting this section
            off the pending toggle would fire a doomed query the moment the user flips the
            toggle but before they click Save. The toggle control itself still reflects
            `form.initialInvestmentTracking` so the user sees their in-progress change —
            only the ledger's visibility waits for a successful save + refetch.
          */}
          {item.initialInvestmentTracking && <LedgerSection itemId={itemId} />}
        </>
      )}
    </div>
  )
}
