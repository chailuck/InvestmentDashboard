'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowLeft, Save, Loader2, AlertCircle, Edit2, X, Layers, ListTree, History, CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  updateTrackingService,
  type UpdateTrackingListItemDetail,
} from '@/services/updateTracking'
import { extractApiError } from '@/services/api'

const fmtDate = (iso: string) => format(new Date(iso), 'dd MMM yyyy')

/** Formats a signed numeric value with 2 decimals, e.g. "+200.00" / "-50.00". */
const fmtAmount = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)

/** Formats a signed percentage with 2 decimals, e.g. "+20.00%" / "-4.50%". */
const fmtPercent = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

/**
 * Defensively coerces a value that may arrive as a JSON number OR a numeric
 * string (Decimal serialization on the backend) into a finite number, or
 * `null` when the value is null/undefined/unparseable. See updateTracking.ts
 * for why this coercion is necessary.
 */
function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Converts a possibly-string, possibly-more-than-2-decimal backend balance
 * value (e.g. `"11500.0000"` — the DB Decimal serialized with up to 4
 * places) into a clean, exactly-2-decimal numeric string for the balance
 * input's state, or `""` when absent/unparseable. Used at hydration time so
 * a balance input never shows 4-decimal precision even before the user has
 * touched it (see also the live-typing cap in `sanitizeNumericInput` and
 * the on-blur normalization in `ItemRow`, which together ensure the field
 * is never more than 2 decimals at any point).
 */
function toBalanceInputString(value: unknown): string {
  const n = toFiniteOrNull(value)
  return n === null ? '' : n.toFixed(2)
}

// ── Comma-formatted balance input helpers ────────────────────────────────────
//
// The Latest Balance input displays live thousand-separator commas while the
// user types (e.g. "1500000" -> "1,500,000"), but always reports a clean,
// comma-free numeric string upstream via the existing `onChange` prop
// contract — so the parent's `values` state and `handleSaveAll`'s
// `Number(raw)` parsing are completely unaffected by this display-only
// formatting.

// NOTE: these helpers are intentionally NOT exported. Next.js App Router
// statically validates that a `page.tsx` module only exports the specific
// names it recognizes (`default`, `metadata`, `generateStaticParams`, ...)
// — any other named export fails the generated `.next/types/.../page.ts`
// type check (and `next build`) with a "does not satisfy the constraint"
// error. See the test file for how these are verified instead: through the
// rendered component's DOM behavior (displayed input value, caret
// position, and the clean value ultimately sent to `upsertBalances`).

/** Removes thousand-separator commas, e.g. "1,500,000.50" -> "1500000.50". */
function stripCommas(formatted: string): string {
  return formatted.replace(/,/g, '')
}

/**
 * Sanitizes a comma-free numeric string as the user types it: keeps at most
 * one leading "-" and at most one ".", strips any other non-digit
 * character, and caps the decimal portion to at most 2 digits. Never
 * throws and never fabricates a "0" — an empty string stays empty so the
 * balance can be cleared.
 *
 * The 2-decimal cap is applied live (a 3rd typed decimal digit is simply
 * dropped, not accepted-then-rounded-later) rather than only on blur,
 * because the backend can carry up to 4 decimal places and that precision
 * must never be reachable through this UI at all — it was never a real
 * requirement here. This does NOT force-pad short decimals (e.g. "11500."
 * or "11500.5") while the user is still typing — that normalization to
 * exactly 2 digits happens on blur (see `ItemRow`'s `handleBlur`), so the
 * user isn't fought mid-keystroke.
 */
function sanitizeNumericInput(raw: string): string {
  const negative = raw.includes('-')
  let s = raw.replace(/-/g, '')
  const dotIndex = s.indexOf('.')
  if (dotIndex !== -1) {
    s = s.slice(0, dotIndex + 1) + s.slice(dotIndex + 1).replace(/\./g, '')
  }
  s = s.replace(/[^\d.]/g, '')
  const decimalDotIndex = s.indexOf('.')
  if (decimalDotIndex !== -1 && s.length - decimalDotIndex - 1 > 2) {
    s = s.slice(0, decimalDotIndex + 3)
  }
  return (negative ? '-' : '') + s
}

