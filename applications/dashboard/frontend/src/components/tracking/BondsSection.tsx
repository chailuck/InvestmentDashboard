'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import {
  Landmark, Loader2, AlertCircle, Plus, Edit2, Trash2, X, Save,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { trackingService, type Bond, type BondInput, type BondStatus } from '@/services/tracking'
import { extractApiError } from '@/services/api'
import { computeBondStatus, computeBondYears } from '@/lib/bond-status'
import { ConfirmDeleteModal } from '@/components/tracking/ConfirmDeleteModal'
import { SortableHeader, toggleSortState, type SortDirection, type SortState } from '@/components/tracking/SortableHeader'

const todayIso = () => format(new Date(), 'yyyy-MM-dd')
const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM yyyy') : '—')

// ── Status badge ─────────────────────────────────────────────────────────────
// The badge's ACCESSIBLE content is the status text itself (not colour alone).
// 'Unknown' renders as an em dash per the fixed requirement, but still carries
// an accessible label so screen-reader users hear a real value.

const STATUS_STYLES: Record<Exclude<BondStatus, 'Unknown'>, string> = {
  Active: 'text-gain bg-gain/10 border border-gain/20',
  'Pre-order': 'text-warning bg-warning/10 border border-warning/20',
  Expire: 'text-loss bg-loss/10 border border-loss/20',
}

function BondStatusBadge({ status }: { status: BondStatus }) {
  if (status === 'Unknown') {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium text-ink-muted"
        aria-label="Status unknown"
        title="Status unknown"
      >
        —
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  )
}

// ── Bond form (add / edit) ───────────────────────────────────────────────────

