'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Table2, Loader2, AlertCircle, ChevronDown, ChevronRight, Layers, ListTree,
  Maximize2, Minimize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  trackingService,
  type BalanceCell,
  type DashboardBalanceGridOut,
} from '@/services/tracking'

// ── Formatting helpers ───────────────────────────────────────────────────────
// Mirrors the exact conventions established in
// tracking/updates/[listId]/page.tsx (fmtAmount / fmtPercent /
// toFiniteOrNull) so the Delta column reads identically across both pages.
// Duplicated locally (not imported) because that file's helpers are
// intentionally NOT exported — Next.js App Router statically rejects any
// named export from a page.tsx module other than the specific ones it
// recognizes (default, metadata, generateStaticParams, ...).

/** Formats a signed numeric value with 2 decimals, e.g. "+200.00" / "-50.00". */
const fmtAmount = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2)

/** Formats a signed percentage with 2 decimals, e.g. "+20.00%" / "-4.50%". */
const fmtPercent = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

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

// ── Collapse/expand state ────────────────────────────────────────────────────
//
// This page needs a per-node keyed boolean toggle (collapse/expand by id or
// by year, for both row-groups AND column-groups) — a different shape from
// `useExpandableList` (which implements "show latest N of a flat list,
// expand for the rest", used by the Action Plan page's tables). Rather than
// force-fit that hook, this is a small generic `Set`-keyed toggle helper,
// local to this page: it tracks which ids are COLLAPSED (default: none,
// i.e. everything expanded — matching the reference spreadsheet's default
// fully-expanded view).
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

// ── Grid cells ───────────────────────────────────────────────────────────────

function BalanceTd({ cell, strong, grand }: { cell: BalanceCell; strong?: boolean; grand?: boolean }) {
  const balance = toFiniteOrNull(cell.balance)
  return (
    <td className={cn('px-2 py-1.5 text-right font-mono whitespace-nowrap', grand ? 'text-sm' : 'text-xs')}>
      {!cell.hasData || balance === null ? (
        <span className="text-ink-disabled text-[11px]">—</span>
      ) : (
        <span className={cn(
          grand ? 'font-bold text-brand-400' : strong ? 'font-semibold text-ink-primary' : 'text-ink-secondary',
        )}>
          {balance.toFixed(2)}
        </span>
      )}
    </td>
  )
}

function DeltaTd({ cell }: { cell: BalanceCell }) {
  if (!cell.hasPreviousData) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span className="text-ink-disabled text-[10px]">No prior data</span>
      </td>
    )
  }
  const amount = toFiniteOrNull(cell.deltaAmount)
  if (amount === null) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span className="text-ink-disabled text-[11px]">—</span>
      </td>
    )
  }
  const percent = toFiniteOrNull(cell.deltaPercent)
  const colorClass = amount >= 0 ? 'text-gain' : 'text-loss'
  return (
    <td className="px-2 py-1.5 text-right whitespace-nowrap">
      <span className="inline-flex items-baseline gap-1">
        <span className={cn('font-mono text-xs font-medium', colorClass)}>{fmtAmount(amount)}</span>
        {percent !== null && (
          <span className="text-[10px] text-ink-muted font-normal">({fmtPercent(percent)})</span>
        )}
      </span>
    </td>
  )
}

