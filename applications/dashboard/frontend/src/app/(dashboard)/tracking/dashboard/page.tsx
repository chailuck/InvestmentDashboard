'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  Table2, Loader2, AlertCircle, ChevronDown, ChevronRight, Layers, ListTree,
  Maximize2, Minimize2, LineChart, BarChart3, Target, Pencil, Mail,
} from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { extractApiError } from '@/services/api'
import {
  trackingService,
  type BalanceCell,
  type DashboardBalanceGridOut,
  type DashboardCategoryRow,
  type DashboardYearColumn,
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

// ── Category trend chart (requirement 4) ────────────────────────────────────
//
// Hand-rolled inline SVG line chart — the SAME mechanism as the only other
// chart in this codebase (analytics/daily-performance/page.tsx): a `useMemo`
// -built `ChartData`-equivalent, `xOf`/`yOf` scale functions, a manual path
// builder, y-axis gridlines+ticks, x-axis labels thinned via `labelStep`, a
// legend row, and a hover-tracking tooltip via `onMouseMove`. No chart
// library is introduced (none exists in this codebase's package.json).
//
// Renders exactly ONCE per page load — one line per Category (from
// `subtotal`, already summed-per-category-per-quarter) plus one Grand Total
// line — across the FULL chronological range of quarters, unaffected by the
// Detail/Sub-category/Summary/year-collapse toggles.

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
 * One x-axis tick, shared verbatim between `CategoryLinesChart` and
 * `CategoryStackedBarChart` (Gate 2: ONE `quarters` array computed once at
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
 * LEFT chart (Gate 1 requirement 2 / Gate 2) — category trend lines +
 * Grand Total line ONLY, no bars. Its y-domain is fully independent of the
 * RIGHT chart's stacked-bar y-domain (Gate 2), computed solely from this
 * chart's own line values, exactly as the pre-split combined chart's
 * line-only domain logic already worked.
 */
function CategoryLinesChart({
  quarters, categories, grandTotal,
}: {
  quarters: ChartQuarter[]
  categories: DashboardCategoryRow[]
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

    // Stack order is MANDATORY and explicit — sorted by `orderIndex`
    // ascending, never just the array order the API happens to send (even
    // though the backend currently already sends categories pre-sorted by
    // order_index, this must not be relied on implicitly). This exact
    // sorted order drives line color assignment and the legend, and is kept
    // identical to the RIGHT chart's own sort so a category's color/position
    // never differs between the two charts.
    const sortedCategories = [...categories].sort((a, b) => a.orderIndex - b.orderIndex)

    const seriesDefs = [
      ...sortedCategories.map((cat, i) => ({
        id: cat.id,
        label: cat.name,
        color: CATEGORY_LINE_COLORS[i % CATEGORY_LINE_COLORS.length],
        dashed: false,
        strokeWidth: 1.5,
        cells: cat.subtotal,
      })),
      {
        id: '__grand-total__',
        label: 'Grand Total',
        color: GRAND_TOTAL_LINE_COLOR,
        dashed: true,
        strokeWidth: 2.5,
        cells: grandTotal,
      },
    ]

    // Raw per-quarter values, `null` for any quarter without data — never a
    // fabricated 0, matching this codebase's established convention.
    const rawSeries = seriesDefs.map(def => ({
      ...def,
      values: quarters.map(q => {
        const cell = def.cells[q.cellIdx]
        if (!cell || !cell.hasData) return null
        return toFiniteOrNull(cell.balance)
      }),
    }))

    const allValues = rawSeries.flatMap(s => s.values.filter((v): v is number => v !== null))
    const dataMin = Math.min(0, ...(allValues.length ? allValues : [0]))
    const dataMax = allValues.length ? Math.max(...allValues) : 1
    const range = Math.max(dataMax - dataMin, 1)
    const yMin = dataMin - range * 0.05
    const yMax = dataMax + range * 0.1
    const yRange = Math.max(yMax - yMin, 1)

    const yOf = (v: number): number => TREND_CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    const seriesPoints: TrendSeries[] = rawSeries.map(s => ({
      id: s.id,
      label: s.label,
      color: s.color,
      dashed: s.dashed,
      strokeWidth: s.strokeWidth,
      points: s.values.map((v, i) => ({ x: xOf(i), y: v === null ? null : yOf(v), value: v })),
    }))

    const yTicks = computeYTicks(yMin, yRange)
    const xLabelIdxs = computeXLabelIdxs(quarters.length)

    return { innerW, innerH, xOf, yOf, seriesPoints, yTicks, xLabelIdxs }
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
          <LineChart className="w-4 h-4 text-brand-400" /> Category Trend
        </h2>
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap" role="list" aria-label="Category trend chart legend">
          {chartData.seriesPoints.map(s => (
            <span key={s.id} className="flex items-center gap-1.5" role="listitem">
              <span
                className="inline-block w-3 rounded-full"
                style={{ height: s.dashed ? '3px' : '2px', backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className={cn(s.dashed && 'font-semibold text-ink-primary')}>{s.label}</span>
            </span>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${TREND_CHART_H}px` }}
        role="img"
        aria-label="Category trend lines chart"
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
          {chartData.seriesPoints.map(s => (
            <path
              key={s.id}
              data-testid={`chart-line-${s.id}`}
              d={buildLinePathWithGaps(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeDasharray={s.dashed ? '6,3' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hoverIdx !== null && (() => {
            const tooltipW = 190
            const tooltipH = 20 + chartData.seriesPoints.length * 16
            const px = chartData.xOf(hoverIdx)
            const tooltipX = clampTooltipX(px, tooltipW, containerWidth)
            const tooltipY = TREND_CHART_PAD.top + 2
            return (
              <g>
                <line x1={px} y1={TREND_CHART_PAD.top} x2={px} y2={TREND_CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                {chartData.seriesPoints.map(s => {
                  const pt = s.points[hoverIdx]
                  if (pt.y === null) return null
                  return <circle key={s.id} cx={pt.x} cy={pt.y} r={3.5} fill={s.color} />
                })}
                <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{quarters[hoverIdx].label}</text>
                {chartData.seriesPoints.map((s, i) => {
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
 * RIGHT chart (Gate 1 requirements 2+3 / Gate 2) — the stacked bars ONLY,
 * plus two aggregate overlay lines read directly from their own data
 * (Non-Property Total, Grand Total) — never derived from bar segment
 * geometry. Its y-domain fits all THREE of: the stacked category total, the
 * Grand Total line, and the Non-Property Total line (Gate 2) — none of the
 * three is guaranteed by the data model to bound the other two.
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TrackingDashboardPage() {
  const [selectedSetId, setSelectedSetId] = useState<string>('')

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
  // a prop to BOTH `CategoryLinesChart` and `CategoryStackedBarChart` — so
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
      const html = buildDashboardEmailHtml(grid, {
        collapsedYears: collapsedYears.set,
        collapsedCategories: collapsedCategories.set,
        collapsedSubCategories: collapsedSubCategories.set,
      })

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
                collapse toggle below. Split into two side-by-side charts
                (Gate 1 requirement 2): LEFT = category trend lines, RIGHT =
                stacked bars + the two aggregate overlay lines — both share
                the SAME `chartQuarters` array computed above so their x-axis
                ranges can never drift apart. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CategoryLinesChart
                quarters={chartQuarters}
                categories={grid.categories}
                grandTotal={grid.grandTotal}
              />
              <CategoryStackedBarChart
                quarters={chartQuarters}
                categories={grid.categories}
                grandTotal={grid.grandTotal}
                nonPropertyTotal={grid.propertyBreakdown.nonPropertyTotal}
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