function BondForm({
  initial, onClose, onSave,
}: {
  initial?: Bond | null
  onClose: () => void
  onSave: (input: BondInput) => Promise<void>
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [issuer, setIssuer] = useState(initial?.issuer ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [expiredDate, setExpiredDate] = useState(initial?.expiredDate ?? '')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [interest, setInterest] = useState(
    initial?.interestRate != null ? String(initial.interestRate) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Transient previews only — the register table always shows the server values.
  const preview = computeBondStatus(startDate || null, expiredDate || null, todayIso())
  const yearsPreview = computeBondYears(startDate || null, expiredDate || null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError('Code is required.')
      return
    }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt < 0) {
      setError('Amount must be a number greater than or equal to 0.')
      return
    }
    // Interest rate is optional; when present it must be a percentage in [0, 100].
    let interestRate: number | null = null
    if (interest.trim() !== '') {
      const rate = parseFloat(interest)
      if (isNaN(rate) || rate < 0 || rate > 100) {
        setError('Interest rate must be a number between 0 and 100.')
        return
      }
      interestRate = rate
    }
    setSaving(true)
    setError(null)
    try {
      // All nullable fields are clearable: send the current value, or `null`
      // when the user has emptied the field. Applies to both create and edit.
      await onSave({
        code: trimmedCode,
        issuer: issuer.trim() || null,
        startDate: startDate || null,
        expiredDate: expiredDate || null,
        amount: amt,
        interestRate,
      })
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
        <h3 className="text-sm font-semibold text-ink-primary">{initial ? 'Edit Bond' : 'New Bond'}</h3>
        <button onClick={onClose} className="btn-icon" aria-label="Close bond form"><X className="w-4 h-4" /></button>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="bond-code" className="text-xs font-medium text-ink-secondary">Code</label>
          <input
            id="bond-code"
            className="input text-sm w-40"
            value={code}
            onChange={e => setCode(e.target.value)}
            maxLength={100}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bond-issuer" className="text-xs font-medium text-ink-secondary">
            Issuer <span className="text-ink-disabled">(optional)</span>
          </label>
          <input
            id="bond-issuer"
            className="input text-sm w-48"
            value={issuer}
            onChange={e => setIssuer(e.target.value)}
            maxLength={200}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bond-start" className="text-xs font-medium text-ink-secondary">
            Start date <span className="text-ink-disabled">(optional)</span>
          </label>
          <input
            id="bond-start"
            type="date"
            className="input text-sm"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bond-expired" className="text-xs font-medium text-ink-secondary">
            Expired date <span className="text-ink-disabled">(optional)</span>
          </label>
          <input
            id="bond-expired"
            type="date"
            className="input text-sm"
            value={expiredDate}
            onChange={e => setExpiredDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bond-amount" className="text-xs font-medium text-ink-secondary">Amount</label>
          <input
            id="bond-amount"
            type="number"
            step="0.01"
            min="0"
            className="input text-sm w-40"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 1000"
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bond-interest" className="text-xs font-medium text-ink-secondary">
            Interest rate <span className="text-ink-disabled">(optional)</span>
          </label>
          <input
            id="bond-interest"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="input text-sm w-40"
            value={interest}
            onChange={e => setInterest(e.target.value)}
            placeholder="e.g. 3.25"
          />
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-ink-secondary">Status preview</span>
          <BondStatusBadge status={preview} />
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-ink-secondary">Years preview</span>
          <span className="text-xs text-ink-primary">
            {yearsPreview === null ? '—' : `${yearsPreview} yr`}
          </span>
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

// ── Client-side register sorting ─────────────────────────────────────────────
// The register table is sorted entirely on the client — the API returns an
// unordered list. Default order is by expiry date ascending. A `null` value in
// the active sort column always sinks to the bottom, in BOTH directions.

type SortColumn =
  | 'code' | 'issuer' | 'startDate' | 'expiredDate' | 'amount' | 'status' | 'interestRate' | 'years'

/** Lifecycle order for status sorting — NOT alphabetical. */
const STATUS_SORT_ORDER: Record<BondStatus, number> = {
  'Pre-order': 1, Active: 2, Expire: 3, Unknown: 4,
}

/** The raw value the sort reads for a column — used only for the null check. */
const SORT_FIELD: Record<SortColumn, (b: Bond) => unknown> = {
  code: b => b.code,
  issuer: b => b.issuer,
  startDate: b => b.startDate,
  expiredDate: b => b.expiredDate,
  amount: b => b.amount,
  status: b => b.status,
  interestRate: b => b.interestRate,
  years: b => b.years,
}

/** Non-null comparator per column (nulls are handled by `sortBonds`). */
const comparators: Record<SortColumn, (a: Bond, b: Bond) => number> = {
  code:         (a, b) => a.code.localeCompare(b.code),
  issuer:       (a, b) => (a.issuer as string).localeCompare(b.issuer as string),
  startDate:    (a, b) => (a.startDate as string).localeCompare(b.startDate as string),
  expiredDate:  (a, b) => (a.expiredDate as string).localeCompare(b.expiredDate as string),
  amount:       (a, b) => a.amount - b.amount,
  status:       (a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status],
  interestRate: (a, b) => (a.interestRate as number) - (b.interestRate as number),
  years:        (a, b) => (a.years as number) - (b.years as number),
}

/** Pure, stable-ish sort: copies the list, keeps nulls last in both directions. */
function sortBonds(list: Bond[], column: SortColumn, direction: SortDirection): Bond[] {
  const field = SORT_FIELD[column]
  const cmp = comparators[column]
  const dir = direction === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const aNull = field(a) == null
    const bNull = field(b) == null
    if (aNull && bNull) return 0
    if (aNull) return 1          // null LAST regardless of direction
    if (bNull) return -1
    return dir * cmp(a, b)
  })
}

// ── Bonds section ────────────────────────────────────────────────────────────

/**
 * Standalone bond register for a `BOND`-typed tracking item. Mirrors the
 * structure of the Initial Investment Ledger section: a React-Query-backed
 * table with add / edit / delete, every mutation invalidating the list query.
 */
export function BondsSection({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editBond, setEditBond] = useState<Bond | null>(null)
  const [deleteBond, setDeleteBond] = useState<Bond | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState<SortColumn>>({ column: 'expiredDate', direction: 'asc' })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tracking-bonds', itemId],
    queryFn: () => trackingService.listBonds(itemId),
    staleTime: 10_000,
  })

  const toggleSort = (column: SortColumn) => setSort(prev => toggleSortState(prev, column))

  const rows = useMemo(
    () => sortBonds(data ?? [], sort.column, sort.direction),
    [data, sort],
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tracking-bonds', itemId] })

  const handleAdd = async (input: BondInput) => {
    await trackingService.createBond(itemId, input)
    setShowAdd(false)
    await invalidate()
    toast.success('Bond added')
  }

  const handleEdit = async (input: BondInput) => {
    if (!editBond) return
    await trackingService.updateBond(editBond.id, input)
    setEditBond(null)
    await invalidate()
    toast.success('Bond updated')
  }

  const handleDelete = async () => {
    if (!deleteBond) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await trackingService.deleteBond(deleteBond.id)
      setDeleteBond(null)
      await invalidate()
    } catch (err) {
      setDeleteError(extractApiError(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
          <Landmark className="w-4 h-4 text-brand-400" /> Bonds
        </h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Bond
        </button>
      </div>

      <AnimatePresence>
        {showAdd && <BondForm onClose={() => setShowAdd(false)} onSave={handleAdd} />}
        {editBond && <BondForm initial={editBond} onClose={() => setEditBond(null)} onSave={handleEdit} />}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bonds…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-8 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Failed to load bonds.
        </div>
      ) : !data || data.length === 0 ? (
        <div className="py-8 text-center text-ink-muted text-sm">No bonds yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-ink-muted">
                <SortableHeader column="code"         label="Code"          align="left"  sort={sort} onSort={toggleSort} />
                <SortableHeader column="issuer"       label="Issuer"        align="left"  sort={sort} onSort={toggleSort} />
                <SortableHeader column="startDate"    label="Start"         align="left"  sort={sort} onSort={toggleSort} />
                <SortableHeader column="expiredDate"  label="Expired"       align="left"  sort={sort} onSort={toggleSort} />
                <SortableHeader column="amount"       label="Amount"        align="right" sort={sort} onSort={toggleSort} />
                <SortableHeader column="status"       label="Status"        align="left"  sort={sort} onSort={toggleSort} />
                <SortableHeader column="interestRate" label="Interest Rate" align="right" sort={sort} onSort={toggleSort} />
                <SortableHeader column="years"        label="Years"         align="right" sort={sort} onSort={toggleSort} />
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(bond => (
                <tr key={bond.id} className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-3 py-2 text-ink-primary font-medium whitespace-nowrap">{bond.code}</td>
                  <td className="px-3 py-2 text-ink-secondary">{bond.issuer ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-secondary whitespace-nowrap">{fmtDate(bond.startDate)}</td>
                  <td className="px-3 py-2 text-ink-secondary whitespace-nowrap">{fmtDate(bond.expiredDate)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary">{bond.amount.toFixed(2)}</td>
                  <td className="px-3 py-2"><BondStatusBadge status={bond.status} /></td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary">
                    {bond.interestRate === null ? '—' : `${bond.interestRate}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary">
                    {bond.years === null ? '—' : bond.years}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditBond(bond)} aria-label={`Edit bond ${bond.code}`} className="btn-icon w-7 h-7">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteBond(bond)} aria-label={`Delete bond ${bond.code}`} className="btn-icon w-7 h-7 text-loss/70 hover:text-loss">
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
        {deleteBond && (
          <ConfirmDeleteModal
            entityLabel="bond"
            entityName={deleteBond.code}
            loading={deleting}
            error={deleteError}
            onConfirm={handleDelete}
            onClose={() => { setDeleteBond(null); setDeleteError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
