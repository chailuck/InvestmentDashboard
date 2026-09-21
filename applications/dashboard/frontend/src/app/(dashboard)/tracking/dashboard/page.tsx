'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  Table2, Loader2, AlertCircle, ChevronDown, ChevronRight, Layers, ListTree,
  Maximize2, Minimize2, ArrowUpDown, BarChart3, Target, Pencil, Mail,
} from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { extractApiError } from '@/services/api'
import {
  trackingService,
  type BalanceCell,
  type DashboardBalanceGridOut,
  type DashboardCategoryRow,
  type DashboardItemRow,
  type DashboardYearColumn,
  type Entry,
  type OriginalInvestmentCoverage,
  type OriginalInvestmentItemRow,
  type OriginalInvestmentRollup,
} from '@/services/tracking'
import { buildDashboardEmailHtml, utf8ToBase64 } from '@/lib/tracking-export-html'
import { sendExportEmail } from '@/services/emailExport'

// ── Formatting helpers ───────────────────────────────────────────────────────
// Mirrors the exact conventions established in
// tracking/updates/[listId]/page.tsx (fmtAmount / fmtPercent /
// toFiniteOrNull) so the Delta column reads identically across both pages,
// composed with the shared `formatNumber` thousand-comma formatter from
// lib/utils so every amount on this page reads "1,234,567.89" rather than
// "1234567.89". Duplicated locally (not imported) because that file's
// helpers are intentionally NOT exported — Next.js App Router statically
// rejects any named export from a page.tsx module other than the specific
// ones it recognizes (default, metadata, generateStaticParams, ...).

/** Formats a signed numeric value with thousand-commas and 2 decimals, e.g. "+1,234,567.89" / "-50.00". */
const fmtAmount = (n: number) => (n >= 0 ? '+' : '-') + formatNumber(Math.abs(n))

/** Formats an unsigned-look balance value (no "+" prefix on positives, matching the original convention) with thousand-commas, e.g. "1,234,567.89" / "-50.00". */
const fmtBalance = (n: number) => (n >= 0 ? '' : '-') + formatNumber(Math.abs(n))

/** Formats a signed percentage with 2 decimals, e.g. "+20.00%" / "-4.50%". */
const fmtPercent = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

/**
 * Formats a value in millions with 2 decimals, e.g. "12.34M" — the exact
 * convention already established by `fmtPnl` in
 * action-plan/purchase/[id]/page.tsx and `PortfolioSummaryWidget.tsx`. Used
 * ONLY for the Category Stacked Bar chart's always-visible (non-hover)
 * aggregate-line labels (requirement 3) — every other Balance/Delta value on
 * this page, including that same chart's own hover tooltip, stays on the
 * thousand-comma `fmtBalance` convention; mixing the two formats within one
 * tooltip would read as a bug.
 */
const fmtMillions = (n: number) => `${(n / 1_000_000).toFixed(2)}M`

/**
 * Defensively coerces a value that may arrive as a JSON number OR a numeric
 * string (Decimal serialization on the backend) into a finite number, or
 * `null` when the value is null/undefined/unparseable.
 */
function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A defensive fallback cell used only if a row's `cells` array is ever shorter than expected. */
const EMPTY_CELL: BalanceCell = {
  year: 0, quarter: 0, balance: null, deltaAmount: null, deltaPercent: null,
  hasData: false, hasPreviousData: false,
}

function cellAt(cells: BalanceCell[], idx: number): BalanceCell {
  return cells[idx] ?? EMPTY_CELL
}

// ── Non-Property Total target (requirement 2 / Change 2) ────────────────────
// Follows the exact localStorage convention established by
// portfolio/page.tsx's loadCriteria/saveCriteria: plain getItem/setItem (no
// wrapper library), an SSR guard (`typeof window === 'undefined'`), and a
// try/catch around any parsing so a corrupted/blocked storage value degrades
// to the default rather than crashing the page. One target value per
// tracking set (keyed by `setId`), not per-year — this is a single
// "where do I stand right now" indicator, same as Grand Total/Property/
// Non-Property totals themselves already work (one underlying array, sliced
// per YearTable).
const NON_PROPERTY_TARGET_KEY_PREFIX = 'tracking-dashboard-target-'
const DEFAULT_NON_PROPERTY_TARGET = 20_000_000

function loadNonPropertyTarget(setId: string): number {
  if (typeof window === 'undefined') return DEFAULT_NON_PROPERTY_TARGET
  try {
    const raw = localStorage.getItem(`${NON_PROPERTY_TARGET_KEY_PREFIX}${setId}`)
    if (raw === null) return DEFAULT_NON_PROPERTY_TARGET
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_NON_PROPERTY_TARGET
  } catch {
    return DEFAULT_NON_PROPERTY_TARGET
  }
}

