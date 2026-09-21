'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import {
  ArrowLeft, Save, Loader2, AlertCircle, Plus, Edit2, Trash2, X,
  BookOpen, Info, TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  trackingService,
  type Entry, type ProfitVsOriginal,
} from '@/services/tracking'
import { useItemTypes, bySortOrder } from '@/hooks/useItemTypes'
import { extractApiError } from '@/services/api'
import { ConfirmDeleteModal } from '@/components/tracking/ConfirmDeleteModal'
import { BondsSection } from '@/components/tracking/BondsSection'
import { SortableHeader, toggleSortState, type SortDirection, type SortState } from '@/components/tracking/SortableHeader'

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
  onSave: (
    entryDate: string,
    amount: number,
    note: string | null,
    code: string | null,
    name: string | null,
  ) => Promise<void>
}) {
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? todayIso())
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [name, setName] = useState(initial?.name ?? '')
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
      await onSave(entryDate, amt, note.trim() || null, code.trim() || null, name.trim() || null)
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
        <div className="space-y-1 w-full">
          <label htmlFor="entry-note" className="text-xs font-medium text-ink-secondary">Note (optional)</label>
          <textarea
            id="entry-note"
            rows={2}
            maxLength={500}
            className="input text-sm w-full resize-none"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional — up to 500 characters"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="entry-code" className="text-xs font-medium text-ink-secondary">Code (optional)</label>
          <input
            id="entry-code"
            type="text"
            maxLength={100}
            className="input text-sm w-40"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="entry-name" className="text-xs font-medium text-ink-secondary">Name (optional)</label>
          <input
            id="entry-name"
            type="text"
            maxLength={100}
            className="input text-sm w-48"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Optional"
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

// ── Profit vs Original panel ──────────────────────────────────────────────────
//
// Read-only view of the item's cost basis vs its most-recent balance
// snapshot, driven entirely by the server-computed `profitVsOriginal` block
// on the running-total response. "No original investment logged" / no
// snapshot is a first-class state here — every absent figure renders as an
// em dash, NEVER as a fabricated 0 / "0%" / "100%". `profitPercent` is shown
// verbatim from the server (rounded for display only) and never derived
// client-side.

function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2)
}