/** Renders one Balance+Delta `<td>` pair per visible (non-collapsed-year) column index. */
function GridCells({
  cells, visibleColumnIndices, strong, grand,
}: {
  cells: BalanceCell[]
  visibleColumnIndices: number[]
  strong?: boolean
  grand?: boolean
}) {
  return (
    <>
      {visibleColumnIndices.map(idx => (
        <Fragment key={idx}>
          <BalanceTd cell={cellAt(cells, idx)} strong={strong} grand={grand} />
          <DeltaTd cell={cellAt(cells, idx)} />
        </Fragment>
      ))}
    </>
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

  // Collapse state — everything expanded by default (Detail view), per-node
  // keyed by year (column-groups) or id (Category/SubCategory row-groups).
  const collapsedYears = useToggleSet<number>()
  const collapsedCategories = useToggleSet<string>()
  const collapsedSubCategories = useToggleSet<string>()

  const allCategoryIds = useMemo(() => grid?.categories.map(c => c.id) ?? [], [grid])
  const allSubCategoryIds = useMemo(
    () => grid?.categories.flatMap(c => c.subCategories.map(s => s.id)) ?? [],
    [grid],
  )

  // Global Summary/Detail toggle — bulk-sets every Category+SubCategory's
  // collapse state at once. This is in ADDITION to the independent per-row
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

  // Flattened cell-array indices for every quarter of every NON-collapsed
  // year, in the exact order the backend sent `years` — this page never
  // re-sorts. A collapsed year contributes zero indices, which is what
  // actually shrinks the rendered table (its header cell still renders, as
  // a single narrow re-expand target, via rowSpan — see the <thead> below).
  const visibleColumnIndices = useMemo(() => {
    if (!grid) return []
    const indices: number[] = []
    grid.years.forEach((yearCol, yearIdx) => {
      if (collapsedYears.has(yearCol.year)) return
      for (let q = 0; q < 4; q++) indices.push(yearIdx * 4 + q)
    })
    return indices
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, collapsedYears.set])

  const hasYears = !!grid && grid.years.length > 0

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
              onClick={showSummary}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
              title="Collapse every category and sub-category to just their totals"
            >
              <Minimize2 className="w-3.5 h-3.5" /> Summary
            </button>
          </div>
        )}
      </div>

      {/* Balance grid */}
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
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/50 bg-surface-elevated/30 text-ink-muted">
                    <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-medium align-bottom min-w-[220px]">
                      Item
                    </th>
                    {grid.years.map(yearCol => {
                      const collapsed = collapsedYears.has(yearCol.year)
                      return collapsed ? (
                        <th key={yearCol.year} scope="col" rowSpan={2} className="px-2 py-2 text-center font-semibold border-l border-border/40">
                          <button
                            onClick={() => collapsedYears.toggle(yearCol.year)}
                            aria-label={`Expand ${yearCol.year} columns`}
                            className="flex items-center gap-1 mx-auto text-ink-secondary hover:text-brand-400 transition-colors"
                          >
                            <ChevronRight className="w-3.5 h-3.5" /> {yearCol.year}
                          </button>
                        </th>
                      ) : (
                        <th key={yearCol.year} scope="colgroup" colSpan={8} className="px-2 py-2 text-center font-semibold border-l border-border/40">
                          <button
                            onClick={() => collapsedYears.toggle(yearCol.year)}
                            aria-label={`Collapse ${yearCol.year} columns`}
                            className="flex items-center gap-1 mx-auto text-ink-primary hover:text-brand-400 transition-colors"
                          >
                            <ChevronDown className="w-3.5 h-3.5" /> {yearCol.year}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                  <tr className="border-b border-border/50 bg-surface-elevated/20 text-ink-muted">
                    {grid.years.flatMap(yearCol => {
                      if (collapsedYears.has(yearCol.year)) return []
                      return yearCol.quarters.flatMap(q => [
                        <th key={`${yearCol.year}-q${q}-bal`} scope="col" className="px-2 py-1 text-right font-medium text-[10px]">
                          Q{q}
                        </th>,
                        <th key={`${yearCol.year}-q${q}-delta`} scope="col" className="px-2 py-1 text-right font-medium text-[10px]">
                          Q{q} Δ
                        </th>,
                      ])
                    })}
                  </tr>
                </thead>
                <tbody>
                  {grid.categories.map(cat => {
                    const catCollapsed = collapsedCategories.has(cat.id)
                    return (
                      <Fragment key={cat.id}>
                        {/* Category row doubles as its subtotal row — always visible,
                            even when collapsed, so the rollup stays useful. */}
                        <tr className="bg-surface-elevated/40 border-y border-border/50">
                          <td className="px-3 py-2">
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
                          <GridCells cells={cat.subtotal} visibleColumnIndices={visibleColumnIndices} strong />
                        </tr>

                        {!catCollapsed && cat.subCategories.map(sub => {
                          const subCollapsed = collapsedSubCategories.has(sub.id)
                          return (
                            <Fragment key={sub.id}>
                              {/* SubCategory row doubles as its subtotal row — same idea one level down. */}
                              <tr className="bg-surface-elevated/20 border-b border-border/40">
                                <td className="px-3 py-1.5 pl-8">
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
                                <GridCells cells={sub.subtotal} visibleColumnIndices={visibleColumnIndices} strong />
                              </tr>

                              {!subCollapsed && sub.items.map(item => (
                                <tr key={item.id} className="border-b border-border/20 hover:bg-surface-elevated/50 transition-colors">
                                  <td
                                    className="px-3 py-1.5 pl-14 text-ink-primary overflow-hidden text-ellipsis whitespace-nowrap max-w-[240px]"
                                    title={item.name}
                                  >
                                    {item.name}
                                    {item.exclusive && (
                                      <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                        Excl.
                                      </span>
                                    )}
                                  </td>
                                  <GridCells cells={item.cells} visibleColumnIndices={visibleColumnIndices} />
                                </tr>
                              ))}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )
                  })}

                  {/* Grand Total — most prominent styling on the page. */}
                  <tr className="bg-brand-500/10 border-t-2 border-brand-500/30">
                    <td className="px-3 py-2.5 font-bold text-brand-400 text-sm">
                      Grand Total
                    </td>
                    <GridCells cells={grid.grandTotal} visibleColumnIndices={visibleColumnIndices} grand />
                  </tr>

                  {/* Property breakdown — secondary summary rows, visually subdued relative to Grand Total. */}
                  <tr className="border-b border-border/20">
                    <td className="px-3 py-1.5 pl-6 text-ink-muted text-[11px]">Property Total</td>
                    <GridCells cells={grid.propertyBreakdown.propertyTotal} visibleColumnIndices={visibleColumnIndices} />
                  </tr>
                  <tr className="border-b border-border/20">
                    <td className="px-3 py-1.5 pl-6 text-ink-muted text-[11px]">Non-Property Total</td>
                    <GridCells cells={grid.propertyBreakdown.nonPropertyTotal} visibleColumnIndices={visibleColumnIndices} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : !setsLoading && sets.length === 0 ? (
        <div className="py-12 text-center text-ink-muted text-sm card">
          Create a tracking set on the Category page before viewing the dashboard.
        </div>
      ) : null}
    </div>
  )
}