function saveNonPropertyTarget(setId: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${NON_PROPERTY_TARGET_KEY_PREFIX}${setId}`, String(value))
  } catch {
    // Ignore storage errors (quota exceeded, private-mode restrictions, etc.)
    // — matches this codebase's established silent-fail convention.
  }
}

// ── Collapse/expand state ────────────────────────────────────────────────────
//
// This page needs a per-node keyed boolean toggle (collapse/expand by id or
// by year), a different shape from `useExpandableList` (which implements
// "show latest N of a flat list, expand for the rest", used by the Action
// Plan page's tables). Rather than force-fit that hook, this is a small
// generic `Set`-keyed toggle helper, local to this page: it tracks which ids
// are COLLAPSED (default: none, i.e. everything expanded — matching the
// reference spreadsheet's default fully-expanded view).
function useToggleSet<T>() {
  const [set, setSet] = useState<Set<T>>(new Set())
  const has = (key: T) => set.has(key)
  const toggle = (key: T) => setSet(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const setAll = (keys: T[]) => setSet(new Set(keys))
  const clear = () => setSet(new Set())
  return { has, toggle, setAll, clear, set }
}

type ToggleSet<T> = ReturnType<typeof useToggleSet<T>>

// ── Grid cells ───────────────────────────────────────────────────────────────

function BalanceTd({
  cell, strong, grand, groupBorder, colWidth,
}: { cell: BalanceCell; strong?: boolean; grand?: boolean; groupBorder?: boolean; colWidth: string }) {
  const balance = toFiniteOrNull(cell.balance)
  return (
    <td
      className={cn(
        'px-2 py-1.5 text-right font-mono whitespace-nowrap',
        grand ? 'text-sm' : 'text-xs',
        groupBorder && 'border-l-2 border-border',
      )}
      style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }}
    >
      {!cell.hasData || balance === null ? (
        <span className="text-ink-disabled text-[11px]">—</span>
      ) : (
        <span className={cn(
          grand ? 'font-bold text-brand-400' : strong ? 'font-semibold text-ink-primary' : 'text-ink-secondary',
        )}>
          {fmtBalance(balance)}
        </span>
      )}
    </td>
  )
}

// Delta amount + percent render on one line, side by side — the user
// explicitly wants both in a single row, and it's fine for the Delta column
// to end up wider than the Balance column as a result: `colWidth` is
// computed independently per column now (see `useSharedColWidths`), so a
// wider Delta column no longer forces every Balance cell to match it.
function DeltaTd({ cell, colWidth }: { cell: BalanceCell; colWidth: string }) {
  const style = { width: colWidth, minWidth: colWidth, maxWidth: colWidth }
  if (!cell.hasPreviousData) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap" style={style}>
        <span className="text-ink-disabled text-[11px]" title="No prior data">—</span>
      </td>
    )
  }
  const amount = toFiniteOrNull(cell.deltaAmount)
  if (amount === null) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap" style={style}>
        <span className="text-ink-disabled text-[11px]">—</span>
      </td>
    )
  }
  const percent = toFiniteOrNull(cell.deltaPercent)
  const colorClass = amount >= 0 ? 'text-gain' : 'text-loss'
  return (
    <td className="px-2 py-1.5 text-right whitespace-nowrap" style={style}>
      <span className="inline-flex items-baseline gap-1">
        <span className={cn('font-mono text-xs font-medium', colorClass)}>{fmtAmount(amount)}</span>
        {percent !== null && (
          <span className="text-[10px] text-ink-muted font-normal">({fmtPercent(percent)})</span>
        )}
      </span>
    </td>
  )
}

/** The two independently-sized `ch`-based column widths — see `useSharedColWidths` below. */
interface ColWidths {
  balance: string
  delta: string
}

/**
 * Renders one Balance+Delta `<td>` pair per entry in `colIndices`, in order.
 * Every entry after the first gets a left grid-border, which separates each
 * quarter's Balance+Delta pair from its neighbor (Q1|Q2|Q3|Q4 within a single
 * year table) — used identically by the Grand Total/Property/Non-Property
 * rows and every Category/SubCategory/Item row within that same table.
 *
 * `colWidths` are shared `ch`-based widths (see `useSharedColWidths` below)
 * applied uniformly to every Balance/Delta `<td>` on the page so that Q1-Q4
 * columns line up pixel-for-pixel across every independently-rendered
 * `YearTable` — the same technique `updates/[listId]/page.tsx` uses for its
 * own shared `itemColumnWidth`. Balance and Delta are sized SEPARATELY (not
 * one shared width for both) since Delta's stacked amount+percent is
 * typically narrower than Balance's full formatted number — forcing them to
 * match would waste horizontal space on every Balance cell and was the main
 * cause of needing a horizontal scrollbar to see all 4 quarters at once.
 */
function GridCells({
  cells, colIndices, strong, grand, colWidths,
}: {
  cells: BalanceCell[]
  colIndices: number[]
  strong?: boolean
  grand?: boolean
  colWidths: ColWidths
}) {
  return (
    <>
      {colIndices.map((idx, i) => (
        <Fragment key={idx}>
          <BalanceTd cell={cellAt(cells, idx)} strong={strong} grand={grand} groupBorder={i > 0} colWidth={colWidths.balance} />
          <DeltaTd cell={cellAt(cells, idx)} colWidth={colWidths.delta} />
        </Fragment>
      ))}
    </>
  )
}

// ── Shared column-width computation (requirement 1) ─────────────────────────
//
// Mirrors the exact technique `updates/[listId]/page.tsx` uses for its own
// `itemColumnWidth`: measure the longest REALISTIC rendered string across the
// entire dataset once, at the page level, and apply that `ch`-based value
// uniformly everywhere, rather than letting each independently-rendered
// `<table>` size its own columns (which would make Q1-Q4 drift out of
// alignment from one YearTable to the next).
//
// Balance and Delta are measured SEPARATELY (not one shared width for both,
// as this originally worked): the user wants amount+percent on one line in
// the Delta column, and is fine with that column ending up WIDER than
// Balance as a result — computing each independently just means neither one
// gets stretched to match the other unnecessarily, in either direction.
function considerBalanceWidth(cell: BalanceCell, note: (s: string) => void): void {
  const balance = toFiniteOrNull(cell.balance)
  if (cell.hasData && balance !== null) note(fmtBalance(balance))
}

function considerDeltaWidth(cell: BalanceCell, note: (s: string) => void): void {
  // "No prior data" and a bare "—" both render as a single short glyph now
  // (see DeltaTd) — not measured, since the visible text is just "—".
  if (!cell.hasPreviousData) return
  const amount = toFiniteOrNull(cell.deltaAmount)
  if (amount === null) return
  const percent = toFiniteOrNull(cell.deltaPercent)
  // One line: "+1,234,567.89 (+23.45%)" — measure the combined string, since
  // that's what's actually rendered (amount and percent side by side, not stacked).
  note(percent !== null ? `${fmtAmount(amount)} (${fmtPercent(percent)})` : fmtAmount(amount))
}

/**
 * Computes two independent shared `ch`-based widths — one for every Balance
 * column, one for every Delta column — covering every value across the
 * ENTIRE grid (every category/subcategory/item/grandTotal/property-breakdown
 * cell), so every year table's quarter columns still align with each other,
 * just no longer forced to match Balance's width against Delta's.
 */
function useSharedColWidths(grid: DashboardBalanceGridOut | undefined): ColWidths {
  return useMemo(() => {
    let maxBalanceLen = 0
    let maxDeltaLen = 0
    const noteBalance = (s: string) => { if (s.length > maxBalanceLen) maxBalanceLen = s.length }
    const noteDelta = (s: string) => { if (s.length > maxDeltaLen) maxDeltaLen = s.length }

    if (grid) {
      const noteCells = (cells: BalanceCell[]) => cells.forEach(c => {
        considerBalanceWidth(c, noteBalance)
        considerDeltaWidth(c, noteDelta)
      })
      noteCells(grid.grandTotal)
      noteCells(grid.propertyBreakdown.propertyTotal)
      noteCells(grid.propertyBreakdown.nonPropertyTotal)
      grid.categories.forEach(cat => {
        noteCells(cat.subtotal)
        cat.subCategories.forEach(sub => {
          noteCells(sub.subtotal)
          sub.items.forEach(item => noteCells(item.cells))
        })
      })
    }

    // A couple of characters of padding, same rationale as `itemColumnWidth`
    // in updates/[listId]/page.tsx, plus a sane minimum so columns aren't
    // collapsed while the grid is still loading/empty.
    return {
      balance: `${Math.max(maxBalanceLen + 2, 8)}ch`,
      delta: `${Math.max(maxDeltaLen + 2, 7)}ch`,
    }
  }, [grid])
}

// ── Grand Total rows (per-year, always visible) ─────────────────────────────
//
// Requirement 3: Grand Total (+ Property/Non-Property breakdown) is no longer
// a single page-top summary table — it's now the first row(s) of EVERY
// per-year `YearTable`, sliced to that table's own year via the exact same
// `colIndices` the rest of that table uses (so no separate slicing scheme to
// keep in sync). These rows are rendered unconditionally by `YearTable`
// itself — i.e. NOT inside the `categories.map(...)` below — so they are
// never gated by `collapsedCategories`/`collapsedSubCategories`, preserving
// the "always visible" guarantee the old page-top version had, just now
// duplicated per-year. Visual hierarchy carried over verbatim: Grand Total
// stays bold/brand-colored/`bg-brand-500/10`; Property/Non-Property stay
// subdued secondary rows.
/**
 * Inline "current / target" progress indicator for the Non-Property Total
 * row (Change 2). Deliberately compact — one line, no settings panel — per
 * the requirement to keep this a lightweight row-level widget rather than a
 * dedicated goal-tracking feature.
 *
 * Color semantics: reaching/exceeding the target switches the amount + bar
 * to this app's EXISTING `text-gain`/`bg-gain` convention (the same one
 * `DeltaTd` above uses for a positive delta) rather than inventing a new
 * "success" color. Below target intentionally stays neutral (`text-ink-*` /
 * `bg-info`) rather than `text-loss` — falling short of a savings goal isn't
 * a loss in this app's existing color semantics (loss = a balance that went
 * DOWN), so borrowing that color here would misstate what's being shown.
 */
function NonPropertyTargetProgress({
  current, target, onTargetChange,
}: {
  /** Most recent quarter-with-data balance across the whole dataset, or `null` if none exists yet (nothing is fabricated in that case — no progress UI is shown). */
  current: number | null
  target: number
  onTargetChange: (value: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(target))

  // Keep the draft in sync whenever the committed target changes from
  // outside this render (e.g. switching Tracking Set reloads a different
  // stored value).
  useEffect(() => { setDraft(String(target)) }, [target])

  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n > 0) {
      onTargetChange(n)
    } else {
      // Invalid input (non-numeric, zero, negative) is rejected — revert the
      // draft back to the last valid committed value instead of saving it.
      setDraft(String(target))
    }
    setEditing(false)
  }

  const cancel = () => {
    setDraft(String(target))
    setEditing(false)
  }

  const atOrAboveTarget = current !== null && current >= target
  const pct = target > 0 ? Math.min(100, Math.max(0, ((current ?? 0) / target) * 100)) : 0

  return (
    <div className="flex items-center gap-3 flex-wrap text-[11px] py-0.5">
      <span className="text-ink-muted flex items-center gap-1 shrink-0">
        <Target className="w-3 h-3" aria-hidden="true" /> Target:
        {editing ? (
          <input
            type="number"
            min="0"
            step="1"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') cancel()
            }}
            autoFocus
            aria-label="Non-Property Total target amount"
            className="input text-[11px] px-1.5 py-0.5 w-28"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-ink-secondary hover:text-brand-400 transition-colors font-medium"
            aria-label={`Edit Non-Property Total target, currently ${fmtBalance(target)}`}
          >
            {fmtBalance(target)} <Pencil className="w-2.5 h-2.5" aria-hidden="true" />
          </button>
        )}
      </span>

      {current !== null && (
        <>
          <span className={cn('font-medium whitespace-nowrap', atOrAboveTarget ? 'text-gain' : 'text-ink-secondary')}>
            {fmtBalance(current)} / {fmtBalance(target)}
          </span>
          <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress toward Non-Property Total target"
            className="w-32 h-1.5 rounded-full bg-surface-elevated overflow-hidden shrink-0"
          >
            <div
              className={cn('h-full rounded-full transition-all', atOrAboveTarget ? 'bg-gain' : 'bg-info')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </div>
  )
}

function GrandTotalRows({
  grandTotal, propertyTotal, nonPropertyTotal, colIndices, colWidths,
  target, currentNonProperty, onTargetChange,
}: {
  grandTotal: BalanceCell[]
  propertyTotal: BalanceCell[]
  nonPropertyTotal: BalanceCell[]
  colIndices: number[]
  colWidths: ColWidths
  target: number
  currentNonProperty: number | null
  onTargetChange: (value: number) => void
}) {
  // Spans every column (name + one Balance/Delta pair per quarter in THIS
  // table) so the progress row reads as a single full-width line under
  // Non-Property Total, rather than fighting the Q1-Q4 grid columns.
  const colSpan = 1 + colIndices.length * 2
  return (
    <>
      <tr className="bg-brand-500/10 border-t-2 border-brand-500/30">
        <td className="px-3 py-2.5 font-bold text-brand-400 text-sm border-r-2 border-border">
          Grand Total
        </td>
        <GridCells cells={grandTotal} colIndices={colIndices} grand colWidths={colWidths} />
      </tr>
      <tr className="border-b border-border/40">
        <td className="px-3 py-1.5 pl-6 text-ink-muted text-[11px] border-r-2 border-border">Property Total</td>
        <GridCells cells={propertyTotal} colIndices={colIndices} colWidths={colWidths} />
      </tr>
      {/* Non-Property Total: distinct `bg-info/10` + `border-info` treatment
          (Change 2) — an accent not used anywhere else on this page (Grand
          Total already owns `bg-brand-500/10`; Property Total/Item rows stay
          neutral; purple is reserved for the "Excl." badge) so this row is
          unambiguously a different tier, not just a slightly different
          Property Total. */}
      <tr className="bg-info/10 border-y-2 border-info/30">
        <td className="px-3 py-1.5 pl-6 border-l-4 border-l-info text-ink-secondary text-[11px] font-medium border-r-2 border-border">
          Non-Property Total
        </td>
        <GridCells cells={nonPropertyTotal} colIndices={colIndices} strong colWidths={colWidths} />
      </tr>
      <tr className="bg-info/5 border-b border-border/40">
        <td colSpan={colSpan} className="px-3 pl-6">
          <NonPropertyTargetProgress current={currentNonProperty} target={target} onTargetChange={onTargetChange} />
        </td>
      </tr>
    </>
  )
}

// ── Per-year table ───────────────────────────────────────────────────────────
//
// One independently collapsible `<table>` per year. `collapsedCategories`
// and `collapsedSubCategories` are passed in from the page as SHARED state
// (single Set each) — every year table reads/writes the same Set, which is
// what makes the global Summary/Detail toggle affect every year at once.

function YearTable({
  yearCol, yearIdx, categories, collapsed, onToggleCollapsed, collapsedCategories, collapsedSubCategories,
  grandTotal, propertyTotal, nonPropertyTotal, colWidths, target, currentNonProperty, onTargetChange,
}: {
  yearCol: DashboardYearColumn
  yearIdx: number
  categories: DashboardCategoryRow[]
  collapsed: boolean
  onToggleCollapsed: () => void
  collapsedCategories: ToggleSet<string>
  collapsedSubCategories: ToggleSet<string>
  /** Full (all-years) arrays — sliced to this table's own year via `colIndices` below, same as every other row. */
  grandTotal: BalanceCell[]
  propertyTotal: BalanceCell[]
  nonPropertyTotal: BalanceCell[]
  colWidths: ColWidths
  /** Same underlying target/progress state across every year table — see `GrandTotalRows`. */
  target: number
  currentNonProperty: number | null
  onTargetChange: (value: number) => void
}) {
  // This year's own flattened cell-array indices, e.g. year index 1 (second
  // year in `years[]`) -> [4, 5, 6, 7]. Always all 4 quarters — column-level
  // collapsing no longer exists; `collapsed` now gates the whole table.
  const colIndices = useMemo(
    () => yearCol.quarters.map((_, i) => yearIdx * 4 + i),
    [yearCol.quarters, yearIdx],
  )

  if (collapsed) {
    return (
      <div className="card overflow-hidden">
        <button
          onClick={onToggleCollapsed}
          aria-expanded={false}
          aria-label={`Expand ${yearCol.year} table`}
          className="w-full flex items-center gap-2 px-4 py-3 text-left font-semibold text-ink-secondary hover:text-brand-400 transition-colors"
        >
          <ChevronRight className="w-4 h-4 shrink-0" />
          <Table2 className="w-4 h-4 text-brand-400 shrink-0" />
          <span>{yearCol.year}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggleCollapsed}
        aria-expanded={true}
        aria-label={`Collapse ${yearCol.year} table`}
        className="w-full flex items-center gap-2 px-4 py-3 text-left font-semibold text-ink-primary hover:text-brand-400 transition-colors border-b-2 border-border bg-surface-elevated/30"
      >
        <ChevronDown className="w-4 h-4 shrink-0" />
        <Table2 className="w-4 h-4 text-brand-400 shrink-0" />
        <span>{yearCol.year}</span>
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-border bg-surface-elevated/20 text-ink-muted">
              <th scope="col" className="px-3 py-2 text-left font-medium min-w-[220px] border-r-2 border-border">
                Item
              </th>
              {yearCol.quarters.flatMap((q, i) => [
                <th
                  key={`q${q}-bal`}
                  scope="col"
                  className={cn('px-2 py-1 text-right font-medium text-[10px]', i > 0 && 'border-l-2 border-border')}
                  style={{ width: colWidths.balance, minWidth: colWidths.balance, maxWidth: colWidths.balance }}
                >
                  Q{q}
                </th>,
                <th
                  key={`q${q}-delta`}
                  scope="col"
                  className="px-2 py-1 text-right font-medium text-[10px]"
                  style={{ width: colWidths.delta, minWidth: colWidths.delta, maxWidth: colWidths.delta }}
                >
                  Q{q} Δ
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            <GrandTotalRows
              grandTotal={grandTotal}
              propertyTotal={propertyTotal}
              nonPropertyTotal={nonPropertyTotal}
              colIndices={colIndices}
              colWidths={colWidths}
              target={target}
              currentNonProperty={currentNonProperty}
              onTargetChange={onTargetChange}
            />
            {categories.map(cat => {
              const catCollapsed = collapsedCategories.has(cat.id)
              return (
                <Fragment key={cat.id}>
                  {/* Category row doubles as its subtotal row — always visible,
                      even when collapsed, so the rollup stays useful. Strongest
                      tier: highest background opacity + brand-colored left accent. */}
                  <tr className="bg-surface-elevated/70 border-y-2 border-border">
                    <td className="px-3 py-2 border-l-4 border-l-brand-500 border-r-2 border-border">
                      <button
                        onClick={() => collapsedCategories.toggle(cat.id)}
                        aria-expanded={!catCollapsed}
                        aria-label={`${catCollapsed ? 'Expand' : 'Collapse'} ${cat.name}`}
                        className="flex items-center gap-1.5 font-semibold text-ink-primary text-sm hover:text-brand-400 transition-colors"
                      >
                        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform shrink-0', catCollapsed && '-rotate-90')} />
                        <Layers className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                        <span>{cat.name}</span>
                      </button>
                    </td>
                    <GridCells cells={cat.subtotal} colIndices={colIndices} strong colWidths={colWidths} />
                  </tr>

                  {!catCollapsed && cat.subCategories.map(sub => {
                    const subCollapsed = collapsedSubCategories.has(sub.id)
                    return (
                      <Fragment key={sub.id}>
                        {/* SubCategory row doubles as its subtotal row — same idea one
                            level down. Middle tier: lower background opacity + neutral
                            (non-brand) left accent, clearly between Category and Item. */}
                        <tr className="bg-surface-elevated/30 border-b border-border/60">
                          <td className="px-3 py-1.5 pl-8 border-l-4 border-l-border border-r-2 border-border">
                            <button
                              onClick={() => collapsedSubCategories.toggle(sub.id)}
                              aria-expanded={!subCollapsed}
                              aria-label={`${subCollapsed ? 'Expand' : 'Collapse'} ${sub.name}`}
                              className="flex items-center gap-1.5 font-medium text-ink-secondary text-xs hover:text-brand-400 transition-colors"
                            >
                              <ChevronDown className={cn('w-3 h-3 transition-transform shrink-0', subCollapsed && '-rotate-90')} />
                              <ListTree className="w-3 h-3 text-ink-muted shrink-0" />
                              <span>{sub.name}</span>
                            </button>
                          </td>
                          <GridCells cells={sub.subtotal} colIndices={colIndices} strong colWidths={colWidths} />
                        </tr>

                        {/* Item rows — no background tint at all (lowest tier) and no
                            left accent, so the three tiers read as a clear step: strong
                            tinted+accented -> lightly tinted+accented -> plain. */}
                        {!subCollapsed && sub.items.map(item => (
                          <tr key={item.id} className="border-b border-border/40 hover:bg-surface-elevated/50 transition-colors">
                            <td
                              className="px-3 py-1.5 pl-14 text-ink-primary overflow-hidden text-ellipsis whitespace-nowrap max-w-[240px] border-l-4 border-l-transparent border-r-2 border-border"
                              title={item.name}
                            >
                              {item.name}
                              {item.exclusive && (
                                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                  Excl.
                                </span>
                              )}
                            </td>
                            <GridCells cells={item.cells} colIndices={colIndices} colWidths={colWidths} />
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Category charts (requirement 4; redefined — see CategoryDeltaChart) ────
//
// Hand-rolled inline SVG charts — the SAME mechanism as the only other chart
// in this codebase (analytics/daily-performance/page.tsx): a `useMemo`-built
// `ChartData`-equivalent, `xOf`/`yOf` scale functions, a manual path/rect
// builder, y-axis gridlines+ticks, x-axis labels thinned via `labelStep`, a
// legend row, and a hover-tracking tooltip via `onMouseMove`. No chart
// library is introduced (none exists in this codebase's package.json).
//
// Both charts render exactly ONCE per page load across the FULL chronological
// range of quarters, unaffected by the Detail/Sub-category/Summary/
// year-collapse toggles.

const TREND_CHART_H = 260
const TREND_CHART_PAD = { top: 20, right: 20, bottom: 36, left: 68 } as const

// Categorical line colors — the `dataviz` skill's validated default
// categorical palette (dark-mode column, since this app has no light theme:
// see globals.css/tailwind.config.ts, which define a single fixed dark
// surface with no light variant). Used in this FIXED order, never cycled,
// straight from the documented palette (skill requirement: "documented
// palette only" — no eyeballed hex values). Modulo-wraps past 8 categories
// as a pragmatic fallback for an unbounded category list; the skill's own
// guidance for a true 9th+ series is to fold into "Other" or facet, which
// isn't practical for a fixed per-category trend line, so this is a
// documented deviation for the (expected to be rare) >8-category case.
const CATEGORY_LINE_COLORS = [
  '#3987e5', // slot 1 — blue
  '#d95926', // slot 2 — orange
  '#199e70', // slot 3 — aqua
  '#c98500', // slot 4 — yellow
  '#d55181', // slot 5 — magenta
  '#008300', // slot 6 — green
  '#9085e9', // slot 7 — violet
  '#e66767', // slot 8 — red
] as const

// Grand Total is deliberately NOT a categorical slot — it's an aggregate,
// not a "9th series" competing with categories for the identity channel. It
// uses this app's `--ink-primary` (near-white) so it reads as the odd-one-out
// against every hued category line, PLUS a dashed, thicker stroke and a bold
// legend label — three independent, non-color signals per the skill's "color
// follows the entity, identity never carries by color alone" guidance.
const GRAND_TOTAL_LINE_COLOR = '#E2E8F0'

// Non-Property Total's RIGHT-chart overlay line (requirement 3) needs its
// own non-categorical treatment, distinct from BOTH the category palette
// AND Grand Total's own aggregate styling — three independent signals
// (color, dash pattern, and which line it is) rather than relying on color
// alone. Reuses this app's `--info` cyan (`#06B6D4`) — the SAME accent
// `GrandTotalRows` already uses for the Non-Property Total row's
// `bg-info`/`border-info` highlight (see requirement 1 above) — so the line
// visually ties back to "the row this line represents" rather than
// introducing a brand-new, unrelated hue. It is NOT a `CATEGORY_LINE_COLORS`
// slot (that array is blue/orange/teal/yellow/magenta/green/violet/red;
// cyan is never one of them) and is dashed with a visibly tighter pattern
// (`2,4` vs Grand Total's `6,3`) so the two aggregate lines never read as
// the same dash style at a glance.
const NON_PROPERTY_TOTAL_LINE_COLOR = '#06B6D4'

// Sign colors for `CategoryDeltaChart`'s tooltip amount text and its
// Increase/Decrease legend hint (see the chart's own docstring below) — the
// EXACT hex values this app's `--gain`/`--loss` CSS custom properties
// resolve to (globals.css), reused verbatim rather than inventing new colors
// for the "positive vs negative delta" distinction. Hardcoded hex (not a
// Tailwind class / `var(--gain)`) for the same reason every other color
// constant on this page is: these values feed raw SVG `fill` attributes, not
// `className`.
const DELTA_POSITIVE_COLOR = '#22C55E' // matches --gain
const DELTA_NEGATIVE_COLOR = '#EF4444' // matches --loss

// ── Item expand-charts colors (Feature 2) ────────────────────────────────────
// Chart A's bottom "original investment" bar segment: a neutral gray reusing
// this app's `--ink-muted` hex verbatim — the same "reuse the CSS custom
// property's value, never invent a new hex" rule every other color constant
// on this page follows. Original investment (cost basis) has no inherent
// sign, so it deliberately does NOT borrow the gain/loss palette the way the
// segment above it does.
const ORIGINAL_INVESTMENT_COLOR = '#64748B' // matches --ink-muted

// Chart B's single profit-trend line reuses `GRAND_TOTAL_LINE_COLOR` (this
// app's neutral `--ink-primary`-ish tone, see its own comment above) rather
// than inventing a new hex — inside one item's own expand-chart pair there is
// no competing category/aggregate palette to disambiguate from, so the same
// "neutral, not a category" signal already established for Grand Total reads
// correctly here too. Sign (gain vs loss) is carried by the zero baseline and
// the hover tooltip's text color — the exact `DELTA_POSITIVE_COLOR`/
// `DELTA_NEGATIVE_COLOR` convention `CategoryDeltaChart` already uses — never
// by the line's own hue (profit can go negative, so a single fixed color
// would misstate a loss quarter as a gain).
const ITEM_PROFIT_LINE_COLOR = GRAND_TOTAL_LINE_COLOR

// ── Stacked bar overlay (Change 1) ──────────────────────────────────────────
// Per the `dataviz` skill (consulted before writing this): bars and lines
// here share ONE y-axis/scale (both plot the same measure — balance amount
// — never a second dual-axis scale for a different unit), a stacked bar is
// the correct form for "part-to-whole per quarter" ("Part-to-whole -> stacked
// bar, color job: categorical"), and a bar segment must reuse the SAME
// categorical hue as that category's line (`CATEGORY_LINE_COLORS`) rather
// than a second palette — "color follows the entity," not the mark type.
//
// To keep the bar (background layer) from visually competing with the line
// (foreground layer) for the same category/color, the two marks are
// differentiated by OPACITY, not hue: the bar segment renders at
// `BAR_FILL_OPACITY` (a visible-but-muted wash) while the line stroke stays
// full-opacity/full-weight exactly as before. This is the skill's "area
// fill ~10% opacity" wash convention adapted upward — a trend-line's area
// fill is pure decoration under a single line, but here the bar IS the
// primary encoding of the stacked total, so it needs enough opacity to read
// as data on its own, while still sitting visibly "behind" the crisper line.
// Segments within one stack get a small gap (BAR_SEGMENT_GAP) instead of a
// border between them, per the skill's "2px surface gap, never a border to
// separate marks" rule.
const BAR_FILL_OPACITY = 0.55
const BAR_SEGMENT_GAP = 2 // px, split evenly between the two adjoining segments at each internal stack boundary
const BAR_MAX_WIDTH = 24 // px — the skill's bar/column mark spec ("<= 24px thick")
const BAR_MIN_WIDTH = 4

interface BarSegment {
  categoryId: string
  color: string
  yTop: number
  yBottom: number
  value: number
}

interface BarColumn {
  x: number
  segments: BarSegment[]
}

/** Same abbreviation convention as daily-performance's local `formatAxisNumber` (1.2M / 500K). */
function formatAxisNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toFixed(0)
}