function ProfitVsOriginalPanel({ data }: { data: ProfitVsOriginal }) {
  const { netOriginalInvestment, currentValue, currentValueSlot, profit, profitPercent } = data

  return (
    <div className="card p-4 border border-border/60 space-y-2" data-testid="profit-vs-original">
      <h3 className="text-xs font-semibold text-ink-primary flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-brand-400" /> Profit vs Original
      </h3>

      {currentValue === null ? (
        <p className="text-xs text-ink-muted">
          No snapshot yet — profit vs original appears once this item has a balance in an update list.
        </p>
      ) : (
        <dl className="text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Original investment (cost basis)</dt>
            <dd className="font-mono text-ink-primary">
              {netOriginalInvestment === null ? '—' : fmtSigned(netOriginalInvestment)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Current balance / snapshot</dt>
            <dd className="font-mono text-ink-primary">
              {fmtSigned(currentValue)}
              {currentValueSlot && (
                <span className="ml-1.5 font-sans text-ink-disabled">
                  as of Q{currentValueSlot.quarter} {currentValueSlot.year}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Profit vs original</dt>
            <dd
              className={cn(
                'font-mono font-medium',
                profit === null ? 'text-ink-disabled' : profit >= 0 ? 'text-gain' : 'text-loss',
              )}
            >
              {profit === null ? '—' : fmtSigned(profit)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Profit %</dt>
            <dd className="font-mono text-ink-primary">
              {profitPercent === null ? '—' : `${profitPercent.toFixed(2)}%`}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

// ── Client-side ledger sorting ───────────────────────────────────────────────
// The ledger's running total is computed by the backend in chronological
// (entry date) order, so the default sort MUST be Date ascending — otherwise
// the Running Total column's individual values stay correct but no longer
// read as monotonically increasing down the page, which looks like a bug.
// When the user actively sorts by any other column, an inline hint below the
// table clarifies that Running Total still reflects chronological order.
//
// Pattern mirrors `BondsSection`'s register sort exactly (same nulls-last
// convention, same shared `SortableHeader`) — see that file for the sibling
// implementation this was modeled on.

type LedgerEntry = Entry & { runningTotal: number }

type LedgerSortColumn = 'entryDate' | 'amount' | 'runningTotal' | 'note' | 'code' | 'name'

/** Treat a blank/whitespace-only string the same as `null` for sorting purposes. */
const blankToNull = (s: string | null): string | null => (s && s.trim() !== '' ? s : null)

/** The raw value the sort reads for a column — used only for the null check. */
const LEDGER_SORT_FIELD: Record<LedgerSortColumn, (e: LedgerEntry) => unknown> = {
  entryDate: e => e.entryDate,
  amount: e => e.amount,
  runningTotal: e => e.runningTotal,
  note: e => blankToNull(e.note),
  code: e => blankToNull(e.code),
  name: e => blankToNull(e.name),
}

/** Non-null comparator per column (nulls are handled by `sortEntries`). */
const ledgerComparators: Record<LedgerSortColumn, (a: LedgerEntry, b: LedgerEntry) => number> = {
  entryDate:    (a, b) => a.entryDate.localeCompare(b.entryDate),
  amount:       (a, b) => a.amount - b.amount,
  runningTotal: (a, b) => a.runningTotal - b.runningTotal,
  note:         (a, b) => (blankToNull(a.note) as string).localeCompare(blankToNull(b.note) as string),
  code:         (a, b) => (blankToNull(a.code) as string).localeCompare(blankToNull(b.code) as string),
  name:         (a, b) => (blankToNull(a.name) as string).localeCompare(blankToNull(b.name) as string),
}

/** Pure, stable-ish sort: copies the list, keeps nulls/blanks last in both directions. */
function sortEntries(list: LedgerEntry[], column: LedgerSortColumn, direction: SortDirection): LedgerEntry[] {
  const field = LEDGER_SORT_FIELD[column]
  const cmp = ledgerComparators[column]
  const dir = direction === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const aNull = field(a) == null
    const bNull = field(b) == null
    if (aNull && bNull) return 0
    if (aNull) return 1          // null/blank LAST regardless of direction
    if (bNull) return -1
    return dir * cmp(a, b)
  })
}

// ── Ledger section ─────────────────────────────────────────────────────────────

function LedgerSection({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [deleteEntry, setDeleteEntry] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState<LedgerSortColumn>>({ column: 'entryDate', direction: 'asc' })

  // ── Multi-select (bulk delete) ──────────────────────────────────────────
  // Keyed by entry id (not row index/position) so a selection survives a
  // re-sort — `rows` order changes on sort, but `data.entries` identity and
  // ids do not.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [resultAnnouncement, setResultAnnouncement] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tracking-running-total', itemId],
    queryFn: () => trackingService.getRunningTotal(itemId),
    staleTime: 10_000,
  })

  const toggleSort = (column: LedgerSortColumn) => setSort(prev => toggleSortState(prev, column))

  const rows = useMemo(
    () => (data ? sortEntries(data.entries, sort.column, sort.direction) : []),
    [data, sort],
  )

  const allVisibleSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
  const someVisibleSelected = !allVisibleSelected && rows.some(r => selectedIds.has(r.id))

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected
  }, [someVisibleSelected])

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) rows.forEach(r => next.delete(r.id))
      else rows.forEach(r => next.add(r.id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tracking-running-total', itemId] })

  const handleAdd = async (
    entryDate: string, amount: number, note: string | null, code: string | null, name: string | null,
  ) => {
    await trackingService.createEntry(itemId, { entryDate, amount, note, code, name })
    setShowAdd(false)
    await invalidate()
    toast.success('Entry added')
  }

  const handleEdit = async (
    entryDate: string, amount: number, note: string | null, code: string | null, name: string | null,
  ) => {
    if (!editEntry) return
    await trackingService.updateEntry(editEntry.id, { entryDate, amount, note, code, name })
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
      const deletedId = deleteEntry.id
      setDeleteEntry(null)
      // Keep selection state consistent if the row being single-deleted also
      // happened to be part of the current bulk selection.
      setSelectedIds(prev => {
        if (!prev.has(deletedId)) return prev
        const next = new Set(prev)
        next.delete(deletedId)
        return next
      })
      await invalidate()
    } catch (err) {
      setDeleteError(extractApiError(err))
    } finally {
      setDeleting(false)
    }
  }

  const fmtAmount = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)
  const fmtDate = (iso: string) => format(new Date(iso), 'dd MMM yyyy')

  /** Short, capped-length summary of entries for the bulk-delete confirmation. */
  const summarizeEntries = (entries: LedgerEntry[]): string => {
    const shown = entries.slice(0, 5).map(e => `${fmtDate(e.entryDate)} (${fmtAmount(e.amount)})`)
    const extra = entries.length - shown.length
    return `This will delete: ${shown.join(', ')}${extra > 0 ? `, +${extra} more` : ''}.`
  }

  const selectedEntries = rows.filter(r => selectedIds.has(r.id))

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkDeleting(true)
    setBulkError(null)
    setResultAnnouncement('')

    // Look up labels from the un-sorted source list so a label is still
    // available even if the row briefly leaves `rows` mid-batch.
    const byId = new Map((data?.entries ?? []).map(e => [e.id, e]))

    const results = await Promise.allSettled(ids.map(id => trackingService.deleteEntry(id)))

    const succeededIds: string[] = []
    const failed: { id: string; label: string; error: string }[] = []
    results.forEach((result, i) => {
      const id = ids[i]
      if (result.status === 'fulfilled') {
        succeededIds.push(id)
      } else {
        const entry = byId.get(id)
        const label = entry ? `${fmtDate(entry.entryDate)} (${fmtAmount(entry.amount)})` : id
        failed.push({ id, label, error: extractApiError(result.reason) })
      }
    })

    // Clear only the successfully-deleted ids from selection; failed ones
    // stay selected so the user can retry just those.
    setSelectedIds(prev => {
      const next = new Set(prev)
      succeededIds.forEach(id => next.delete(id))
      return next
    })

    // Invalidate exactly once for the whole batch, not once per row.
    await invalidate()

    setBulkDeleting(false)

    if (failed.length === 0) {
      setShowBulkConfirm(false)
      setBulkError(null)
      setResultAnnouncement(`${succeededIds.length} deleted`)
      toast.success(`Deleted ${succeededIds.length} ${succeededIds.length === 1 ? 'entry' : 'entries'}`)
    } else {
      const summary = failed.map(f => `${f.label}: ${f.error}`).join('; ')
      setBulkError(
        `${succeededIds.length} of ${ids.length} deleted. ${failed.length} failed — ${summary}`,
      )
      setResultAnnouncement(`${succeededIds.length} deleted, ${failed.length} failed`)
      toast.error(`${failed.length} ${failed.length === 1 ? 'entry' : 'entries'} failed to delete`)
      // Leave the confirmation modal open (with the error shown) so the user
      // can see what failed and retry just the still-selected rows.
    }
  }

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

      {/* Screen-reader-only announcements — kept separate from the visible
          selection-count text below since they're driven by different
          triggers (selection changes vs. a completed delete batch). */}
      <div aria-live="polite" className="sr-only">
        {selectedIds.size > 0 ? `${selectedIds.size} selected` : ''}
      </div>
      <div aria-live="polite" className="sr-only">{resultAnnouncement}</div>

      <AnimatePresence>
        {showAdd && <EntryForm onClose={() => setShowAdd(false)} onSave={handleAdd} />}
        {editEntry && <EntryForm initial={editEntry} onClose={() => setEditEntry(null)} onSave={handleEdit} />}
      </AnimatePresence>

      {data && data.entries.length >= 1 && (
        <ProfitVsOriginalPanel data={data.profitVsOriginal} />
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20">
          <p className="text-xs text-ink-secondary">{selectedIds.size} selected</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={clearSelection} className="btn-ghost text-xs px-3 py-1.5">
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => { setBulkError(null); setShowBulkConfirm(true) }}
              className="text-xs px-3 py-1.5 rounded-lg bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Selected
            </button>
          </div>
        </div>
      )}

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
        <div className="space-y-1.5">
          {sort.column !== 'entryDate' && (
            <p className="text-[11px] text-ink-disabled">
              Running Total reflects chronological (Date) order and may not appear in sequence under this sort.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-ink-muted">
                  <th className="px-3 py-2 text-left font-medium w-8">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label="Select all ledger entries"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <SortableHeader column="entryDate"     label="Date"          align="left"  sort={sort} onSort={toggleSort} />
                  <SortableHeader column="amount"        label="Amount"        align="right" sort={sort} onSort={toggleSort} />
                  <SortableHeader column="runningTotal"  label="Running Total" align="right" sort={sort} onSort={toggleSort} />
                  <SortableHeader column="note"          label="Note"          align="left"  sort={sort} onSort={toggleSort} />
                  <SortableHeader column="code"          label="Code"          align="left"  sort={sort} onSort={toggleSort} />
                  <SortableHeader column="name"          label="Name"          align="left"  sort={sort} onSort={toggleSort} />
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(entry => (
                  <tr key={entry.id} className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select entry on ${fmtDate(entry.entryDate)}, ${fmtAmount(entry.amount)}`}
                        checked={selectedIds.has(entry.id)}
                        onChange={() => toggleSelectOne(entry.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary whitespace-nowrap">{fmtDate(entry.entryDate)}</td>
                    <td className={cn('px-3 py-2 text-right font-mono font-medium whitespace-nowrap', entry.amount >= 0 ? 'text-gain' : 'text-loss')}>
                      {fmtAmount(entry.amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-primary whitespace-nowrap">{fmtAmount(entry.runningTotal)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      <div className="max-w-[16rem] truncate" title={entry.note ?? ''}>{entry.note ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      <div className="max-w-[8rem] truncate" title={entry.code ?? ''}>{entry.code ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      <div className="max-w-[10rem] truncate" title={entry.name ?? ''}>{entry.name ?? '—'}</div>
                    </td>
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

      <AnimatePresence>
        {showBulkConfirm && (
          <ConfirmDeleteModal
            entityLabel="ledger entries"
            entityName={`${selectedEntries.length} ledger ${selectedEntries.length === 1 ? 'entry' : 'entries'}`}
            cascadeWarning={selectedEntries.length > 0 ? summarizeEntries(selectedEntries) : undefined}
            loading={bulkDeleting}
            error={bulkError}
            onConfirm={handleBulkDelete}
            onClose={() => { setShowBulkConfirm(false); setBulkError(null) }}
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

  // Include archived types so an item already assigned an archived type keeps
  // that option selectable / visible in the picker.
  const { data: itemTypes = [], isLoading: typesLoading } = useItemTypes(true)

  // Editable form state, hydrated once from the loaded item.
  const [form, setForm] = useState<{
    name: string
    typeId: string
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
        typeId: item.typeId,
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

  // Picker options: active (non-archived) types by sort order, PLUS the item's
  // OWN current type even if it has since been archived — so an existing
  // archived assignment stays selectable rather than silently vanishing.
  const typeOptions = (() => {
    const active = itemTypes.filter(t => !t.isArchived)
    const own = item?.itemType
    if (own && !active.some(t => t.id === own.id)) active.push(own)
    return [...active].sort(bySortOrder)
  })()

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
        typeId: form.typeId,
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
    <div className="space-y-4">
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

          <div className="card p-5 space-y-4 max-w-3xl">
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
                  value={form.typeId}
                  disabled={typesLoading}
                  onChange={e => setField('typeId', e.target.value)}
                >
                  {typeOptions.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.label}{t.isArchived ? ' (archived)' : ''}
                    </option>
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

          {/*
            Gated on the PERSISTED item's type capability — `item.itemType`
            from the query cache — NOT the local, possibly-unsaved `form.typeId`
            edit, for the same reason the ledger section above is gated on the
            persisted `initialInvestmentTracking`: the bond endpoints 400 unless
            the item's type provides a bond register, so mounting this off the
            pending <select> value would fire a doomed query the instant the user
            picks a bond-register type but before they click Save. The <select>
            still reflects `form.typeId` so the user sees their in-progress
            change — only the register's visibility waits for a successful
            save + refetch.
          */}
          {item.itemType?.capabilities?.includes('bond_register') && <BondsSection itemId={itemId} />}
        </>
      )}
    </div>
  )
}