/**
 * Formats a clean (comma-free) numeric string with thousand-separator
 * commas on the integer part, preserving a leading "-" and any decimal
 * portion untouched, e.g. "-1500000.5" -> "-1,500,000.5". Passing through
 * "", "-", ".", or "-." leaves them as-is so the input never fights the
 * user mid-keystroke on these interim/invalid-but-in-progress values.
 */
function formatWithCommas(raw: string): string {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return raw
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const dotIndex = unsigned.indexOf('.')
  const intPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex)
  const decPart = dotIndex === -1 ? '' : unsigned.slice(dotIndex)
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (negative ? '-' : '') + withCommas + decPart
}

/** Counts non-comma ("significant") characters in `s` before index `upTo`. */
function countSignificantChars(s: string, upTo: number): number {
  let count = 0
  const end = Math.min(upTo, s.length)
  for (let i = 0; i < end; i++) {
    if (s[i] !== ',') count++
  }
  return count
}

/** Finds the index in `s` immediately after the Nth significant (non-comma) character. */
function positionAfterSignificantChars(s: string, n: number): number {
  if (n <= 0) return 0
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ',') {
      count++
      if (count === n) return i + 1
    }
  }
  return s.length
}

/**
 * Computes where the caret should land in `newValue` after reformatting,
 * given the caret position in `oldValue` (the input's raw DOM value right
 * after the user's keystroke, before we reformat it). Counts significant
 * (non-comma) characters to the left of the old caret, then places the new
 * caret after that same count of significant characters in the reformatted
 * string.
 *
 * This is what keeps the caret from jumping to the end of the field on
 * every keystroke when typing at the end of a long number, AND keeps a
 * mid-string insertion (e.g. typing "2" into "1,500,000" right after the
 * "1," to get "12,500,000") landing right after the inserted character
 * rather than at the end of the field.
 */
function computeCaretPosition(oldValue: string, oldCaret: number, newValue: string): number {
  const significantCount = countSignificantChars(oldValue, oldCaret)
  return positionAfterSignificantChars(newValue, significantCount)
}

// ── Header: transaction date / quarter-year, inline-editable ─────────────────

/**
 * Formats the separate `quarter`/`year` fields into a single display
 * string, e.g. "Q3 2026". Handles a partial value (only one of the two
 * set) gracefully rather than showing something like "Q3 —", and falls
 * back to the same "—" convention used elsewhere on this page when
 * neither is set.
 */
function formatQuarterYear(quarter: number | null, year: number | null): string {
  if (quarter != null && year != null) return `Q${quarter} ${year}`
  if (quarter != null) return `Q${quarter}`
  if (year != null) return String(year)
  return '—'
}