interface TrendPoint {
  x: number
  /** `null` means "no data for this quarter" — the caller must render a GAP, never a fabricated zero. */
  y: number | null
  value: number | null
}

/**
 * Builds an SVG path `d` string that BREAKS the line at every `null` point
 * instead of interpolating across it or treating it as zero — this is what
 * makes a blank quarter (`hasData:false`) render as a visible gap. A single
 * `d` string can safely contain multiple `M...L...` subpaths; each gap simply
 * starts a fresh one.
 */
function buildLinePathWithGaps(points: TrendPoint[]): string {
  let d = ''
  let drawing = false
  for (const p of points) {
    if (p.y === null) {
      drawing = false
      continue
    }
    d += `${drawing ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `
    drawing = true
  }
  return d.trim()
}

interface TrendSeries {
  id: string
  label: string
  color: string
  dashed: boolean
  strokeWidth: number
  points: TrendPoint[]
}

/**
 * One x-axis tick, shared verbatim between `CategoryStackedBarChart` and
 * `CategoryDeltaChart` (Gate 2: ONE `quarters` array computed once at
 * the page level, passed to both, so their x-axis ranges can never drift
 * apart). `cellIdx` is the ORIGINAL (non-reversed) `yearIdx*4 + quarterIdx`
 * position every cells/subtotal/grandTotal/propertyBreakdown array is
 * positionally aligned to.
 */
interface ChartQuarter {
  label: string
  cellIdx: number
}

/** Evenly-spaced y-axis tick values across `[yMin, yMin + yRange]` — pulled to module scope since both chart components need the identical tick-generation math. */
function computeYTicks(yMin: number, yRange: number, tickCount = 5): number[] {
  return Array.from({ length: tickCount }, (_, i) => yMin + (i / (tickCount - 1)) * yRange)
}

/** Thins x-axis labels to at most ~8, always including the last quarter — shared by both chart components (identical to the original combined chart's logic). */
function computeXLabelIdxs(quarterCount: number): number[] {
  const labelStep = Math.max(1, Math.ceil(quarterCount / 8))
  const idxs: number[] = []
  for (let i = 0; i < quarterCount; i++) {
    if (i % labelStep === 0 || i === quarterCount - 1) idxs.push(i)
  }
  return idxs
}

/** Flips the hover tooltip to the LEFT of the cursor once it would otherwise overflow the chart's right edge — shared clamping math for both chart components' tooltips. */
function clampTooltipX(px: number, tooltipW: number, containerWidth: number, margin = 10): number {
  return px + tooltipW + margin > containerWidth - TREND_CHART_PAD.right ? px - tooltipW - margin : px + margin
}

/**
 * LEFT chart (unchanged content, moved from the RIGHT slot — see the
 * redefined `CategoryDeltaChart` below, now in the RIGHT slot) — the stacked
 * bars ONLY, plus two aggregate overlay lines read directly from their own
 * data (Non-Property Total, Grand Total) — never derived from bar segment
 * geometry. Its y-domain fits all THREE of: the stacked category total, the
 * Grand Total line, and the Non-Property Total line — none of the three is
 * guaranteed by the data model to bound the other two.
 */
function CategoryStackedBarChart({
  quarters, categories, grandTotal, nonPropertyTotal,
}: {
  quarters: ChartQuarter[]
  categories: DashboardCategoryRow[]
  grandTotal: BalanceCell[]
  /** Property/Non-Property breakdown's Non-Property Total row — same array `GrandTotalRows` renders per-year (Gate 1 requirement 3). */
  nonPropertyTotal: BalanceCell[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(() => {
    if (quarters.length === 0) return null
    const innerW = containerWidth - TREND_CHART_PAD.left - TREND_CHART_PAD.right
    const innerH = TREND_CHART_H - TREND_CHART_PAD.top - TREND_CHART_PAD.bottom

    const xOf = (i: number): number =>
      TREND_CHART_PAD.left + (quarters.length > 1 ? (i / (quarters.length - 1)) * innerW : innerW / 2)

    // Same defensive sort as the LEFT chart (never rely on API array order)
    // — kept identical so a category's bar color always matches its LEFT
    // chart line color.
    const sortedCategories = [...categories].sort((a, b) => a.orderIndex - b.orderIndex)

    // Per-quarter STACKED bar total — the sum of every category's OWN
    // subtotal for that quarter (categories with `hasData:false` that
    // quarter contribute nothing, matching the "absent, never a fabricated
    // zero" rule applied to the bar segments themselves below). This is each
    // quarter's own total, not a running/cumulative-over-time sum.
    const stackedTotalsByQuarter = quarters.map(q =>
      sortedCategories.reduce((sum, cat) => {
        const cell = cat.subtotal[q.cellIdx]
        if (!cell?.hasData) return sum
        const v = toFiniteOrNull(cell.balance)
        return v === null ? sum : sum + v
      }, 0),
    )

    // The two aggregate overlay lines (requirement 3) — raw per-quarter
    // values read straight from their own data arrays, `null` for any
    // quarter without data (never a fabricated 0), and computed
    // INDEPENDENTLY of the stacking loop above — NOT derived from bar
    // segment geometry. In the normal case (every Property item lives in
    // its own category, never mixed into a non-property category)
    // Non-Property Total will visually land on a stack boundary, but that's
    // incidental, not enforced by this calculation.
    const grandTotalValues = quarters.map(q => {
      const cell = grandTotal[q.cellIdx]
      if (!cell?.hasData) return null
      return toFiniteOrNull(cell.balance)
    })
    const nonPropertyValues = quarters.map(q => {
      const cell = nonPropertyTotal[q.cellIdx]
      if (!cell?.hasData) return null
      return toFiniteOrNull(cell.balance)
    })

    // RIGHT chart's y-domain (Gate 2) — Math.max/min across THREE arrays:
    // the stacked category total, Grand Total's own line, and Non-Property
    // Total's own line. None of the three is guaranteed by the data model to
    // bound the other two (e.g. Grand Total/Non-Property Total are recorded
    // independently of category subtotals), so assuming the stacked total
    // alone would risk silently clipping a line at the chart's top.
    const domainValues = [
      ...stackedTotalsByQuarter,
      ...grandTotalValues.filter((v): v is number => v !== null),
      ...nonPropertyValues.filter((v): v is number => v !== null),
    ]
    const dataMin = Math.min(0, ...(domainValues.length ? domainValues : [0]))
    const dataMax = domainValues.length ? Math.max(...domainValues) : 1
    const range = Math.max(dataMax - dataMin, 1)
    const yMin = dataMin - range * 0.05
    const yMax = dataMax + range * 0.1
    const yRange = Math.max(yMax - yMin, 1)

    const yOf = (v: number): number => TREND_CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    // Bar width — capped at the skill's 24px mark spec, scaled down for
    // narrow quarter spacing (many quarters in view) with a small floor so a
    // bar never disappears entirely.
    const spacing = quarters.length > 1 ? innerW / (quarters.length - 1) : innerW
    const barWidth = Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, spacing * 0.55))

    // Stacked bar segments — built from the SAME sorted category order used
    // for colors/legend above. A category with `hasData:false` for a given
    // quarter contributes no segment at all (not a zero-height rect, not a
    // bordered placeholder) — it simply never enters the running `cum`
    // total, so its neighbors stack flush against each other with the usual
    // inter-segment gap, no visual hole left behind.
    //
    // Edge case (documented, deliberately minimal): if EVERY category is
    // `hasData:false` for a quarter but `grandTotal.hasData` is true for
    // that same quarter (a data inconsistency that should be rare), `raw`
    // ends up empty and no bar renders at all for that quarter — judged the
    // least-misleading option versus fabricating a single guessed segment.
    const barColumns: BarColumn[] = quarters.map((q, i) => {
      let cum = 0
      const raw: BarSegment[] = []
      sortedCategories.forEach((cat, ci) => {
        const cell = cat.subtotal[q.cellIdx]
        if (!cell?.hasData) return
        const value = toFiniteOrNull(cell.balance)
        if (value === null) return
        const yBefore = yOf(cum)
        cum += value
        const yAfter = yOf(cum)
        raw.push({
          categoryId: cat.id,
          color: CATEGORY_LINE_COLORS[ci % CATEGORY_LINE_COLORS.length],
          yTop: Math.min(yBefore, yAfter),
          yBottom: Math.max(yBefore, yAfter),
          value,
        })
      })
      // 2px surface-gap between adjacent stacked segments — per the skill's
      // "gap, never a border" rule — by shrinking each INTERNAL boundary by
      // half on both sides. The outer edges (baseline + stack top) are left
      // untouched so the bar's total height still reads correctly.
      for (let s = 0; s < raw.length - 1; s++) {
        raw[s].yTop += BAR_SEGMENT_GAP / 2
        raw[s + 1].yBottom -= BAR_SEGMENT_GAP / 2
      }
      return { x: xOf(i), segments: raw }
    })

    // The two aggregate overlay lines, built as ordinary `TrendSeries` so
    // they can reuse `buildLinePathWithGaps`/the tooltip machinery exactly
    // like any other line — the id/color/dash choices are what make them
    // read as "not a category" (see `GRAND_TOTAL_LINE_COLOR` and
    // `NON_PROPERTY_TOTAL_LINE_COLOR` comments above).
    const nonPropertySeries: TrendSeries = {
      id: 'non-property-total',
      label: 'Non-Property Total',
      color: NON_PROPERTY_TOTAL_LINE_COLOR,
      dashed: true,
      strokeWidth: 2.5,
      points: nonPropertyValues.map((v, i) => ({ x: xOf(i), y: v === null ? null : yOf(v), value: v })),
    }
    const grandTotalSeries: TrendSeries = {
      id: 'grand-total-overlay',
      label: 'Grand Total',
      color: GRAND_TOTAL_LINE_COLOR,
      dashed: true,
      strokeWidth: 2.5,
      points: grandTotalValues.map((v, i) => ({ x: xOf(i), y: v === null ? null : yOf(v), value: v })),
    }

    // Category values for the hover tooltip only (no line is drawn for
    // these — the bars are the visual encoding) so hovering the RIGHT chart
    // still surfaces every category's own value alongside the two
    // aggregates, same as the pre-split combined chart's tooltip did.
    const categoryTooltipSeries: TrendSeries[] = sortedCategories.map((cat, i) => ({
      id: cat.id,
      label: cat.name,
      color: CATEGORY_LINE_COLORS[i % CATEGORY_LINE_COLORS.length],
      dashed: false,
      strokeWidth: 0,
      points: quarters.map((q, qi) => {
        const cell = cat.subtotal[q.cellIdx]
        const v = cell?.hasData ? toFiniteOrNull(cell.balance) : null
        return { x: xOf(qi), y: null, value: v }
      }),
    }))

    const yTicks = computeYTicks(yMin, yRange)
    const xLabelIdxs = computeXLabelIdxs(quarters.length)

    return {
      innerW, innerH, xOf, yOf, barColumns, barWidth, yTicks, xLabelIdxs,
      sortedCategories, nonPropertySeries, grandTotalSeries, categoryTooltipSeries,
    }
  }, [quarters, categories, grandTotal, nonPropertyTotal, containerWidth])

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || quarters.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - TREND_CHART_PAD.left
    const step = quarters.length > 1 ? chartData.innerW / (quarters.length - 1) : chartData.innerW
    const idx = Math.max(0, Math.min(quarters.length - 1, Math.round(mouseX / step)))
    setHoverIdx(idx)
  }
  const handleMouseLeave = () => setHoverIdx(null)

  if (quarters.length === 0 || !chartData) return null

  // Most-recent (rightmost) plotted value for each overlay line — used for
  // the always-visible millions-format label (requirement 3). A dedicated
  // backward search rather than "read the last point" because a series can
  // have its OWN trailing gap at the very last plotted quarter (distinct
  // from the page-level trailing TRIM in requirement 4, which only removes
  // quarters where EVERY series is blank).
  const lastPlotted = (points: TrendPoint[]): { idx: number; value: number } | null => {
    for (let i = points.length - 1; i >= 0; i--) {
      const v = points[i].value
      if (v !== null) return { idx: i, value: v }
    }
    return null
  }
  const nonPropertyLast = lastPlotted(chartData.nonPropertySeries.points)
  const grandTotalLast = lastPlotted(chartData.grandTotalSeries.points)
  const tooltipRows = [...chartData.categoryTooltipSeries, chartData.nonPropertySeries, chartData.grandTotalSeries]

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-brand-400" /> Category Breakdown
        </h2>
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap" role="list" aria-label="Category stacked bar chart legend">
          {chartData.sortedCategories.map((cat, i) => (
            <span key={cat.id} className="flex items-center gap-1.5" role="listitem">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: CATEGORY_LINE_COLORS[i % CATEGORY_LINE_COLORS.length] }}
                aria-hidden="true"
              />
              <span>{cat.name}</span>
            </span>
          ))}
          {/* The two aggregate overlay lines carry their most-recent value
              inline in the legend (millions format) IN ADDITION to the
              in-chart data-point label below — requirement 3 asks for this
              to be visible without a hover; showing it in both places reads
              cleanly here since the legend already has room. */}
          <span className="flex items-center gap-1.5" role="listitem">
            <span
              className="inline-block w-3 rounded-full"
              style={{ height: '3px', backgroundColor: NON_PROPERTY_TOTAL_LINE_COLOR }}
              aria-hidden="true"
            />
            <span className="font-semibold text-ink-primary">
              Non-Property Total{nonPropertyLast ? ` (${fmtMillions(nonPropertyLast.value)})` : ''}
            </span>
          </span>
          <span className="flex items-center gap-1.5" role="listitem">
            <span
              className="inline-block w-3 rounded-full"
              style={{ height: '3px', backgroundColor: GRAND_TOTAL_LINE_COLOR }}
              aria-hidden="true"
            />
            <span className="font-semibold text-ink-primary">
              Grand Total{grandTotalLast ? ` (${fmtMillions(grandTotalLast.value)})` : ''}
            </span>
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${TREND_CHART_H}px` }}
        role="img"
        aria-label="Category stacked bar chart"
      >
        <svg
          width={containerWidth}
          height={TREND_CHART_H}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: 'crosshair' }}
        >
          {chartData.yTicks.map((tick, i) => {
            const y = chartData.yOf(tick)
            return (
              <g key={i}>
                <line x1={TREND_CHART_PAD.left} y1={y} x2={containerWidth - TREND_CHART_PAD.right} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
                <text x={TREND_CHART_PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {formatAxisNumber(tick)}
                </text>
              </g>
            )
          })}
          {chartData.xLabelIdxs.map(i => (
            <text key={i} x={chartData.xOf(i)} y={TREND_CHART_H - TREND_CHART_PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
              {quarters[i].label}
            </text>
          ))}
          {chartData.barColumns.map((col, qi) => (
            <g key={`bar-${quarters[qi].cellIdx}`} data-testid={`chart-bar-column-${qi}`}>
              {col.segments.map(seg => (
                <rect
                  key={seg.categoryId}
                  data-testid={`chart-bar-segment-${qi}-${seg.categoryId}`}
                  x={col.x - chartData.barWidth / 2}
                  y={seg.yTop}
                  width={chartData.barWidth}
                  height={Math.max(0, seg.yBottom - seg.yTop)}
                  fill={seg.color}
                  fillOpacity={BAR_FILL_OPACITY}
                />
              ))}
            </g>
          ))}
          {/* The two aggregate overlay lines (requirement 3) — rendered on
              top of the bars, on the exact same x/y scales. Dash patterns
              are deliberately different from each other (and from Grand
              Total's `6,3` elsewhere) so they never read as the same line
              style at a glance. */}
          {[chartData.nonPropertySeries, chartData.grandTotalSeries].map(s => (
            <path
              key={s.id}
              data-testid={`chart-line-${s.id}`}
              d={buildLinePathWithGaps(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeDasharray={s.id === 'non-property-total' ? '2,4' : '6,3'}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Always-visible millions-format data-point label at each overlay
              line's most recent (rightmost) plotted point — requirement 3
              wants this readable without a hover, kept separate from the
              (thousand-comma) hover tooltip below. Anchored `end` and offset
              above/below the point so the two labels don't collide with each
              other when both lines sit close together (implementer's call
              on exact placement, per the requirement). */}
          {nonPropertyLast && (
            <text
              data-testid="chart-label-non-property-total"
              x={chartData.xOf(nonPropertyLast.idx) - 4}
              y={chartData.yOf(nonPropertyLast.value) + 14}
              textAnchor="end"
              fontSize={10}
              fontWeight={600}
              fill={NON_PROPERTY_TOTAL_LINE_COLOR}
            >
              {fmtMillions(nonPropertyLast.value)}
            </text>
          )}
          {grandTotalLast && (
            <text
              data-testid="chart-label-grand-total"
              x={chartData.xOf(grandTotalLast.idx) - 4}
              y={chartData.yOf(grandTotalLast.value) - 8}
              textAnchor="end"
              fontSize={10}
              fontWeight={600}
              fill={GRAND_TOTAL_LINE_COLOR}
            >
              {fmtMillions(grandTotalLast.value)}
            </text>
          )}
          {hoverIdx !== null && (() => {
            const tooltipW = 190
            const tooltipH = 20 + tooltipRows.length * 16
            const px = chartData.xOf(hoverIdx)
            const tooltipX = clampTooltipX(px, tooltipW, containerWidth)
            const tooltipY = TREND_CHART_PAD.top + 2
            return (
              <g>
                <line x1={px} y1={TREND_CHART_PAD.top} x2={px} y2={TREND_CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                {tooltipRows.map(s => {
                  const pt = s.points[hoverIdx]
                  if (!pt || pt.y === null) return null
                  return <circle key={s.id} cx={pt.x} cy={pt.y} r={3.5} fill={s.color} />
                })}
                <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{quarters[hoverIdx].label}</text>
                {tooltipRows.map((s, i) => {
                  const pt = s.points[hoverIdx]
                  const rowY = tooltipY + 16 + (i + 1) * 16
                  return (
                    <g key={s.id}>
                      <circle cx={tooltipX + 14} cy={rowY - 4} r={3} fill={s.color} />
                      <text x={tooltipX + 24} y={rowY} fontSize={10} fill={s.color}>
                        {pt.value === null ? 'No data' : fmtBalance(pt.value)}
                      </text>
                      <text x={tooltipX + 100} y={rowY} fontSize={10} fill="currentColor" opacity={0.42}>
                        {s.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}

/**
 * RIGHT chart (redefined — was "Category Trend", a per-category BALANCE line
 * chart; is now "Category Delta Trend", a per-category DELTA stacked bar
 * chart). Renamed because the old name/shape no longer describes what's
 * plotted: this reads `BalanceCell.deltaAmount` — the SAME field `DeltaTd`
 * already renders in every per-year table and the same per-cell objects the
 * LEFT chart above already iterates over (`cat.subtotal[q.cellIdx]`), just a
 * different field within them — never a value recomputed here.
 *
 * A signed, DIVERGING stacked bar: for a given quarter, every category whose
 * delta is positive stacks UPWARD from a zero baseline; every category whose
 * delta is negative stacks DOWNWARD from that same baseline. Sign is carried
 * by POSITION (which side of the baseline a segment falls on), not by color —
 * each segment keeps its category's own `CATEGORY_LINE_COLORS` hue (the same
 * "color follows the entity" rule the LEFT chart's balance stack already
 * follows), so a category is recognizable across both charts regardless of
 * which side of zero it lands on in any given quarter. The zero baseline
 * itself is drawn as a bolder line so the sign boundary is unambiguous even
 * without a hover. `DELTA_POSITIVE_COLOR`/`DELTA_NEGATIVE_COLOR` (this app's
 * own `--gain`/`--loss` hex values) are reserved for the hover tooltip's
 * amount text and the Increase/Decrease legend hint — the one place sign
 * genuinely needs its own color, distinct from category identity.
 *
 * A quarter contributes NO segment for a category when `hasPreviousData` is
 * false, or when `deltaAmount` is `null` (the current balance itself is
 * missing so no delta could be computed), or when the delta is exactly `0`
 * — never a fabricated zero-height bar, mirroring the "absent, not zero"
 * convention already used by every other chart/cell on this page.
 *
 * Its y-domain is independent of the LEFT chart's (a delta is typically a
 * much smaller magnitude than a balance, and is genuinely bipolar — sharing
 * the LEFT chart's balance-only, floor-at-0 domain would flatten every bar
 * here near zero and clip any large negative quarter), and is padded
 * symmetrically on both the positive and negative side (unlike the LEFT
 * chart's balance stack, which only ever needs top padding since it never
 * goes below 0).
 *
 * Feature 1 (12-quarter Grand-Total moving average): an additional overlay
 * LINE — not a bar — plotted on the exact same y-scale as the delta bars
 * above (it reads the same measure, `BalanceCell.deltaAmount`, just off the
 * `grandTotal` array instead of a per-category `subtotal`). See the
 * `maSeries` computation inside `chartData` below for the trailing-window
 * average algorithm itself.
 */
function CategoryDeltaChart({
  quarters, categories, grandTotal,
}: {
  quarters: ChartQuarter[]
  categories: DashboardCategoryRow[]
  /** Same array `GrandTotalRows`/the LEFT chart's Grand Total line already read — powers the 12-quarter moving-average overlay (Feature 1) below. */
  grandTotal: BalanceCell[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(() => {
    if (quarters.length === 0) return null
    const innerW = containerWidth - TREND_CHART_PAD.left - TREND_CHART_PAD.right
    const innerH = TREND_CHART_H - TREND_CHART_PAD.top - TREND_CHART_PAD.bottom

    const xOf = (i: number): number =>
      TREND_CHART_PAD.left + (quarters.length > 1 ? (i / (quarters.length - 1)) * innerW : innerW / 2)

    // Same defensive sort as the LEFT chart — never rely on API array order
    // — kept identical so a category's color always matches its LEFT chart
    // segment color.
    const sortedCategories = [...categories].sort((a, b) => a.orderIndex - b.orderIndex)

    // Per-quarter positive/negative running totals — the y-domain must fit
    // BOTH the tallest positive stack and the deepest negative stack, unlike
    // the LEFT chart's balance stack which never goes below 0.
    const positiveTotalsByQuarter = quarters.map(q =>
      sortedCategories.reduce((sum, cat) => {
        const cell = cat.subtotal[q.cellIdx]
        if (!cell?.hasPreviousData) return sum
        const v = toFiniteOrNull(cell.deltaAmount)
        return v !== null && v > 0 ? sum + v : sum
      }, 0),
    )
    const negativeTotalsByQuarter = quarters.map(q =>
      sortedCategories.reduce((sum, cat) => {
        const cell = cat.subtotal[q.cellIdx]
        if (!cell?.hasPreviousData) return sum
        const v = toFiniteOrNull(cell.deltaAmount)
        return v !== null && v < 0 ? sum + v : sum
      }, 0),
    )

    const domainValues = [...positiveTotalsByQuarter, ...negativeTotalsByQuarter, 0]
    const dataMin = Math.min(...domainValues)
    const dataMax = Math.max(...domainValues)
    const range = Math.max(dataMax - dataMin, 1)
    // Symmetric padding on both sides (see docstring above) — a genuinely
    // bipolar measure, unlike the LEFT chart's floor-at-0 balance stack.
    const yMin = dataMin - range * 0.08
    const yMax = dataMax + range * 0.08
    const yRange = Math.max(yMax - yMin, 1)

    const yOf = (v: number): number => TREND_CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    const spacing = quarters.length > 1 ? innerW / (quarters.length - 1) : innerW
    const barWidth = Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, spacing * 0.55))

    // Diverging stack: positive-delta categories stack UP from the zero
    // baseline, negative-delta categories stack DOWN from it — built as two
    // independent running totals (not one signed cumulative sum), so a
    // positive segment from one category and a negative segment from
    // another never overlap or stack across the zero line.
    const barColumns: BarColumn[] = quarters.map((q, i) => {
      let cumPos = 0
      let cumNeg = 0
      const positiveSegs: BarSegment[] = []
      const negativeSegs: BarSegment[] = []
      sortedCategories.forEach((cat, ci) => {
        const cell = cat.subtotal[q.cellIdx]
        if (!cell?.hasPreviousData) return
        const value = toFiniteOrNull(cell.deltaAmount)
        if (value === null || value === 0) return
        const color = CATEGORY_LINE_COLORS[ci % CATEGORY_LINE_COLORS.length]
        if (value > 0) {
          const yBefore = yOf(cumPos)
          cumPos += value
          const yAfter = yOf(cumPos)
          positiveSegs.push({ categoryId: cat.id, color, yTop: yAfter, yBottom: yBefore, value })
        } else {
          const yBefore = yOf(cumNeg)
          cumNeg += value
          const yAfter = yOf(cumNeg)
          negativeSegs.push({ categoryId: cat.id, color, yTop: yBefore, yBottom: yAfter, value })
        }
      })
      // 2px surface-gap between adjacent segments WITHIN each half of the
      // stack only (never across the zero baseline — the positive and
      // negative halves are two independent stacks, not one continuous run).
      for (let s = 0; s < positiveSegs.length - 1; s++) {
        positiveSegs[s].yTop += BAR_SEGMENT_GAP / 2
        positiveSegs[s + 1].yBottom -= BAR_SEGMENT_GAP / 2
      }
      for (let s = 0; s < negativeSegs.length - 1; s++) {
        negativeSegs[s].yBottom -= BAR_SEGMENT_GAP / 2
        negativeSegs[s + 1].yTop += BAR_SEGMENT_GAP / 2
      }
      return { x: xOf(i), segments: [...positiveSegs, ...negativeSegs] }
    })

    // Tooltip-only per-category series — no line is drawn, the bars ARE the
    // encoding — the exact same pattern as the LEFT chart's own
    // `categoryTooltipSeries`, just carrying the DELTA value instead of balance.
    const categoryTooltipSeries: TrendSeries[] = sortedCategories.map((cat, i) => ({
      id: cat.id,
      label: cat.name,
      color: CATEGORY_LINE_COLORS[i % CATEGORY_LINE_COLORS.length],
      dashed: false,
      strokeWidth: 0,
      points: quarters.map((q, qi) => {
        const cell = cat.subtotal[q.cellIdx]
        const v = cell?.hasPreviousData ? toFiniteOrNull(cell.deltaAmount) : null
        return { x: xOf(qi), y: null, value: v }
      }),
    }))

    // ── 12-quarter Grand-Total moving average overlay (Feature 1) ──────────
    // A single aggregate LINE plotted on the SAME y-scale as the delta bars
    // above (it plots the same measure — delta amount — never a second
    // dual-axis scale). Trailing window, inclusive of the current quarter,
    // capped at 12 points — an EXPANDING window for the first 11
    // chronological quarters (fewer than 12 available yet), never a
    // fixed-size window waiting to "fill up" before it starts plotting.
    // Gated on `hasPreviousData` (never `hasData`) per window member,
    // exactly like `categoryTooltipSeries` above — a quarter with no
    // resolvable delta contributes NOTHING to the average, it is never
    // coerced to 0. A window with zero qualifying members (e.g. the very
    // first chartable quarter, whose own one-quarter window is always
    // `hasPreviousData:false`) is a genuine GAP (`null`), never a
    // fabricated zero, per `buildLinePathWithGaps`'s existing contract.
    const maPoints: TrendPoint[] = quarters.map((q, i) => {
      const windowStart = Math.max(0, i - 11)
      const values: number[] = []
      for (let k = windowStart; k <= i; k++) {
        const cell = grandTotal[quarters[k].cellIdx]
        if (cell?.hasPreviousData) {
          const v = toFiniteOrNull(cell.deltaAmount)
          if (v !== null) values.push(v)
        }
      }
      const avg = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
      return { x: xOf(i), y: avg === null ? null : yOf(avg), value: avg }
    })
    // Reuses `GRAND_TOTAL_LINE_COLOR` — this app's established "this is an
    // aggregate line, not a category" signal (see the LEFT chart's own Grand
    // Total overlay) — with the SAME `6,3` dash pattern the LEFT chart's
    // Grand Total line uses, so the two read as the same kind of aggregate
    // signal across both charts, while staying visually distinct from this
    // chart's own delta bars (different mark type: line vs bar) and from the
    // LEFT chart's own lines (different chart, no risk of confusion).
    const maSeries: TrendSeries = {
      id: 'delta-ma-grand-total',
      label: '12Q Avg (Grand Total)',
      color: GRAND_TOTAL_LINE_COLOR,
      dashed: true,
      strokeWidth: 2,
      points: maPoints,
    }

    const yTicks = computeYTicks(yMin, yRange)
    const xLabelIdxs = computeXLabelIdxs(quarters.length)
    const zeroY = yOf(0)

    return {
      innerW, innerH, xOf, yOf, barColumns, barWidth, yTicks, xLabelIdxs,
      sortedCategories, categoryTooltipSeries, zeroY, maSeries,
    }
  }, [quarters, categories, grandTotal, containerWidth])

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || quarters.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - TREND_CHART_PAD.left
    const step = quarters.length > 1 ? chartData.innerW / (quarters.length - 1) : chartData.innerW
    const idx = Math.max(0, Math.min(quarters.length - 1, Math.round(mouseX / step)))
    setHoverIdx(idx)
  }
  const handleMouseLeave = () => setHoverIdx(null)

  if (quarters.length === 0 || !chartData) return null

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-brand-400" /> Category Delta Trend
        </h2>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap" role="list" aria-label="Category delta trend chart legend">
            {chartData.sortedCategories.map((cat, i) => (
              <span key={cat.id} className="flex items-center gap-1.5" role="listitem">
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: CATEGORY_LINE_COLORS[i % CATEGORY_LINE_COLORS.length] }}
                  aria-hidden="true"
                />
                <span>{cat.name}</span>
              </span>
            ))}
          </div>
          {/* 12-quarter Grand-Total moving average legend entry (Feature 1)
              — deliberately OUTSIDE the category `role="list"` above: it is
              a plotted series like the categories, but it is NOT itself a
              category (it's an aggregate, the same conceptual bucket as
              Grand Total/Non-Property Total on the LEFT chart), so it
              should not count as a "category legend item" for anything that
              iterates that list. Carries a real visible text label, not
              just a color swatch, per WCAG "never color alone". */}
          <div className="flex items-center gap-1.5 text-[10px] text-ink-muted" data-testid="chart-legend-ma">
            <span
              className="inline-block w-3 rounded-full"
              style={{ height: '3px', backgroundColor: GRAND_TOTAL_LINE_COLOR }}
              aria-hidden="true"
            />
            <span className="font-medium text-ink-secondary">12Q Avg (Grand Total)</span>
          </div>
          {/* Sign-convention hint, explaining the zero-baseline mechanic —
              deliberately OUTSIDE the category `role="list"` above, since
              these two chips describe an axis convention, not a plotted
              entity, so they should not count as "legend items". */}
          <div className="flex items-center gap-2 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: DELTA_POSITIVE_COLOR }} aria-hidden="true" />
              Increase
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: DELTA_NEGATIVE_COLOR }} aria-hidden="true" />
              Decrease
            </span>
          </div>
        </div>
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${TREND_CHART_H}px` }}
        role="img"
        aria-label="Category delta trend stacked bar chart with 12-quarter grand-total moving average"
      >
        <svg
          width={containerWidth}
          height={TREND_CHART_H}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: 'crosshair' }}
        >
          {chartData.yTicks.map((tick, i) => {
            const y = chartData.yOf(tick)
            return (
              <g key={i}>
                <line x1={TREND_CHART_PAD.left} y1={y} x2={containerWidth - TREND_CHART_PAD.right} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
                <text x={TREND_CHART_PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {formatAxisNumber(tick)}
                </text>
              </g>
            )
          })}
          {/* The zero baseline — bolder than the regular gridlines above so
              it reads as the sign boundary a positive segment stacks above
              and a negative segment stacks below. */}
          <line
            data-testid="delta-chart-zero-baseline"
            x1={TREND_CHART_PAD.left}
            y1={chartData.zeroY}
            x2={containerWidth - TREND_CHART_PAD.right}
            y2={chartData.zeroY}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1.5}
          />
          {chartData.xLabelIdxs.map(i => (
            <text key={i} x={chartData.xOf(i)} y={TREND_CHART_H - TREND_CHART_PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
              {quarters[i].label}
            </text>
          ))}
          {chartData.barColumns.map((col, qi) => (
            <g key={`delta-bar-${quarters[qi].cellIdx}`} data-testid={`delta-bar-column-${qi}`}>
              {col.segments.map(seg => (
                <rect
                  key={seg.categoryId}
                  data-testid={`delta-bar-segment-${qi}-${seg.categoryId}`}
                  x={col.x - chartData.barWidth / 2}
                  y={seg.yTop}
                  width={chartData.barWidth}
                  height={Math.max(0, seg.yBottom - seg.yTop)}
                  fill={seg.color}
                  fillOpacity={BAR_FILL_OPACITY}
                />
              ))}
            </g>
          ))}
          {/* 12-quarter Grand-Total moving average overlay (Feature 1) —
              rendered on top of the bars, on the exact same x/y scales. */}
          <path
            data-testid="delta-chart-ma-line"
            d={buildLinePathWithGaps(chartData.maSeries.points)}
            fill="none"
            stroke={chartData.maSeries.color}
            strokeWidth={chartData.maSeries.strokeWidth}
            strokeDasharray="6,3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hoverIdx !== null && (() => {
            const tooltipRows = [...chartData.categoryTooltipSeries, chartData.maSeries]
            const tooltipW = 190
            const tooltipH = 20 + tooltipRows.length * 16
            const px = chartData.xOf(hoverIdx)
            const tooltipX = clampTooltipX(px, tooltipW, containerWidth)
            const tooltipY = TREND_CHART_PAD.top + 2
            return (
              <g>
                <line x1={px} y1={TREND_CHART_PAD.top} x2={px} y2={TREND_CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{quarters[hoverIdx].label}</text>
                {tooltipRows.map((s, i) => {
                  const pt = s.points[hoverIdx]
                  const rowY = tooltipY + 16 + (i + 1) * 16
                  const signColor = pt.value === null ? 'currentColor' : pt.value >= 0 ? DELTA_POSITIVE_COLOR : DELTA_NEGATIVE_COLOR
                  return (
                    <g key={s.id}>
                      <circle cx={tooltipX + 14} cy={rowY - 4} r={3} fill={s.color} />
                      <text x={tooltipX + 24} y={rowY} fontSize={10} fill={signColor} opacity={pt.value === null ? 0.42 : 1}>
                        {pt.value === null ? 'No data' : fmtAmount(pt.value)}
                      </text>
                      <text x={tooltipX + 100} y={rowY} fontSize={10} fill="currentColor" opacity={0.42}>
                        {s.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}

// ── Original Investment vs Profit section ──────────────────────────────────────
//
// A standalone card near the top of the page — its OWN React Query, fully
// independent of the balance-grid / chart machinery below (it must never
// break the rest of the page when its fetch is slow or fails). "No original
// investment logged" / not-covered is a first-class state on every row: the
// four numeric columns render an em dash "—", NEVER a fabricated 0 cost
// basis / "0%" / "100%". `profitPercent` comes straight from the server
// (rounded for display only) — never derived client-side.
//
// Feature 2 (expandable per-item charts): each COVERED row can be expanded
// to lazily fetch that item's own ledger (`getRunningTotal`) and chart its
// "original investment vs profit" evolution QUARTER BY QUARTER (the rollup
// above only ever shows the CURRENT snapshot). See `ItemExpandCharts`,
// `ItemStackedProfitChart`, `ItemProfitLineChart`, and the shared
// `deriveItemQuarterSeries` helper below.

/** One end-of-quarter cutoff date, `yyyy-MM-dd` — matches `Entry.entryDate`'s own format exactly (a plain date, no time component; verified against `items/[itemId]/page.tsx`'s date-input usage and this app's own entry fixtures), so a straight string comparison against it is both correct and timezone-safe. */
function quarterEndDate(year: number, quarter: number): string {
  return quarter === 1 ? `${year}-03-31`
    : quarter === 2 ? `${year}-06-30`
    : quarter === 3 ? `${year}-09-30`
    : `${year}-12-31`
}

/** One item's derived per-`chartQuarters`-entry series — computed ONCE by this shared helper so the algorithm lives in exactly one place, even though `ItemStackedProfitChart` and `ItemProfitLineChart` each need a different slice of it (see their own docstrings for why both call sites exist). */
interface ItemQuarterSeries {
  /** The item's OWN balance at that quarter, straight off its `BalanceCell` — `null` when that quarter's slot is `hasData:false`. */
  currentValues: (number | null)[]
  /** Cumulative ledger total AS OF that quarter's own end-date — `null` when the item has zero qualifying ledger entries by then (never 0). */
  originalInvestmentToDate: (number | null)[]
  /** `currentValues[i] - originalInvestmentToDate[i]`, only when BOTH are non-null. */
  profitToDate: (number | null)[]
}

/**
 * Derives, for every entry in `chartQuarters`, the item's own current
 * balance, its cumulative "original investment to date", and the resulting
 * profit-to-date — the exact algorithm from the Feature 2 design, verbatim:
 *
 *  - `currentValue[i]` = the item's own `BalanceCell.balance` at that
 *    quarter when `hasData`, else `null`.
 *  - `originalInvestmentToDate[i]` = the `runningTotal` (server-computed,
 *    NEVER re-summed here) of whichever ledger entry has the greatest
 *    `entryDate` that is still `<=` that quarter's own end-date — `null`
 *    when no entry qualifies yet (not 0). When multiple qualifying entries
 *    share the same max `entryDate`, the one with the greatest `createdAt`
 *    wins, since that is the entry whose `runningTotal` reflects the true
 *    final cumulative total for that date.
 *  - `profitToDate[i]` = `currentValue[i] - originalInvestmentToDate[i]`
 *    only when both are present, else `null`.
 *
 * `entries` is explicitly NOT assumed sorted — the `.reduce` below finds
 * the true max-`(entryDate, createdAt)` qualifying entry regardless of
 * array order. In practice the backend (`GET .../running-total`) already
 * returns `RunningTotal.entries` sorted `entry_date ASC, created_at ASC`
 * (see `tracking_items.py`), so the last qualifying array element is
 * already the correct pick — but this code keys the tie-break explicitly
 * on `(entryDate, createdAt)` rather than relying on array order, so it
 * stays correct even if that server-side sort ever changes.
 */
function deriveItemQuarterSeries(
  chartQuarters: ChartQuarter[],
  cells: BalanceCell[],
  entries: (Entry & { runningTotal: number })[],
): ItemQuarterSeries {
  const currentValues: (number | null)[] = []
  const originalInvestmentToDate: (number | null)[] = []
  const profitToDate: (number | null)[] = []

  for (const q of chartQuarters) {
    const cell = cells[q.cellIdx]
    const currentValue = cell?.hasData ? toFiniteOrNull(cell.balance) : null
    currentValues.push(currentValue)

    const threshold = cell ? quarterEndDate(cell.year, cell.quarter) : null
    const qualifying = threshold ? entries.filter(e => e.entryDate <= threshold) : []
    const oid = qualifying.length === 0
      ? null
      : qualifying.reduce((best, e) =>
          e.entryDate > best.entryDate || (e.entryDate === best.entryDate && e.createdAt > best.createdAt)
            ? e
            : best
        ).runningTotal
    originalInvestmentToDate.push(oid)

    profitToDate.push(currentValue !== null && oid !== null ? currentValue - oid : null)
  }

  return { currentValues, originalInvestmentToDate, profitToDate }
}

/**
 * Chart A of the expand-row pair: a two-segment stacked bar per quarter —
 * bottom segment = original-investment-to-date, top segment = profit-to-date
 * (so the stack's top edge equals `currentValue[i]` whenever both segments
 * are present) — PLUS an overlaid line of the item's own current value (read
 * straight off its own `cells`, never derived from the stack) so a viewer
 * can visually cross-check bar-top vs line; the two should track each other
 * whenever both are present.
 *
 * Segment colors: the bottom (original-investment) segment uses
 * `ORIGINAL_INVESTMENT_COLOR`, a neutral "cost basis" gray — original
 * investment has no inherent sign. The top (profit) segment is SIGN-AWARE —
 * `DELTA_POSITIVE_COLOR`/`DELTA_NEGATIVE_COLOR` per segment, mirroring the
 * exact convention `RollupNumericCells`/`fmtAmount` already use to color a
 * Profit figure elsewhere on this page — profit CAN be negative, so a single
 * fixed "profit color" would misstate a loss quarter as a gain.
 *
 * A quarter renders NO bar when either segment is `null` (absent, never a
 * fabricated partial bar) — but the current-value LINE point still renders
 * independently if it alone is present, since the line is a separate mark
 * driven by its own (possibly-present) value.
 */
function ItemStackedProfitChart({
  chartQuarters, cells, entries,
}: {
  chartQuarters: ChartQuarter[]
  cells: BalanceCell[]
  entries: (Entry & { runningTotal: number })[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    // Named `resizeEntries` (not `entries`) to avoid shadowing this
    // component's own `entries` prop (the item's ledger entries).
    const observer = new ResizeObserver(resizeEntries => {
      for (const entry of resizeEntries) setContainerWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(() => {
    if (chartQuarters.length === 0) return null
    const innerW = containerWidth - TREND_CHART_PAD.left - TREND_CHART_PAD.right
    const innerH = TREND_CHART_H - TREND_CHART_PAD.top - TREND_CHART_PAD.bottom
    const xOf = (i: number): number =>
      TREND_CHART_PAD.left + (chartQuarters.length > 1 ? (i / (chartQuarters.length - 1)) * innerW : innerW / 2)

    const { currentValues, originalInvestmentToDate, profitToDate } = deriveItemQuarterSeries(chartQuarters, cells, entries)

    const domainValues = [
      ...currentValues.filter((v): v is number => v !== null),
      ...originalInvestmentToDate.filter((v): v is number => v !== null),
    ]
    const dataMin = Math.min(0, ...(domainValues.length ? domainValues : [0]))
    const dataMax = domainValues.length ? Math.max(...domainValues) : 1
    const range = Math.max(dataMax - dataMin, 1)
    const yMin = dataMin - range * 0.05
    const yMax = dataMax + range * 0.1
    const yRange = Math.max(yMax - yMin, 1)
    const yOf = (v: number): number => TREND_CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    const spacing = chartQuarters.length > 1 ? innerW / (chartQuarters.length - 1) : innerW
    const barWidth = Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, spacing * 0.55))

    // A bar renders ONLY when both segments are resolvable (see docstring) —
    // never a fabricated partial bar for a quarter missing just one side.
    const barColumns: BarColumn[] = chartQuarters.map((q, i) => {
      const oid = originalInvestmentToDate[i]
      const profit = profitToDate[i]
      const segments: BarSegment[] = []
      if (oid !== null && profit !== null) {
        const yZero = yOf(0)
        const yOid = yOf(oid)
        const yTotal = yOf(oid + profit)
        segments.push({
          categoryId: 'original-investment',
          color: ORIGINAL_INVESTMENT_COLOR,
          yTop: Math.min(yZero, yOid),
          yBottom: Math.max(yZero, yOid),
          value: oid,
        })
        segments.push({
          categoryId: 'profit',
          color: profit >= 0 ? DELTA_POSITIVE_COLOR : DELTA_NEGATIVE_COLOR,
          yTop: Math.min(yOid, yTotal),
          yBottom: Math.max(yOid, yTotal),
          value: profit,
        })
        // 2px surface-gap between the two segments — the same convention
        // every other stacked bar on this page uses (see `BAR_SEGMENT_GAP`).
        segments[0].yTop += BAR_SEGMENT_GAP / 2
        segments[1].yBottom -= BAR_SEGMENT_GAP / 2
      }
      return { x: xOf(i), segments }
    })

    const currentValueLine: TrendPoint[] = currentValues.map((v, i) => ({
      x: xOf(i), y: v === null ? null : yOf(v), value: v,
    }))

    const yTicks = computeYTicks(yMin, yRange)
    const xLabelIdxs = computeXLabelIdxs(chartQuarters.length)

    return {
      innerW, innerH, xOf, yOf, barColumns, barWidth, yTicks, xLabelIdxs, currentValueLine,
      originalInvestmentToDate, profitToDate,
    }
  }, [chartQuarters, cells, entries, containerWidth])

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || chartQuarters.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - TREND_CHART_PAD.left
    const step = chartQuarters.length > 1 ? chartData.innerW / (chartQuarters.length - 1) : chartData.innerW
    const idx = Math.max(0, Math.min(chartQuarters.length - 1, Math.round(mouseX / step)))
    setHoverIdx(idx)
  }
  const handleMouseLeave = () => setHoverIdx(null)

  if (chartQuarters.length === 0 || !chartData) return null

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-semibold text-ink-primary">Original Investment vs Profit (by quarter)</h3>
        <div className="flex items-center gap-3 text-[10px] text-ink-muted flex-wrap" role="list" aria-label="Item stacked profit chart legend">
          <span className="flex items-center gap-1.5" role="listitem">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: ORIGINAL_INVESTMENT_COLOR }} aria-hidden="true" />
            <span>Original investment</span>
          </span>
          <span className="flex items-center gap-1.5" role="listitem">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: DELTA_POSITIVE_COLOR }} aria-hidden="true" />
            <span>Profit</span>
          </span>
          <span className="flex items-center gap-1.5" role="listitem">
            <span className="inline-block w-3 rounded-full" style={{ height: '3px', backgroundColor: 'currentColor' }} aria-hidden="true" />
            <span>Current value</span>
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${TREND_CHART_H}px` }}
        role="img"
        aria-label="Item original investment vs profit stacked bar chart"
      >
        <svg
          width={containerWidth}
          height={TREND_CHART_H}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: 'crosshair' }}
        >
          {chartData.yTicks.map((tick, i) => {
            const y = chartData.yOf(tick)
            return (
              <g key={i}>
                <line x1={TREND_CHART_PAD.left} y1={y} x2={containerWidth - TREND_CHART_PAD.right} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
                <text x={TREND_CHART_PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {formatAxisNumber(tick)}
                </text>
              </g>
            )
          })}
          {chartData.xLabelIdxs.map(i => (
            <text key={i} x={chartData.xOf(i)} y={TREND_CHART_H - TREND_CHART_PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
              {chartQuarters[i].label}
            </text>
          ))}
          {chartData.barColumns.map((col, qi) => (
            <g key={`item-bar-${chartQuarters[qi].cellIdx}`} data-testid={`item-bar-column-${qi}`}>
              {col.segments.map(seg => (
                <rect
                  key={seg.categoryId}
                  data-testid={`item-bar-segment-${qi}-${seg.categoryId}`}
                  x={col.x - chartData.barWidth / 2}
                  y={seg.yTop}
                  width={chartData.barWidth}
                  height={Math.max(0, seg.yBottom - seg.yTop)}
                  fill={seg.color}
                  fillOpacity={BAR_FILL_OPACITY}
                />
              ))}
            </g>
          ))}
          <path
            data-testid="item-current-value-line"
            d={buildLinePathWithGaps(chartData.currentValueLine)}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.85}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hoverIdx !== null && (() => {
            const tooltipRows: TrendSeries[] = [
              { id: 'current-value', label: 'Current value', color: '#E2E8F0', dashed: false, strokeWidth: 0, points: chartData.currentValueLine },
              {
                id: 'original-investment', label: 'Original investment', color: ORIGINAL_INVESTMENT_COLOR, dashed: false, strokeWidth: 0,
                points: chartData.originalInvestmentToDate.map((v, i) => ({ x: chartData.xOf(i), y: null, value: v })),
              },
              {
                id: 'profit', label: 'Profit', color: DELTA_POSITIVE_COLOR, dashed: false, strokeWidth: 0,
                points: chartData.profitToDate.map((v, i) => ({ x: chartData.xOf(i), y: null, value: v })),
              },
            ]
            const tooltipW = 190
            const tooltipH = 20 + tooltipRows.length * 16
            const px = chartData.xOf(hoverIdx)
            const tooltipX = clampTooltipX(px, tooltipW, containerWidth)
            const tooltipY = TREND_CHART_PAD.top + 2
            return (
              <g>
                <line x1={px} y1={TREND_CHART_PAD.top} x2={px} y2={TREND_CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{chartQuarters[hoverIdx].label}</text>
                {tooltipRows.map((s, i) => {
                  const pt = s.points[hoverIdx]
                  const rowY = tooltipY + 16 + (i + 1) * 16
                  return (
                    <g key={s.id}>
                      <circle cx={tooltipX + 14} cy={rowY - 4} r={3} fill={s.color} />
                      <text x={tooltipX + 24} y={rowY} fontSize={10} fill="currentColor" opacity={pt.value === null ? 0.42 : 0.85}>
                        {pt.value === null ? 'No data' : fmtBalance(pt.value)}
                      </text>
                      <text x={tooltipX + 100} y={rowY} fontSize={10} fill="currentColor" opacity={0.42}>
                        {s.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}

/**
 * Chart B of the expand-row pair: a simple, single-line chart of
 * `profitToDate` ONLY — reuses the series `ItemExpandCharts` already derived
 * (via `deriveItemQuarterSeries`) rather than recomputing it here. Gaps
 * (null quarters) render as genuine breaks via `buildLinePathWithGaps`, same
 * as every other line on this page.
 */
function ItemProfitLineChart({
  chartQuarters, profitToDate,
}: {
  chartQuarters: ChartQuarter[]
  profitToDate: (number | null)[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(() => {
    if (chartQuarters.length === 0) return null
    const innerW = containerWidth - TREND_CHART_PAD.left - TREND_CHART_PAD.right
    const innerH = TREND_CHART_H - TREND_CHART_PAD.top - TREND_CHART_PAD.bottom
    const xOf = (i: number): number =>
      TREND_CHART_PAD.left + (chartQuarters.length > 1 ? (i / (chartQuarters.length - 1)) * innerW : innerW / 2)

    const values = profitToDate.filter((v): v is number => v !== null)
    const dataMin = values.length ? Math.min(0, ...values) : 0
    const dataMax = values.length ? Math.max(0, ...values) : 1
    const range = Math.max(dataMax - dataMin, 1)
    const yMin = dataMin - range * 0.08
    const yMax = dataMax + range * 0.08
    const yRange = Math.max(yMax - yMin, 1)
    const yOf = (v: number): number => TREND_CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    const points: TrendPoint[] = profitToDate.map((v, i) => ({
      x: xOf(i), y: v === null ? null : yOf(v), value: v,
    }))

    const yTicks = computeYTicks(yMin, yRange)
    const xLabelIdxs = computeXLabelIdxs(chartQuarters.length)
    const zeroY = yOf(0)

    return { innerW, innerH, xOf, yOf, points, yTicks, xLabelIdxs, zeroY }
  }, [chartQuarters, profitToDate, containerWidth])

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || chartQuarters.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - TREND_CHART_PAD.left
    const step = chartQuarters.length > 1 ? chartData.innerW / (chartQuarters.length - 1) : chartData.innerW
    const idx = Math.max(0, Math.min(chartQuarters.length - 1, Math.round(mouseX / step)))
    setHoverIdx(idx)
  }
  const handleMouseLeave = () => setHoverIdx(null)

  if (chartQuarters.length === 0 || !chartData) return null

  return (
    <div className="card p-3 space-y-2">
      <h3 className="text-xs font-semibold text-ink-primary">Profit vs Original (trend)</h3>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${TREND_CHART_H}px` }}
        role="img"
        aria-label="Item profit trend line chart"
      >
        <svg
          width={containerWidth}
          height={TREND_CHART_H}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: 'block', cursor: 'crosshair' }}
        >
          {chartData.yTicks.map((tick, i) => {
            const y = chartData.yOf(tick)
            return (
              <g key={i}>
                <line x1={TREND_CHART_PAD.left} y1={y} x2={containerWidth - TREND_CHART_PAD.right} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
                <text x={TREND_CHART_PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {formatAxisNumber(tick)}
                </text>
              </g>
            )
          })}
          <line
            data-testid="item-profit-line-zero-baseline"
            x1={TREND_CHART_PAD.left}
            y1={chartData.zeroY}
            x2={containerWidth - TREND_CHART_PAD.right}
            y2={chartData.zeroY}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1.5}
          />
          {chartData.xLabelIdxs.map(i => (
            <text key={i} x={chartData.xOf(i)} y={TREND_CHART_H - TREND_CHART_PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
              {chartQuarters[i].label}
            </text>
          ))}
          <path
            data-testid="item-profit-line"
            d={buildLinePathWithGaps(chartData.points)}
            fill="none"
            stroke={ITEM_PROFIT_LINE_COLOR}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hoverIdx !== null && (() => {
            const pt = chartData.points[hoverIdx]
            const tooltipW = 130
            const tooltipH = 36
            const px = chartData.xOf(hoverIdx)
            const tooltipX = clampTooltipX(px, tooltipW, containerWidth)
            const tooltipY = TREND_CHART_PAD.top + 2
            const signColor = pt.value === null ? 'currentColor' : pt.value >= 0 ? DELTA_POSITIVE_COLOR : DELTA_NEGATIVE_COLOR
            return (
              <g>
                <line x1={px} y1={TREND_CHART_PAD.top} x2={px} y2={TREND_CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                {pt.y !== null && <circle cx={pt.x} cy={pt.y} r={3.5} fill={ITEM_PROFIT_LINE_COLOR} />}
                <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{chartQuarters[hoverIdx].label}</text>
                <text x={tooltipX + 10} y={tooltipY + 30} fontSize={10} fill={signColor} opacity={pt.value === null ? 0.42 : 1}>
                  {pt.value === null ? 'No data' : fmtAmount(pt.value)}
                </text>
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}

/**
 * Rendered for every COVERED row (see `OriginalInvestmentSection`) but kept
 * visually `hidden` by the parent until that row is actually expanded — it
 * stays MOUNTED the whole time (never unmounts on collapse) so the
 * `getRunningTotal` query keeps a live observer at all times, and therefore
 * is never garbage-collected out of the QueryClient cache on collapse (a
 * component that unmounts entirely on collapse would lose its cached result
 * the instant `gcTime` elapses — 0 in this app's own test `QueryClient`,
 * see `test-utils.tsx`, but a real risk in production too if `gcTime` were
 * ever tuned down). `enabled: isExpanded` is what actually gates the
 * FETCH — never mounting, never a bare `useQuery({...})` with no gate —
 * so `getRunningTotal` still only ever fires on first expand, never for
 * every row upfront, while a later collapse + re-expand within `staleTime`
 * reads the still-live cached result instead of re-fetching.
 */
function ItemExpandCharts({
  itemId, cells, chartQuarters, isExpanded,
}: {
  itemId: string
  /** This item's own `BalanceCell[]` from the (independently-queried) balance grid — `undefined` while that query hasn't resolved yet; the grid and rollup queries can settle in either order. */
  cells: BalanceCell[] | undefined
  chartQuarters: ChartQuarter[]
  /** Whether this row is CURRENTLY expanded — gates the `getRunningTotal` fetch itself (see this component's own docstring for why that's a better lazy-fetch gate than conditional mounting). */
  isExpanded: boolean
}) {
  const { data: runningTotal, isLoading, isError } = useQuery({
    queryKey: ['tracking-running-total', itemId],
    queryFn: () => trackingService.getRunningTotal(itemId),
    enabled: isExpanded,
    staleTime: 10_000,
  })

  // While collapsed the parent already hides this row visually (`hidden`,
  // see `OriginalInvestmentSection`) — this early return just avoids
  // rendering a disabled query's transient "no data yet" state as a
  // misleading error before the row has ever been expanded once.
  if (!isExpanded) return null

  if (!cells) {
    return (
      <div className="flex items-center gap-2 text-ink-muted text-xs py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading balances…
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-ink-muted text-xs py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading entry history…
      </div>
    )
  }
  if (isError || !runningTotal) {
    return (
      <div className="flex items-center gap-2 text-loss text-xs py-3">
        <AlertCircle className="w-3.5 h-3.5" /> Failed to load entry history for this item.
      </div>
    )
  }

  // `profitToDate` is derived here ONCE and passed straight to
  // `ItemProfitLineChart` (which must NOT recompute it). `ItemStackedProfitChart`
  // independently derives the SAME series via the same `deriveItemQuarterSeries`
  // helper from its own `cells`/`entries` props (its documented signature) —
  // the algorithm itself still lives in exactly one place even though it's
  // invoked from two call sites.
  const { profitToDate } = deriveItemQuarterSeries(chartQuarters, cells, runningTotal.entries)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ItemStackedProfitChart chartQuarters={chartQuarters} cells={cells} entries={runningTotal.entries} />
      <ItemProfitLineChart chartQuarters={chartQuarters} profitToDate={profitToDate} />
    </div>
  )
}

/** Coverage line + an optional `<details>` disclosure of the excluded item names. */
function CoverageBadge({ coverage }: { coverage: OriginalInvestmentCoverage }) {
  return (
    <div className="text-xs text-ink-muted space-y-1">
      <p>
        Profit vs original shown for{' '}
        <span className="font-semibold text-ink-secondary">
          {coverage.shownCount} of {coverage.totalCount}
        </span>{' '}
        tracked items
      </p>
      {coverage.excludedItemNames.length > 0 && (
        <details>
          <summary className="cursor-pointer hover:text-brand-400 transition-colors">
            Which items are excluded?
          </summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-ink-disabled">
            {coverage.excludedItemNames.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The four numeric `<td>`s for one rollup row — all "—" when the row is not covered. */
function RollupNumericCells({ row }: { row: OriginalInvestmentItemRow }) {
  if (!row.isCovered) {
    return (
      <>
        <td className="px-3 py-1.5 text-right text-ink-disabled">—</td>
        <td className="px-3 py-1.5 text-right text-ink-disabled">—</td>
        <td className="px-3 py-1.5 text-right text-ink-disabled">—</td>
        <td className="px-3 py-1.5 text-right text-ink-disabled">—</td>
      </>
    )
  }
  return (
    <>
      <td className="px-3 py-1.5 text-right font-mono text-ink-secondary whitespace-nowrap">
        {row.netOriginalInvestment === null ? '—' : fmtBalance(row.netOriginalInvestment)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-ink-secondary whitespace-nowrap">
        {row.currentValue === null ? '—' : fmtBalance(row.currentValue)}
        {row.currentValueSlot && (
          <span className="ml-1 text-[10px] text-ink-disabled">
            Q{row.currentValueSlot.quarter} {row.currentValueSlot.year}
          </span>
        )}
      </td>
      <td
        className={cn(
          'px-3 py-1.5 text-right font-mono whitespace-nowrap',
          row.profit === null ? 'text-ink-disabled' : row.profit >= 0 ? 'text-gain' : 'text-loss',
        )}
      >
        {row.profit === null ? '—' : fmtAmount(row.profit)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-ink-secondary whitespace-nowrap">
        {row.profitPercent === null ? '—' : `${row.profitPercent.toFixed(2)}%`}
      </td>
    </>
  )
}

function OriginalInvestmentSection({
  setId, grid, chartQuarters,
}: {
  setId: string
  /** The page's OWN balance-grid query result — an INDEPENDENT query from this section's own rollup query below, so it may resolve at a different time (or not yet at all) when a row is expanded; see `ItemExpandCharts`' own "Loading balances…" placeholder for how that race is handled. */
  grid: DashboardBalanceGridOut | undefined
  chartQuarters: ChartQuarter[]
}) {
  const { data: rollup, isLoading, isError } = useQuery({
    queryKey: ['tracking-original-investment', setId],
    queryFn: () => trackingService.getOriginalInvestmentRollup(setId),
    enabled: !!setId,
    staleTime: 10_000,
  })

  // Flattened lookup of every tracking item's OWN `BalanceCell[]` from the
  // balance grid, keyed by item id — used only to feed each expanded row's
  // charts (Feature 2); otherwise this section stays fully independent of
  // `grid`, per its own module-header docstring above.
  const itemsById = useMemo(() => {
    const map = new Map<string, DashboardItemRow>()
    grid?.categories.forEach(cat =>
      cat.subCategories.forEach(sub =>
        sub.items.forEach(item => map.set(item.id, item)),
      ),
    )
    return map
  }, [grid])

  // Per-row expand/collapse state for the lazy per-item charts (Feature 2).
  // NOTE the semantics inversion vs. every other `useToggleSet` on this page
  // (`collapsedYears`/`collapsedCategories`/`collapsedSubCategories`, all of
  // which track COLLAPSED ids, default-expanded): this one tracks EXPANDED
  // ids instead, default-COLLAPSED — these charts are lazy/heavy (each
  // expand triggers its own `getRunningTotal` fetch), so starting every row
  // pre-expanded would defeat the entire point of lazy-loading them.
  const expandedItemIds = useToggleSet<string>()

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
        <Target className="w-4 h-4 text-brand-400" /> Original Investment vs Profit
      </h2>

      {isLoading ? (
        <div className="flex items-center gap-2 text-ink-muted text-xs py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading original-investment rollup…
        </div>
      ) : isError || !rollup ? (
        <div className="flex items-center gap-2 text-loss text-xs py-4">
          <AlertCircle className="w-3.5 h-3.5" /> Failed to load the original-investment rollup.
        </div>
      ) : rollup.items.length === 0 ? (
        <p className="text-xs text-ink-muted py-2">
          No items have original-investment tracking enabled yet.
        </p>
      ) : (
        <>
          <CoverageBadge coverage={rollup.coverage} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-border text-ink-muted">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Item</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Category</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Sub-category</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Original investment</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Current value</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Profit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Profit %</th>
                </tr>
              </thead>
              <tbody>
                {rollup.items.map(row => {
                  // Only COVERED rows get an expand control — a not-covered
                  // row has no computable profit figure to chart at all
                  // (see `RollupNumericCells`), so it keeps its exact
                  // current rendering, untouched.
                  const expanded = row.isCovered && expandedItemIds.has(row.itemId)
                  return (
                    <Fragment key={row.itemId}>
                      <tr className="border-b border-border/40">
                        <td
                          className="px-3 py-1.5 text-ink-primary max-w-[16rem] truncate"
                          title={row.itemName}
                        >
                          {row.isCovered && (
                            <button
                              type="button"
                              onClick={() => expandedItemIds.toggle(row.itemId)}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Collapse' : 'Expand'} charts for ${row.itemName}`}
                              className="inline-flex items-center justify-center w-4 h-4 mr-1 -ml-0.5 align-text-bottom text-ink-muted hover:text-brand-400 transition-colors shrink-0"
                            >
                              {expanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {row.itemName}
                        </td>
                        <td className="px-3 py-1.5 text-ink-secondary">{row.categoryName}</td>
                        <td className="px-3 py-1.5 text-ink-secondary">{row.subCategoryName}</td>
                        <RollupNumericCells row={row} />
                      </tr>
                      {/* Rendered UNCONDITIONALLY for every covered row (not
                          gated by `expanded`) — only visually `hidden` when
                          collapsed. This keeps `ItemExpandCharts` (and its
                          `getRunningTotal` query) mounted permanently once
                          the rollup itself has loaded, which is what makes
                          the query's own `enabled: isExpanded` gate (rather
                          than mount/unmount) the thing that decides whether
                          it has ever fetched — see that component's own
                          docstring for why this avoids losing the cached
                          result to `QueryClient` garbage collection on every
                          collapse. */}
                      {row.isCovered && (
                        <tr hidden={!expanded} className="border-b border-border/40 bg-surface-elevated/20">
                          <td colSpan={7} className="px-3 py-3">
                            <ItemExpandCharts
                              itemId={row.itemId}
                              cells={itemsById.get(row.itemId)?.cells}
                              chartQuarters={chartQuarters}
                              isExpanded={expanded}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-elevated/40 font-semibold">
                  <td className="px-3 py-2 text-ink-primary" colSpan={3}>Total (covered items)</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary whitespace-nowrap">
                    {rollup.totals.netOriginalInvestment === null ? '—' : fmtBalance(rollup.totals.netOriginalInvestment)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary whitespace-nowrap">
                    {rollup.totals.currentValue === null ? '—' : fmtBalance(rollup.totals.currentValue)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-mono whitespace-nowrap',
                      rollup.totals.profit === null
                        ? 'text-ink-disabled'
                        : rollup.totals.profit >= 0 ? 'text-gain' : 'text-loss',
                    )}
                  >
                    {rollup.totals.profit === null ? '—' : fmtAmount(rollup.totals.profit)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-primary whitespace-nowrap">
                    {rollup.totals.profitPercent === null ? '—' : `${rollup.totals.profitPercent.toFixed(2)}%`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TrackingDashboardPage() {
  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const queryClient = useQueryClient()

  const { data: sets = [], isLoading: setsLoading, isError: setsError } = useQuery({
    queryKey: ['tracking-sets'],
    queryFn: trackingService.listSets,
    staleTime: 30_000,
  })

  // Default the selection to the first available set once loaded — mirrors
  // the Category/Updates pages' selector so all three behave identically.
  useEffect(() => {
    if (!selectedSetId && sets.length > 0) {
      setSelectedSetId(sets[0].id)
    }
  }, [sets, selectedSetId])

  const { data: grid, isLoading: gridLoading, isError: gridError } = useQuery<DashboardBalanceGridOut>({
    queryKey: ['tracking-dashboard-balance-grid', selectedSetId],
    queryFn: () => trackingService.getBalanceGrid(selectedSetId),
    enabled: !!selectedSetId,
    staleTime: 10_000,
  })

  // Collapse state — everything expanded by default (Detail view).
  // `collapsedYears` gates whether a whole per-year <table> renders or just
  // its collapsed header bar. `collapsedCategories`/`collapsedSubCategories`
  // are SHARED (single Set each) across every year table, which is what
  // makes the global Summary/Detail toggle below affect all of them at once.
  const collapsedYears = useToggleSet<number>()
  const collapsedCategories = useToggleSet<string>()
  const collapsedSubCategories = useToggleSet<string>()

  const allCategoryIds = useMemo(() => grid?.categories.map(c => c.id) ?? [], [grid])
  const allSubCategoryIds = useMemo(
    () => grid?.categories.flatMap(c => c.subCategories.map(s => s.id)) ?? [],
    [grid],
  )

  // Global Summary/Detail toggle — bulk-sets every Category+SubCategory's
  // collapse state at once, across every year table simultaneously (since
  // the state is shared). This is in ADDITION to the independent per-row
  // toggles above, not a replacement: after clicking "Summary" a user can
  // still re-expand one Category via its own chevron, which just flips that
  // one row's state independently (setAll/clear here vs. toggle there both
  // operate on the same underlying Set, so there is no conflict).
  const showSummary = () => {
    collapsedCategories.setAll(allCategoryIds)
    collapsedSubCategories.setAll(allSubCategoryIds)
  }
  const showDetail = () => {
    collapsedCategories.clear()
    collapsedSubCategories.clear()
  }
  // Sub-category view: Category rows visible (their subtotal), SubCategory
  // rows visible (their own subtotal row), Item rows hidden. Expanding every
  // Category (so SubCategory rows render underneath) while collapsing every
  // SubCategory (so Item rows stay hidden) achieves exactly that — and, since
  // this operates on the same shared Sets as the per-row chevrons, a user can
  // still click one SubCategory's own chevron afterward to independently
  // re-expand just that one's items, same as Detail/Summary already allow.
  const showSubCategory = () => {
    collapsedCategories.clear()
    collapsedSubCategories.setAll(allSubCategoryIds)
  }

  const hasYears = !!grid && grid.years.length > 0

  // Requirement 1: shared Q1-Q4 Balance/Delta column widths (computed
  // separately per column type, see useSharedColWidths), computed once over
  // the whole grid, applied uniformly across every YearTable.
  const colWidths = useSharedColWidths(grid)

  // ── Non-Property Total target + progress (Change 2) ───────────────────────
  // One target value per tracking set, loaded/saved to localStorage keyed by
  // `selectedSetId` (see loadNonPropertyTarget/saveNonPropertyTarget above).
  // Reloaded whenever the selected set changes so switching sets doesn't
  // leak one set's target onto another's.
  const [target, setTargetState] = useState<number>(DEFAULT_NON_PROPERTY_TARGET)
  useEffect(() => {
    if (selectedSetId) setTargetState(loadNonPropertyTarget(selectedSetId))
  }, [selectedSetId])
  const handleTargetChange = (value: number) => {
    setTargetState(value)
    if (selectedSetId) saveNonPropertyTarget(selectedSetId, value)
  }

  // Most recent quarter WITH DATA for Non-Property Total, searched
  // chronologically across the WHOLE dataset (not per-year) — `grid.years`
  // is descending-by-year per the documented contract (see
  // `DashboardBalanceGridOut.years`), so index 0 is the most recent year;
  // within a year, quarters are searched Q4 -> Q1. This is a genuine
  // backward search (not just "read the last array entry") because the most
  // recent YEAR can still have its most recent QUARTERS blank (e.g. this
  // year's Q4/Q3 not yet recorded while Q2 is) — falls through to older
  // years/quarters until it finds real data, or `null` if the tracking set
  // has no Non-Property data recorded at all (nothing is fabricated in that
  // case; the progress UI simply doesn't render).
  const currentNonProperty = useMemo(() => {
    if (!grid) return null
    for (let yearIdx = 0; yearIdx < grid.years.length; yearIdx++) {
      for (let qIdx = 3; qIdx >= 0; qIdx--) {
        const cell = grid.propertyBreakdown.nonPropertyTotal[yearIdx * 4 + qIdx]
        if (cell?.hasData) {
          const balance = toFiniteOrNull(cell.balance)
          if (balance !== null) return balance
        }
      }
    }
    return null
  }, [grid])

  // ── Shared chart quarters (Gate 2) ─────────────────────────────────────────
  // ONE `quarters` array, computed once here at the page level and passed as
  // a prop to BOTH `CategoryStackedBarChart` and `CategoryDeltaChart` — so
  // their x-axis ranges can never independently drift apart. Chronological
  // (oldest -> newest) order for the x-axis ONLY — the REVERSE of `years`'s
  // descending order that every per-year `YearTable` uses verbatim. Each
  // entry also carries `cellIdx`, the ORIGINAL (non-reversed)
  // `yearIdx*4 + quarterIdx` position every cells/subtotal/grandTotal/
  // propertyBreakdown array is positionally aligned to, so series values are
  // read straight out of the existing arrays with no re-derivation.
  const chartQuarters = useMemo((): ChartQuarter[] => {
    if (!grid) return []
    const { years, categories, grandTotal } = grid
    const reversedYears = [...years].reverse()
    const all: ChartQuarter[] = reversedYears.flatMap(yearCol => {
      const origYearIdx = years.indexOf(yearCol)
      return yearCol.quarters.map((q, i) => ({
        label: `Q${q} ${yearCol.year}`,
        cellIdx: origYearIdx * 4 + i,
      }))
    })

    const hasDataAt = (q: ChartQuarter) =>
      categories.some(cat => cat.subtotal[q.cellIdx]?.hasData) || grandTotal[q.cellIdx]?.hasData

    // Leading trim (existing) — skip quarters before the earliest quarter
    // with data in ANY series (category subtotal or grand total) — e.g. a
    // tracking set whose earliest Update List is 2022-Q4 shouldn't chart
    // three blank leading quarters (2022-Q1..Q3), even though `years[]`
    // always contracts to all 4 quarters per year for the tables.
    const firstDataIdx = all.findIndex(hasDataAt)

    // Trailing trim (requirement 4, NEW) — the SAME "has data" predicate,
    // searched from the end via a manual reverse for-loop rather than
    // `Array.prototype.findLastIndex` (this file doesn't use that method
    // elsewhere, so this stays consistent with its existing findIndex/loop
    // idioms). E.g. the latest year having Q3/Q4 not yet recorded shouldn't
    // chart two blank trailing quarters. Interior gaps are untouched —
    // `buildLinePathWithGaps` already renders those correctly; this and the
    // leading trim above only remove the unstarted prefix/suffix.
    let lastDataIdx = -1
    for (let i = all.length - 1; i >= 0; i--) {
      if (hasDataAt(all[i])) { lastDataIdx = i; break }
    }

    // Both indices share the exact same predicate over the exact same
    // array, so if the forward search finds nothing the backward search
    // can't find anything either (verified) — both are still checked (not
    // just one) as a defensive guard against that invariant ever breaking,
    // rather than relying on it silently.
    if (firstDataIdx === -1 || lastDataIdx === -1) return all
    return all.slice(firstDataIdx, lastDataIdx + 1)
  }, [grid])

  // ── Email Dashboard (Change: Email Dashboard feature) ──────────────────────
  // Builds the email HTML client-side from already-loaded state (no
  // re-fetch — `grid` + the three collapse Sets are exactly what's on
  // screen right now), fetches a full JSON backup export, then POSTs both
  // to the main-backend email endpoint. Three genuinely distinct failure
  // messages by design:
  //   1. the export fetch itself fails -> nothing is sent at all (a partial
  //      send without the real backup would violate "every export includes
  //      a genuine complete backup")
  //   2. 503 -> SMTP isn't configured server-side
  //   3. 502 -> the export succeeded but the email itself failed to send
  // `finally` guarantees the button re-enables on every path, success or
  // failure.
  const [sendingEmail, setSendingEmail] = useState(false)

  const handleEmailDashboard = async () => {
    if (!grid || !selectedSetId) return
    setSendingEmail(true)
    try {
      // Graceful degradation: reuse the already-loaded rollup from the query
      // cache (populated by <OriginalInvestmentSection>), else fetch it once
      // here. If that fetch fails, the email STILL sends with the balance
      // grid only — `rollup = null` simply omits the profit section.
      let rollup: OriginalInvestmentRollup | null =
        queryClient.getQueryData<OriginalInvestmentRollup>(
          ['tracking-original-investment', selectedSetId],
        ) ?? null
      if (!rollup) {
        try {
          rollup = await trackingService.getOriginalInvestmentRollup(selectedSetId)
        } catch {
          rollup = null
          console.warn('Original-investment rollup unavailable — emailing the balance grid only')
        }
      }

      const html = buildDashboardEmailHtml(
        grid,
        {
          collapsedYears: collapsedYears.set,
          collapsedCategories: collapsedCategories.set,
          collapsedSubCategories: collapsedSubCategories.set,
        },
        rollup,
      )

      let exportPayload: Awaited<ReturnType<typeof trackingService.getExport>>
      try {
        exportPayload = await trackingService.getExport(selectedSetId)
      } catch {
        toast.error('Could not build backup — dashboard not emailed')
        return
      }

      const attachmentContent = utf8ToBase64(JSON.stringify(exportPayload))
      const now = new Date()
      const todayLabel = now.toISOString().slice(0, 10)
      const timestampLabel = now.toISOString().replace(/[:.]/g, '-')

      try {
        const result = await sendExportEmail({
          subject: `Financial Tracker Export - ${todayLabel}`,
          htmlBody: html,
          attachmentFilename: `tracking-backup-${selectedSetId}-${timestampLabel}.json`,
          attachmentContent,
        })
        toast.success(`Dashboard and backup emailed to ${result.recipient}.`)
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 503) {
          toast.error('Email is not configured on the server.')
        } else if (axios.isAxiosError(err) && err.response?.status === 502) {
          toast.error('Backup was prepared, but sending the email failed. Try again.')
        } else {
          toast.error(extractApiError(err))
        }
      }
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <Table2 className="w-5 h-5 text-brand-400" />
          Tracking — Dashboard
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Read-only quarterly and yearly balance grid across every category, sub-category, and tracking item. No inputs — record balances from Updates.
        </p>
      </div>

      {/* Tracking Set selector + global Summary/Detail toggle */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="tracking-set-select" className="text-xs font-medium text-ink-secondary shrink-0">
          Tracking Set
        </label>
        {setsLoading ? (
          <div className="flex items-center gap-2 text-ink-muted text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sets…
          </div>
        ) : setsError ? (
          <div className="flex items-center gap-2 text-loss text-xs">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to load tracking sets.
          </div>
        ) : sets.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No tracking sets yet — create one from the Category page to get started.
          </p>
        ) : (
          <select
            id="tracking-set-select"
            value={selectedSetId}
            onChange={e => setSelectedSetId(e.target.value)}
            className="input text-sm min-w-[220px]"
          >
            {sets.map(set => (
              <option key={set.id} value={set.id}>{set.name}</option>
            ))}
          </select>
        )}

        {hasYears && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={showDetail}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
              title="Expand every category and sub-category"
            >
              <Maximize2 className="w-3.5 h-3.5" /> Detail
            </button>
            <button
              onClick={showSubCategory}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
              title="Show categories and sub-categories, hide items"
            >
              <ListTree className="w-3.5 h-3.5" /> Sub-category
            </button>
            <button
              onClick={showSummary}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
              title="Collapse every category and sub-category to just their totals"
            >
              <Minimize2 className="w-3.5 h-3.5" /> Summary
            </button>
            <button
              onClick={handleEmailDashboard}
              disabled={sendingEmail}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Email this dashboard view plus a full backup export"
              aria-busy={sendingEmail}
            >
              {sendingEmail
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Mail className="w-3.5 h-3.5" />}
              Email Dashboard
            </button>
          </div>
        )}
      </div>

      {/* Standalone "Original Investment vs Profit" rollup — its own query,
          independent of the balance-grid state machine below. `grid` and
          `chartQuarters` are passed through only to power each covered
          row's lazy per-item expand-charts (Feature 2) — the rollup itself
          stays on its own independent query. */}
      {selectedSetId && (
        <OriginalInvestmentSection setId={selectedSetId} grid={grid} chartQuarters={chartQuarters} />
      )}

      {/* Category trend chart + per-year balance tables (Grand Total now lives
          inside each YearTable — see requirement 3) */}
      {selectedSetId ? (
        gridLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading balance grid…
          </div>
        ) : gridError || !grid ? (
          <div className="flex items-center justify-center py-16 gap-2 text-loss text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load the balance grid.
          </div>
        ) : !hasYears ? (
          <div className="py-12 text-center text-ink-muted text-sm card">
            No quarterly data yet for this tracking set. Record a balance update with a quarter and year set (from Updates) to see it here.
          </div>
        ) : (
          <>
            {/* Renders exactly once per page load — full chronological
                history, unaffected by any Detail/Sub-category/Summary/year
                collapse toggle below. Two side-by-side charts: LEFT =
                "Category Breakdown" (balance stacked bars + the two
                aggregate overlay lines — unchanged, moved here from the
                RIGHT slot), RIGHT = "Category Delta Trend" (redefined from a
                per-category balance line chart into a signed, diverging
                delta stacked bar chart — see `CategoryDeltaChart`'s
                docstring) — both share the SAME `chartQuarters` array
                computed above so their x-axis ranges can never drift apart. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CategoryStackedBarChart
                quarters={chartQuarters}
                categories={grid.categories}
                grandTotal={grid.grandTotal}
                nonPropertyTotal={grid.propertyBreakdown.nonPropertyTotal}
              />
              <CategoryDeltaChart
                quarters={chartQuarters}
                categories={grid.categories}
                grandTotal={grid.grandTotal}
              />
            </div>

            {/* One independently collapsible table per year. Grand Total +
                Property/Non-Property breakdown now render as that table's
                own first rows (see YearTable / GrandTotalRows) — always
                visible regardless of that year's Category/SubCategory
                collapse state. */}
            {grid.years.map((yearCol, yearIdx) => (
              <YearTable
                key={yearCol.year}
                yearCol={yearCol}
                yearIdx={yearIdx}
                categories={grid.categories}
                collapsed={collapsedYears.has(yearCol.year)}
                onToggleCollapsed={() => collapsedYears.toggle(yearCol.year)}
                collapsedCategories={collapsedCategories}
                collapsedSubCategories={collapsedSubCategories}
                grandTotal={grid.grandTotal}
                propertyTotal={grid.propertyBreakdown.propertyTotal}
                nonPropertyTotal={grid.propertyBreakdown.nonPropertyTotal}
                colWidths={colWidths}
                target={target}
                currentNonProperty={currentNonProperty}
                onTargetChange={handleTargetChange}
              />
            ))}
          </>
        )
      ) : !setsLoading && sets.length === 0 ? (
        <div className="py-12 text-center text-ink-muted text-sm card">
          Create a tracking set on the Category page before viewing the dashboard.
        </div>
      ) : null}
    </div>
  )
}