function ListHeader({
  listId, transactionDate, quarter: quarterProp, year: yearProp,
}: {
  listId: string
  transactionDate: string
  quarter: number | null
  year: number | null
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(transactionDate)
  const [quarter, setQuarter] = useState<number | null>(quarterProp)
  const [year, setYear] = useState<number | null>(yearProp)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => {
    setDate(transactionDate)
    setQuarter(quarterProp)
    setYear(yearProp)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateTrackingService.updateUpdateList(listId, {
        transactionDate: date,
        quarter,
        year,
      })
      await queryClient.invalidateQueries({ queryKey: ['update-list-detail', listId] })
      setEditing(false)
      toast.success('Update list saved')
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="edit-list-date" className="text-xs font-medium text-ink-secondary">Transaction Date</label>
          <input
            id="edit-list-date"
            type="date"
            className="input text-sm"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-list-quarter" className="text-xs font-medium text-ink-secondary">Quarter</label>
          <select
            id="edit-list-quarter"
            className="input text-sm"
            value={quarter ?? ''}
            onChange={e => setQuarter(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">—</option>
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-list-year" className="text-xs font-medium text-ink-secondary">Year</label>
          <input
            id="edit-list-year"
            type="number"
            className="input text-sm"
            value={year ?? ''}
            onChange={e => setYear(e.target.value === '' ? null : Number(e.target.value))}
            placeholder="e.g. 2026"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
          <button onClick={() => setEditing(false)} disabled={saving} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
        {error && (
          <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20 w-full">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="card p-4 flex flex-wrap items-center gap-4">
      <div>
        <p className="text-[11px] text-ink-muted">Transaction Date</p>
        <p className="text-sm font-semibold text-ink-primary">{fmtDate(transactionDate)}</p>
      </div>
      <div>
        <p className="text-[11px] text-ink-muted">Quarter/Year</p>
        <p className="text-sm font-semibold text-ink-primary">{formatQuarterYear(quarterProp, yearProp)}</p>
      </div>
      <button
        onClick={startEdit}
        aria-label="Edit transaction date and quarter/year"
        className="btn-icon ml-auto"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Delta cell ─────────────────────────────────────────────────────────────────

/** Shared amount+percent markup used by both the saved `DeltaCell` and the local unsaved-edit preview. */
function DeltaAmountPercent({ amount, percent }: { amount: number; percent: number | null }) {
  const colorClass = amount >= 0 ? 'text-gain' : 'text-loss'
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn('font-mono font-medium', colorClass)}>{fmtAmount(amount)}</span>
      {percent !== null && (
        <span className="text-[10px] text-ink-muted font-normal">({fmtPercent(percent)})</span>
      )}
    </span>
  )
}

function DeltaCell({ item }: { item: UpdateTrackingListItemDetail }) {
  if (!item.hasPreviousData) {
    return <span className="text-ink-disabled text-[11px]">No prior data</span>
  }
  const amount = toFiniteOrNull(item.deltaAmount)
  const percent = toFiniteOrNull(item.deltaPercent)
  if (amount === null) {
    return <span className="text-ink-disabled text-[11px]">—</span>
  }
  return <DeltaAmountPercent amount={amount} percent={percent} />
}

/**
 * Client-side-only preview of the delta for a row with an unsaved edit,
 * shown between blur and Save All. Visually distinguished (reduced opacity
 * + an "(unsaved)" label) from the authoritative, server-computed
 * `DeltaCell` so it's never mistaken for a saved value.
 */
function DeltaPreviewCell({ amount, percent }: { amount: number; percent: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 opacity-70">
      <DeltaAmountPercent amount={amount} percent={percent} />
      <span
        className="text-[9px] uppercase tracking-wide text-ink-muted italic"
        title="Calculated locally from your unsaved edit — not yet saved"
      >
        (unsaved)
      </span>
    </span>
  )
}

// ── Item row ───────────────────────────────────────────────────────────────────

function ItemRow({
  item, value, onChange, isDirty, itemColumnWidth,
}: {
  item: UpdateTrackingListItemDetail
  value: string
  onChange: (value: string) => void
  /** Whether this row has an unsaved local edit (per the parent's `dirty` set). */
  isDirty: boolean
  /**
   * CSS width (e.g. "18ch"), identical across every sub-category table on
   * the page, applied to the Item column so "Latest Balance" (and every
   * column after it) starts at the same x-position in every table — see
   * the `itemColumnWidth` useMemo in the parent for how this is computed.
   */
  itemColumnWidth: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Caret position to restore after the next render triggered by a
  // comma-reformat, computed synchronously in the change handler (before
  // React re-renders with the new, reformatted display value) and applied
  // in a layout effect keyed off that display value — see
  // `computeCaretPosition` for why this is needed.
  const pendingCaretRef = useRef<number | null>(null)
  const displayValue = formatWithCommas(value)

  // Client-side delta preview for an in-progress (dirty) edit, computed on
  // blur using the exact same math as the backend (see
  // tracking-backend/app/services/update_tracking.py::_compute_delta):
  // amount only when a previous balance exists, percent only when that
  // previous balance is ALSO non-zero (never Infinity/NaN). This is a pure
  // local calculation — no network call.
  //
  //   - `null`       -> no preview computed yet (not blurred since the last
  //                      edit, or there's no previousBalance to diff
  //                      against) — falls back to the authoritative,
  //                      server-computed `DeltaCell`.
  //   - `{ kind: 'empty' }` -> the field was blurred while empty. Shown as a
  //                      neutral "—", NOT the stale pre-edit saved delta —
  //                      an empty balance is about to be saved as `null`,
  //                      so showing the old delta would be misleading, and
  //                      empty must never be treated as "0".
  //   - `{ kind: 'amount'; ... }` -> a real computed preview.
  //
  // Intentionally discarded (see effect below) as soon as the row is no
  // longer dirty, so a saved-and-refetched row always shows the
  // authoritative server delta again.
  const [preview, setPreview] = useState<
    { kind: 'empty' } | { kind: 'amount'; amount: number; percent: number | null } | null
  >(null)

  useEffect(() => {
    if (!isDirty) setPreview(null)
  }, [isDirty])

  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current)
      pendingCaretRef.current = null
    }
  }, [displayValue])

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    const oldDisplay = el.value
    const oldCaret = el.selectionStart ?? oldDisplay.length
    const clean = sanitizeNumericInput(stripCommas(oldDisplay))
    const newDisplay = formatWithCommas(clean)
    pendingCaretRef.current = computeCaretPosition(oldDisplay, oldCaret, newDisplay)
    onChange(clean)
  }

  const handleBlur = () => {
    const raw = value.trim()
    // Empty input clears the balance — never treat "no input" as "0". Show
    // a neutral "—" rather than the (now stale) pre-edit saved delta.
    if (raw === '') {
      setPreview({ kind: 'empty' })
      return
    }
    const newBalance = Number(raw)
    if (!Number.isFinite(newBalance)) {
      // Leave an in-progress/invalid value (e.g. a lone "-") untouched
      // rather than fabricating or clearing it; no preview either.
      setPreview(null)
      return
    }
    // Normalize to exactly 2 decimals on blur. Live typing already caps at
    // 2 (see `sanitizeNumericInput`) but never force-pads a short value
    // (e.g. "11500" or "11500.5") while focused — this is where that
    // padding actually happens, so the field always settles back to the
    // "at rest" 2-decimal convention shared with Previous Balance. Only
    // commits the change (which also re-marks the row dirty) when it
    // actually differs, so tabbing through an already-normalized field
    // never spuriously dirties it.
    const normalized = newBalance.toFixed(2)
    if (normalized !== raw) {
      onChange(normalized)
    }
    const previousBalance = toFiniteOrNull(item.previousBalance)
    // No prior balance to diff against: don't fabricate a delta from
    // nothing (mirrors the backend, which only sets deltaAmount when both
    // sides are present) — fall back to the server-rendered cell, which
    // will correctly show "No prior data" in this case.
    if (previousBalance === null) {
      setPreview(null)
      return
    }
    const amount = newBalance - previousBalance
    // previousBalance === 0 still yields a valid amount, but percent is
    // undefined (division by zero) — omit it rather than showing
    // Infinity/NaN, exactly like the backend.
    const percent = previousBalance !== 0 ? (amount / previousBalance) * 100 : null
    setPreview({ kind: 'amount', amount, percent })
  }

  const previousBalance = toFiniteOrNull(item.previousBalance)

  return (
    <tr className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
      <td
        className="px-3 py-2 text-ink-primary font-medium overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ width: itemColumnWidth, minWidth: itemColumnWidth, maxWidth: itemColumnWidth }}
        title={item.name}
      >
        {item.name}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label={`Latest balance for ${item.name}`}
          className="input text-xs text-right w-32 font-mono"
          value={displayValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          placeholder="—"
        />
      </td>
      <td className="px-3 py-2 text-right">
        {isDirty && preview?.kind === 'empty' ? (
          <span className="text-ink-disabled text-[11px]">—</span>
        ) : isDirty && preview?.kind === 'amount' ? (
          <DeltaPreviewCell amount={preview.amount} percent={preview.percent} />
        ) : (
          <DeltaCell item={item} />
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-ink-secondary">
        {previousBalance === null ? (
          <span className="text-ink-disabled text-[11px]">—</span>
        ) : (
          previousBalance.toFixed(2)
        )}
      </td>
      <td className="px-3 py-2">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated border border-border/50 text-ink-secondary">
          {item.type}
        </span>
      </td>
    </tr>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function UpdateTrackingListDetailPage() {
  const params = useParams<{ listId: string }>()
  const listId = params.listId
  const queryClient = useQueryClient()

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['update-list-detail', listId],
    queryFn: () => updateTrackingService.getUpdateListDetail(listId),
  })

  // Local, editable balance-input state keyed by tracking item id. Hydrated
  // once from the loaded detail — the same "hydrate once from server data"
  // pattern the item detail page uses for its edit form — so an
  // invalidate+refetch after Save doesn't clobber the user's in-progress
  // edits on OTHER, still-unsaved fields.
  const [values, setValues] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Populates `values` from the server data once so `handleSaveAll` has an
  // explicit entry for every item (not just ones the user has touched), and
  // flips `hydrated` for the "All changes saved" indicator below. Note this
  // is NOT what makes the balance inputs show the right value on first
  // paint — `ItemRow`'s `value` prop falls back to `item.balance` directly
  // for that, so there's no render where an input is briefly empty while
  // this effect is still pending.
  useEffect(() => {
    if (detail && !hydrated) {
      const initial: Record<string, string> = {}
      for (const cat of detail.categories) {
        for (const sub of cat.subCategories) {
          for (const item of sub.items) {
            initial[item.id] = toBalanceInputString(item.balance)
          }
        }
      }
      setValues(initial)
      setHydrated(true)
    }
  }, [detail, hydrated])

  const totalItemCount = detail
    ? detail.categories.reduce(
        (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.items.length, 0),
        0,
      )
    : 0

  // The page renders one separate <table> per (non-empty) sub-category, so
  // each table would otherwise size its "Item" column independently —
  // meaning "Latest Balance" (and every column after it) could start at a
  // different x-position from one sub-category's table to the next,
  // depending on how long THAT table's item names happen to be. Computing
  // the max item-name length across the ENTIRE list (every category, every
  // sub-category) and applying it as a single shared width fixes that: all
  // tables on the page align on the same column boundaries.
  const itemColumnWidth = useMemo(() => {
    let maxNameLength = 0
    if (detail) {
      for (const cat of detail.categories) {
        for (const sub of cat.subCategories) {
          for (const item of sub.items) {
            maxNameLength = Math.max(maxNameLength, item.name.length)
          }
        }
      }
    }
    // "ch" is an approximation for the proportional font used in the Item
    // cell (an exact glyph-width measurement isn't necessary here — this
    // just needs to be wide enough and, critically, IDENTICAL across every
    // table), plus a few extra characters of padding so typical names
    // aren't flush against the truncation ellipsis. Falls back to a
    // reasonable minimum so the column isn't collapsed when the list is
    // still loading or empty.
    return `${Math.max(maxNameLength + 2, 8)}ch`
  }, [detail])

  const handleChange = (itemId: string, value: string) => {
    setValues(prev => ({ ...prev, [itemId]: value }))
    setDirty(prev => new Set(prev).add(itemId))
  }

  // Save-UX decision: a single "Save All" button that bulk-upserts every
  // touched (dirty) balance field in one call to PUT .../balances, rather
  // than autosaving on blur. Rationale:
  //   1. The backend endpoint is explicitly designed for batch upsert
  //      (`{ balances: [...] }`), not a single-item PUT — autosave-on-blur
  //      would call a bulk endpoint with a 1-element array on every blur,
  //      fighting the API's shape instead of using it as intended.
  //   2. This page can have many items across many categories/sub-categories;
  //      autosave-on-blur means one HTTP round-trip per field as the user
  //      tabs through a snapshot, which is both chattier and gives the user
  //      no single moment to review before committing.
  //   3. The existing item-detail page (tracking/items/[itemId]/page.tsx)
  //      already establishes this app's convention for a multi-field editable
  //      form: hydrate once, edit locally, one explicit "Save Changes" button
  //      with a saving/saved indicator and inline error — this mirrors that.
  const handleSaveAll = async () => {
    if (dirty.size === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const balances: { trackingItemId: string; balance: number | null }[] = []
      for (const itemId of dirty) {
        const raw = (values[itemId] ?? '').trim()
        if (raw === '') {
          balances.push({ trackingItemId: itemId, balance: null })
          continue
        }
        const num = Number(raw)
        if (!Number.isFinite(num)) {
          setSaveError('One of the balance values is not a valid number.')
          setSaving(false)
          return
        }
        balances.push({ trackingItemId: itemId, balance: num })
      }
      await updateTrackingService.upsertBalances(listId, balances)
      setDirty(new Set())
      await queryClient.invalidateQueries({ queryKey: ['update-list-detail', listId] })
      toast.success('Balances saved')
    } catch (err) {
      const message = extractApiError(err)
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb — this page has no sidebar entry of its own */}
      <Link
        href="/tracking/updates"
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-400 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Updates list
      </Link>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading update list…
        </div>
      ) : isError || !detail ? (
        <div className="flex items-center justify-center py-16 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Failed to load this update list.
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-bold text-ink-primary">Update List</h1>
            <p className="text-xs text-ink-muted mt-0.5">
              Record the latest balance for each tracking item and review the change since the prior update.
            </p>
          </div>

          <ListHeader
            listId={listId}
            transactionDate={detail.list.transactionDate}
            quarter={detail.list.quarter}
            year={detail.list.year}
          />

          {detail.previousListId && (
            <Link
              href={`/tracking/updates/${detail.previousListId}`}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-400 transition-colors"
            >
              <History className="w-3.5 h-3.5" /> View previous update list
            </Link>
          )}

          {totalItemCount === 0 ? (
            <div className="py-12 text-center text-ink-muted text-sm card">
              This tracking set has no tracking items yet — add items from the Category page before recording updates.
            </div>
          ) : (
            <div className="space-y-3">
              {detail.categories.map(cat => (
                <div key={cat.id} className="card p-4">
                  <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-400" /> {cat.name}
                  </h2>
                  <div className="mt-2 space-y-3">
                    {cat.subCategories.map(sub => (
                      <div key={sub.id} className="ml-4 pl-3 border-l border-border/40">
                        <h3 className="text-sm font-medium text-ink-secondary flex items-center gap-1.5 py-1.5">
                          <ListTree className="w-3.5 h-3.5 text-ink-muted" /> {sub.name}
                        </h3>
                        {sub.items.length === 0 ? (
                          <p className="text-xs text-ink-disabled pl-4 py-1">No items yet.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border/50 text-ink-muted">
                                  <th
                                    className="px-3 py-2 text-left font-medium"
                                    style={{ width: itemColumnWidth, minWidth: itemColumnWidth, maxWidth: itemColumnWidth }}
                                  >
                                    Item
                                  </th>
                                  <th className="px-3 py-2 text-right font-medium">Latest Balance</th>
                                  <th className="px-3 py-2 text-right font-medium">Delta</th>
                                  <th className="px-3 py-2 text-right font-medium">Previous Balance</th>
                                  <th className="px-3 py-2 text-left font-medium">Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sub.items.map(item => (
                                  <ItemRow
                                    key={item.id}
                                    item={item}
                                    // Fall back to the server-provided balance when the hydrate
                                    // effect below hasn't committed yet (e.g. the very first paint
                                    // after `detail` resolves) so the input never flashes empty
                                    // before showing the correct value.
                                    value={values[item.id] ?? toBalanceInputString(item.balance)}
                                    onChange={v => handleChange(item.id, v)}
                                    isDirty={dirty.has(item.id)}
                                    itemColumnWidth={itemColumnWidth}
                                  />
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {saveError && (
            <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">{saveError}</p>
          )}

          {totalItemCount > 0 && (
            <div className="flex items-center justify-end gap-3 sticky bottom-0 py-2">
              {dirty.size === 0 && hydrated && !saving && (
                <span className="text-xs text-ink-muted flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-gain" /> All changes saved
                </span>
              )}
              <button
                onClick={handleSaveAll}
                disabled={saving || dirty.size === 0}
                className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save All{dirty.size > 0 ? ` (${dirty.size})` : ''}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
