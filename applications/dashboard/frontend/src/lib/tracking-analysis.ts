/**
 * Pure derivations for the Financial Tracker "Analysis" view
 * (ANALYSIS-DESIGN.html §4.6 + §4.9.4 + ADR-019).
 *
 * NO React, NO I/O — every function transforms an already-fetched
 * `DashboardBalanceGridOut` (plus a `ViewState`) into view-model data. The
 * authoritative delta math lives on the server (`compute_series_deltas` in
 * `tracking-backend/app/services/dashboard_balance_grid.py`); this module
 * replicates it byte-for-byte ONLY for derived series that have no
 * server-provided row (lens-filtered subtotals, item-type buckets, yearly
 * as-of deltas, Scoped Dashboard derived totals). A golden-fixture parity
 * test locks the replica against the server output.
 */

import type {
  BalanceCell,
  DashboardBalanceGridOut,
  DashboardCategoryRow,
  DashboardItemRow,
  DashboardSubCategoryRow,
} from '@/services/tracking'
import { TRACKING_ITEM_TYPES } from '@/services/tracking'
import { toFiniteOrNull } from './tracking-format'
import type {
  AnalysisSeries,
  AxisPoint,
  ComparisonConfig,
  DrillDepth,
  DrillPath,
  Granularity,
  GroupByDim,
  Lens,
  PeriodRef,
  SeriesKind,
  ViewState,
} from '@/app/(dashboard)/tracking/analysis/types'

// ── Constants ──────────────────────────────────────────────────────────────

/** Categorical palette — fixed order, modulo-wrapped (§4.5). A bucket keeps
 *  its colour across all four charts of a view. */
export const CATEGORICAL_PALETTE = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
] as const

/** Lens / scope-total overlay line — never a categorical slot (§4.5). */
export const AGGREGATE_COLOR = '#E2E8F0'

/** Muted "Other" rollup band colour. */
export const OTHER_COLOR = '#64748B'

/** Readability cap: at most this many categorical buckets before the rest roll into "Other". */
export const MAX_BUCKETS = 8

const BLANK_CELL: BalanceCell = {
  year: 0, quarter: 0, balance: null, deltaAmount: null, deltaPercent: null,
  hasData: false, hasPreviousData: false,
}

// ── Numeric coercion ───────────────────────────────────────────────────────

/** Re-exported from `tracking-format` — single source of truth for numeric coercion. */
export { toFiniteOrNull }

// ── Period axis ────────────────────────────────────────────────────────────

export interface QuarterPoint {
  year: number
  quarter: 1 | 2 | 3 | 4
  /** ascending chronological index (0-based) */
  index: number
}

/**
 * §4.6 — reverse `grid.years` (descending) to ascending and cross-join with
 * quarters [1,2,3,4]. Length is always `years.length * 4`.
 */
export function periodsAsc(grid: DashboardBalanceGridOut): QuarterPoint[] {
  const ascYears = [...grid.years].reverse()
  const out: QuarterPoint[] = []
  let index = 0
  for (const yc of ascYears) {
    for (const q of [1, 2, 3, 4] as const) {
      out.push({ year: yc.year, quarter: q, index })
      index++
    }
  }
  return out
}

/**
 * §4.6 — cells are aligned to `years` DESCENDING × [1..4] ascending, so
 * `index = yearPosDesc * 4 + (quarter - 1)`. Returns -1 for an unknown year.
 */
export function cellIndex(grid: DashboardBalanceGridOut, year: number, quarter: number): number {
  const yearPosDesc = grid.years.findIndex(y => y.year === year)
  if (yearPosDesc < 0) return -1
  return yearPosDesc * 4 + (quarter - 1)
}

export interface CellSeries {
  /** ascending, aligned to `periodsAsc` */
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  hasData: boolean[]
  hasPreviousData: boolean[]
}

/** Reads a positionally-aligned `BalanceCell[]` into ascending-order arrays. */
export function readCellSeries(grid: DashboardBalanceGridOut, cells: readonly BalanceCell[]): CellSeries {
  const axis = periodsAsc(grid)
  const s: CellSeries = { balance: [], deltaAmount: [], deltaPercent: [], hasData: [], hasPreviousData: [] }
  for (const p of axis) {
    const idx = cellIndex(grid, p.year, p.quarter)
    const c = cells[idx] ?? BLANK_CELL
    s.balance.push(c.hasData ? toFiniteOrNull(c.balance) : null)
    s.deltaAmount.push(toFiniteOrNull(c.deltaAmount))
    s.deltaPercent.push(toFiniteOrNull(c.deltaPercent))
    s.hasData.push(!!c.hasData)
    s.hasPreviousData.push(!!c.hasPreviousData)
  }
  return s
}

// ── Delta engine — TS replica of `compute_series_deltas` ───────────────────

export interface SeriesDeltas {
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  hasPreviousData: boolean[]
}

/**
 * §4.6 — replicates the server engine EXACTLY:
 *  - a blank slot (`null`) → null deltas; `lastSeen` is NOT advanced.
 *  - first populated slot → deltas are `null` (never 0).
 *  - `deltaPercent` is `null` ONLY when the prior populated value is exactly 0
 *    (no epsilon, no magnitude cap).
 *  - year boundaries are crossed freely (the caller's axis already spans them).
 */
export function computeSeriesDeltas(balances: readonly (number | null)[]): SeriesDeltas {
  const deltaAmount: (number | null)[] = []
  const deltaPercent: (number | null)[] = []
  const hasPreviousData: boolean[] = []
  let lastSeen: number | null = null
  for (const v of balances) {
    if (v === null) {
      deltaAmount.push(null)
      deltaPercent.push(null)
      hasPreviousData.push(false) // matches server `_BLANK_CELL_MATH`
      continue
    }
    const hadPrev = lastSeen !== null
    hasPreviousData.push(hadPrev)
    if (lastSeen === null) {
      deltaAmount.push(null)
      deltaPercent.push(null)
    } else {
      const da = v - lastSeen
      deltaAmount.push(da)
      deltaPercent.push(lastSeen === 0 ? null : (da / lastSeen) * 100)
    }
    lastSeen = v
  }
  return { deltaAmount, deltaPercent, hasPreviousData }
}

/**
 * §4.6 / server `_rollup_values` — per period, sum the populated values across
 * the given item balance arrays ("at least one populated" rule); a period with
 * zero contributing items stays `null` (blank), never 0.
 */
export function rollupBalances(itemBalances: readonly (number | null)[][], length: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < length; i++) {
    let total: number | null = null
    for (const arr of itemBalances) {
      const v = arr[i]
      if (v !== null && v !== undefined) total = total === null ? v : total + v
    }
    out.push(total)
  }
  return out
}

// ── Lens membership ────────────────────────────────────────────────────────

export interface LensItemLike {
  type: string
  exclusive: boolean
}

/** §4.4 — a group-by bucket produces a series only if ≥ 1 descendant item passes this. */
export function lensIncludes(lens: Lens, item: LensItemLike): boolean {
  if (item.exclusive) return false
  if (lens === 'grandTotal') return true
  if (lens === 'property') return item.type === 'Property'
  return item.type !== 'Property'
}

export function lensLabel(lens: Lens): string {
  return lens === 'grandTotal' ? 'Grand Total' : lens === 'property' ? 'Property' : 'No Property'
}

export function lensAggregateCells(grid: DashboardBalanceGridOut, lens: Lens): BalanceCell[] {
  if (lens === 'property') return grid.propertyBreakdown.propertyTotal
  if (lens === 'nonProperty') return grid.propertyBreakdown.nonPropertyTotal
  return grid.grandTotal
}

// ── Hierarchy navigation ───────────────────────────────────────────────────

export function drillDepth(drill: DrillPath): DrillDepth {
  if (drill.itemId) return 3
  if (drill.subCategoryId) return 2
  if (drill.categoryId) return 1
  return 0
}

export function findCategory(grid: DashboardBalanceGridOut, id?: string): DashboardCategoryRow | undefined {
  return id ? grid.categories.find(c => c.id === id) : undefined
}

export function findSubCategory(
  grid: DashboardBalanceGridOut,
  categoryId?: string,
  subCategoryId?: string,
): DashboardSubCategoryRow | undefined {
  const cat = findCategory(grid, categoryId)
  if (!cat || !subCategoryId) return undefined
  return cat.subCategories.find(s => s.id === subCategoryId)
}

export interface LocatedItem {
  item: DashboardItemRow
  category: DashboardCategoryRow
  subCategory: DashboardSubCategoryRow
}

export function locateItem(grid: DashboardBalanceGridOut, itemId?: string): LocatedItem | undefined {
  if (!itemId) return undefined
  for (const category of grid.categories) {
    for (const subCategory of category.subCategories) {
      const item = subCategory.items.find(i => i.id === itemId)
      if (item) return { item, category, subCategory }
    }
  }
  return undefined
}

export function itemsUnderCategory(cat: DashboardCategoryRow): DashboardItemRow[] {
  return cat.subCategories.flatMap(s => s.items)
}

export function subtreeItems(grid: DashboardBalanceGridOut, drill: DrillPath): DashboardItemRow[] {
  const depth = drillDepth(drill)
  if (depth === 0) return grid.categories.flatMap(itemsUnderCategory)
  if (depth === 1) return itemsUnderCategory(findCategory(grid, drill.categoryId) ?? emptyCat())
  if (depth === 2) return (findSubCategory(grid, drill.categoryId, drill.subCategoryId)?.items) ?? []
  const li = locateItem(grid, drill.itemId)
  return li ? [li.item] : []
}

function emptyCat(): DashboardCategoryRow {
  return { id: '', name: '', orderIndex: 0, subCategories: [], subtotal: [] }
}

// ── Group-by defaults (§4.4 depth ↔ group-by table) ────────────────────────

export function defaultGroupBy(depth: DrillDepth): GroupByDim {
  return depth === 0 ? 'category' : depth === 1 ? 'subCategory' : 'item'
}

export function allowedGroupBy(depth: DrillDepth): GroupByDim[] {
  if (depth === 0) return ['category', 'itemType']
  if (depth === 1) return ['subCategory', 'itemType']
  if (depth === 2) return ['item', 'itemType']
  return []
}

// ── Node total series (scope-aware; §4.6 periodTotal + StatRow SD-OQ-1) ─────

/**
 * The authoritative balance series for the CURRENT drill node, under the
 * current lens. Used as the trend overlay, the composition `periodTotal`, and
 * the scope-aware StatRow source.
 *  depth 0 → the lens aggregate array (verbatim server row).
 *  depth 1/2 → GT lens: `subtotal[]` verbatim; else derived Σ of lens-qualifying
 *              non-exclusive leaf descendants.
 *  depth 3 → the item's own `cells[]`.
 */
export function nodeTotalSeries(grid: DashboardBalanceGridOut, drill: DrillPath): {
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  serverBacked: boolean
} {
  const depth = drillDepth(drill)
  const lens = drill.lens
  const axisLen = periodsAsc(grid).length

  if (depth === 0) {
    const cs = readCellSeries(grid, lensAggregateCells(grid, lens))
    return { balance: cs.balance, deltaAmount: cs.deltaAmount, deltaPercent: cs.deltaPercent, serverBacked: true }
  }

  if (depth === 3) {
    const li = locateItem(grid, drill.itemId)
    const cs = readCellSeries(grid, li ? li.item.cells : [])
    return { balance: cs.balance, deltaAmount: cs.deltaAmount, deltaPercent: cs.deltaPercent, serverBacked: true }
  }

  // depth 1 / 2
  if (lens === 'grandTotal') {
    const subtotal = depth === 1
      ? (findCategory(grid, drill.categoryId)?.subtotal ?? [])
      : (findSubCategory(grid, drill.categoryId, drill.subCategoryId)?.subtotal ?? [])
    const cs = readCellSeries(grid, subtotal)
    return { balance: cs.balance, deltaAmount: cs.deltaAmount, deltaPercent: cs.deltaPercent, serverBacked: true }
  }

  const items = subtreeItems(grid, drill).filter(it => lensIncludes(lens, it))
  const balances = rollupBalances(items.map(it => readCellSeries(grid, it.cells).balance), axisLen)
  const d = computeSeriesDeltas(balances)
  return { balance: balances, deltaAmount: d.deltaAmount, deltaPercent: d.deltaPercent, serverBacked: false }
}

// ── Yearly "as-of year end" rollup (ADR-019 #2 / §4.9.4) ───────────────────

export interface YearlyPoint {
  year: number
  index: number
  value: number | null
  /** which quarter supplied `value` — shown in every yearly label. */
  asOfQuarter: 1 | 2 | 3 | 4 | null
}

/**
 * Per year, pick the highest-index quarter that has data (Q4 → Q3 → Q2 → Q1);
 * `null` if the year has no populated quarter. `balances` must be aligned to
 * `axis` (ascending `periodsAsc` output).
 */
export function asOfYearlySeries(
  balances: readonly (number | null)[],
  axis: readonly QuarterPoint[],
): YearlyPoint[] {
  const byYear = new Map<number, QuarterPoint[]>()
  for (const p of axis) {
    const list = byYear.get(p.year) ?? []
    list.push(p)
    byYear.set(p.year, list)
  }
  const years = [...byYear.keys()].sort((a, b) => a - b)
  return years.map((year, index) => {
    const pts = [...(byYear.get(year) ?? [])].sort((a, b) => a.quarter - b.quarter)
    let value: number | null = null
    let asOfQuarter: 1 | 2 | 3 | 4 | null = null
    for (const p of pts) {
      const v = balances[p.index] ?? null
      if (v !== null) {
        value = v
        asOfQuarter = p.quarter
      }
    }
    return { year, index, value, asOfQuarter }
  })
}

// ── Trim leading / trailing all-empty periods (§4.6) ───────────────────────

export interface TrimWindow {
  /** inclusive start index; `start > end` ⇒ every period is empty. */
  start: number
  end: number
}

/**
 * Drops leading and trailing periods where `isEmptyAt(i)` for every index —
 * the exact rule the dashboard chart uses (`buildLinePathWithGaps` handles
 * interior gaps; this only removes the unstarted prefix / suffix).
 */
export function trimEmptyEnds(length: number, isEmptyAt: (i: number) => boolean): TrimWindow {
  let start = 0
  while (start < length && isEmptyAt(start)) start++
  let end = length - 1
  while (end >= start && isEmptyAt(end)) end--
  return { start, end }
}

// ── Composition shares (§4.5b / §4.6) ─────────────────────────────────────

export interface CompositionResult {
  /** share[bucketIdx][periodIdx] as a 0–100 percentage; `null` for a blank period. */
  sharePercent: (number | null)[][]
  /** absolute[bucketIdx][periodIdx] currency value; `null` for a blank period. */
  absolute: (number | null)[][]
}

/**
 * `share(bucket, p) = bucketBalance / periodTotal` when `periodTotal` is
 * non-null and > 0, else the period renders blank. A null bucket in a valid
 * period contributes 0 (band pinches). Shares are rounded to 0.1%; the last
 * band with a value absorbs the residual so a period's bands sum to exactly
 * 100.0.
 */
export function computeComposition(
  bucketBalances: readonly (number | null)[][],
  periodTotal: readonly (number | null)[],
): CompositionResult {
  const nBuckets = bucketBalances.length
  const nPeriods = periodTotal.length
  const sharePercent: (number | null)[][] = Array.from({ length: nBuckets }, () => [])
  const absolute: (number | null)[][] = Array.from({ length: nBuckets }, () => [])

  for (let p = 0; p < nPeriods; p++) {
    const total = periodTotal[p]
    if (total === null || total === undefined || total <= 0) {
      for (let b = 0; b < nBuckets; b++) {
        sharePercent[b].push(null)
        absolute[b].push(null)
      }
      continue
    }
    const rounded: number[] = []
    let lastWithValue = -1
    for (let b = 0; b < nBuckets; b++) {
      const raw = bucketBalances[b][p]
      const val = raw ?? 0
      absolute[b].push(raw ?? null)
      const pct = Math.round(((val / total) * 100) * 10) / 10
      rounded.push(pct)
      if (raw !== null && raw !== undefined) lastWithValue = b
    }
    if (lastWithValue >= 0) {
      const sum = rounded.reduce((a, v) => a + v, 0)
      rounded[lastWithValue] = Math.round((rounded[lastWithValue] + (100 - sum)) * 10) / 10
    }
    for (let b = 0; b < nBuckets; b++) sharePercent[b].push(rounded[b])
  }
  return { sharePercent, absolute }
}

// ── "Other" rollup (§4.5b readability guard) ──────────────────────────────

export interface RawBucket {
  id: string
  label: string
  kind: 'category' | 'subCategory' | 'item' | 'itemType'
  drillId: string | null
  orderIndex: number
  balance: (number | null)[]
}

/**
 * Keeps the top `MAX_BUCKETS - 1` buckets by peak populated balance and folds
 * the remainder into a single muted, non-drillable "Other (n)" bucket. With
 * `MAX_BUCKETS` or fewer buckets the input is returned unchanged (still sorted
 * by `orderIndex` for a stable stack order).
 */
export function rollupOther(buckets: RawBucket[]): RawBucket[] {
  const byOrder = [...buckets].sort((a, b) => a.orderIndex - b.orderIndex)
  if (byOrder.length <= MAX_BUCKETS) return byOrder

  const peak = (b: RawBucket) =>
    b.balance.reduce<number>((m, v) => (v !== null && v > m ? v : m), Number.NEGATIVE_INFINITY)
  const ranked = [...byOrder].sort((a, b) => peak(b) - peak(a))
  const keep = new Set(ranked.slice(0, MAX_BUCKETS - 1).map(b => b.id))

  const kept = byOrder.filter(b => keep.has(b.id))
  const folded = byOrder.filter(b => !keep.has(b.id))
  const length = buckets[0]?.balance.length ?? 0
  const otherBalance = rollupBalances(folded.map(b => b.balance), length)
  kept.push({
    id: '__other__',
    label: `Other (${folded.length})`,
    kind: folded[0]?.kind ?? 'category',
    drillId: null,
    orderIndex: Number.MAX_SAFE_INTEGER,
    balance: otherBalance,
  })
  return kept
}

// ── Axis label helpers ────────────────────────────────────────────────────

export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`
}

export function buildQuarterAxis(points: QuarterPoint[]): AxisPoint[] {
  return points.map((p, i) => ({
    index: i,
    label: quarterLabel(p.year, p.quarter),
    year: p.year,
    quarter: p.quarter,
    asOfQuarter: null,
    asOfLabel: null,
  }))
}

export function buildYearlyAxis(points: YearlyPoint[]): AxisPoint[] {
  return points.map((p, i) => ({
    index: i,
    label: `${p.year}`,
    year: p.year,
    quarter: null,
    asOfQuarter: p.asOfQuarter,
    asOfLabel: p.asOfQuarter ? `as of ${quarterLabel(p.year, p.asOfQuarter)}` : null,
  }))
}

// ── Period ref helpers ────────────────────────────────────────────────────

export function periodRefLabel(ref: PeriodRef): string {
  return ref.kind === 'year' ? `${ref.year}` : quarterLabel(ref.year, ref.quarter)
}

export function samePeriodRef(a: PeriodRef | undefined, b: PeriodRef | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'year' && b.kind === 'year') return a.year === b.year
  if (a.kind === 'quarter' && b.kind === 'quarter') return a.year === b.year && a.quarter === b.quarter
  return false
}

// ── URL (de)serialisation of ViewState (flat query params) ─────────────────

const LENSES: Lens[] = ['grandTotal', 'property', 'nonProperty']
const GRANS: Granularity[] = ['quarterly', 'yearly']
const MEASURES: ViewState['measure'][] = ['balance', 'deltaAmount', 'deltaPercent']
const GROUPBYS: GroupByDim[] = ['category', 'subCategory', 'item', 'itemType']
const DELTA_MODES: ViewState['deltaMode'][] = ['bars', 'waterfall']
const CMP_MODES: ComparisonConfig['mode'][] = ['off', 'qoq', 'yoy', 'custom']

function oneOf<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value !== null && (allowed as string[]).includes(value) ? (value as T) : fallback
}

function parsePeriodRef(raw: string | null): PeriodRef | undefined {
  if (!raw) return undefined
  const m = /^(\d{4})(?:Q([1-4]))?$/.exec(raw.trim())
  if (!m) return undefined
  const year = Number(m[1])
  if (!Number.isFinite(year)) return undefined
  if (m[2]) return { kind: 'quarter', year, quarter: Number(m[2]) as 1 | 2 | 3 | 4 }
  return { kind: 'year', year }
}

function serialisePeriodRef(ref: PeriodRef | undefined): string | undefined {
  if (!ref) return undefined
  return ref.kind === 'year' ? `${ref.year}` : `${ref.year}Q${ref.quarter}`
}

export function defaultViewState(trackingSetId: string): ViewState {
  return {
    trackingSetId,
    lens: 'grandTotal',
    granularity: 'quarterly',
    measure: 'balance',
    groupBy: 'category',
    drill: { lens: 'grandTotal' },
    deltaMode: 'bars',
    comparison: { mode: 'off' },
  }
}

/**
 * Hydrates a `ViewState` from URL query params, clamping / rejecting any bad
 * value back to the default (NFR-3 input validation). `groupBy` is forced to
 * an allowed value for the hydrated drill depth.
 */
export function queryToViewState(params: URLSearchParams, trackingSetId: string): ViewState {
  const base = defaultViewState(trackingSetId)
  const lens = oneOf(params.get('lens'), LENSES, base.lens)

  const drill: DrillPath = { lens }
  const categoryId = params.get('cat') || undefined
  const subCategoryId = params.get('sub') || undefined
  const itemId = params.get('item') || undefined
  if (categoryId) {
    drill.categoryId = categoryId
    if (subCategoryId) {
      drill.subCategoryId = subCategoryId
      if (itemId) drill.itemId = itemId
    }
  }
  const depth = drillDepth(drill)

  let groupBy = oneOf(params.get('groupBy'), GROUPBYS, defaultGroupBy(depth))
  if (depth === 3 || !allowedGroupBy(depth).includes(groupBy)) {
    groupBy = depth === 3 ? 'item' : defaultGroupBy(depth)
  }

  const cmpMode = oneOf(params.get('cmp'), CMP_MODES, 'off')
  const comparison: ComparisonConfig = { mode: cmpMode }
  if (cmpMode === 'custom') {
    comparison.periodA = parsePeriodRef(params.get('cmpA'))
    comparison.periodB = parsePeriodRef(params.get('cmpB'))
  }

  const collapsedRaw = params.get('scoped')
  const scopedDashboardCollapsed =
    collapsedRaw === '0' ? true : collapsedRaw === '1' ? false : undefined

  return {
    trackingSetId,
    lens,
    granularity: oneOf(params.get('g'), GRANS, base.granularity),
    measure: oneOf(params.get('m'), MEASURES, base.measure),
    groupBy,
    drill,
    snapshotPeriod: parsePeriodRef(params.get('snap')),
    deltaMode: oneOf(params.get('delta'), DELTA_MODES, base.deltaMode),
    comparison,
    scopedDashboardCollapsed,
  }
}

/** Serialises a `ViewState` to flat query params (omitting anything at its default). */
export function viewStateToQuery(vs: ViewState): URLSearchParams {
  const p = new URLSearchParams()
  if (vs.lens !== 'grandTotal') p.set('lens', vs.lens)
  if (vs.granularity !== 'quarterly') p.set('g', vs.granularity)
  if (vs.measure !== 'balance') p.set('m', vs.measure)
  const depth = drillDepth(vs.drill)
  if (vs.groupBy !== defaultGroupBy(depth) && depth !== 3) p.set('groupBy', vs.groupBy)
  if (vs.drill.categoryId) p.set('cat', vs.drill.categoryId)
  if (vs.drill.subCategoryId) p.set('sub', vs.drill.subCategoryId)
  if (vs.drill.itemId) p.set('item', vs.drill.itemId)
  if (vs.deltaMode !== 'bars') p.set('delta', vs.deltaMode)
  if (vs.comparison.mode !== 'off') p.set('cmp', vs.comparison.mode)
  if (vs.comparison.mode === 'custom') {
    const a = serialisePeriodRef(vs.comparison.periodA)
    const b = serialisePeriodRef(vs.comparison.periodB)
    if (a) p.set('cmpA', a)
    if (b) p.set('cmpB', b)
  }
  const snap = serialisePeriodRef(vs.snapshotPeriod)
  if (snap) p.set('snap', snap)
  if (vs.scopedDashboardCollapsed === true) p.set('scoped', '0')
  if (vs.scopedDashboardCollapsed === false) p.set('scoped', '1')
  return p
}

// ── Scoped Dashboard grid (§4.9) ──────────────────────────────────────────

export type ScopedRowKind =
  | 'scopeTotal'
  | 'subCategorySubtotal'
  | 'item'
  | 'splitProperty'
  | 'splitNonProperty'
  | 'exclusiveItem'
  | 'lensStrip'

export interface ScopedRow {
  key: string
  kind: ScopedRowKind
  label: string
  /** 0 = flush, 1 = indented under a sub-category subtotal. */
  indent: 0 | 1
  itemType?: string
  exclusive?: boolean
  /** set on `item` rows — clicking the row drills the whole view to depth 3. */
  itemId?: string
  /** full untrimmed quarterly series aligned to `axis`. */
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  hasData: boolean[]
  hasPreviousData: boolean[]
}

export type ScopedEmptyState =
  | { kind: 'none' }
  | { kind: 'noPopulatedPeriods' }
  | { kind: 'lensMismatchScope'; qualifyingLensLabel: string; totalItems: number }
  | { kind: 'lensMismatchItem'; itemType: string; lensLabel: string }
  | { kind: 'exclusiveLeaf' }

export interface ScopeFacts {
  firstPopulatedLabel: string | null
  lastPopulatedLabel: string | null
  populatedCount: number
  peakValue: number | null
  peakLabel: string | null
  troughValue: number | null
  troughLabel: string | null
  netChange: number | null
  latestDeltaAmount: number | null
  latestDeltaPercent: number | null
}

export interface ScopedGrid {
  depth: DrillDepth
  /** false at depth 0 — the grid does not render (only the hint / lens strip). */
  render: boolean
  scopeKind: 'set' | 'category' | 'subCategory' | 'item'
  scopeLabel: string
  itemType?: string
  exclusive?: boolean
  inScopeQualifyingCount: number
  /** number of non-exclusive items in scope, ignoring the lens type filter. */
  inScopeNonExclusiveCount: number
  axis: QuarterPoint[]
  rows: ScopedRow[]
  exclusiveRows: ScopedRow[]
  /** depth 0 only — Grand Total / Property / Non-Property, as-of latest. */
  lensStripRows: ScopedRow[]
  splitNote: string | null
  emptyState: ScopedEmptyState
  completeness: { populated: number; total: number; firstLabel: string | null; lastLabel: string | null }
  scopeFacts: ScopeFacts | null
}

function itemRow(
  grid: DashboardBalanceGridOut,
  item: DashboardItemRow,
  kind: ScopedRowKind,
  indent: 0 | 1,
): ScopedRow {
  const cs = readCellSeries(grid, item.cells)
  return {
    key: `${kind}:${item.id}`,
    kind,
    label: item.name,
    indent,
    itemType: item.type,
    exclusive: item.exclusive,
    itemId: item.id,
    balance: cs.balance,
    deltaAmount: cs.deltaAmount,
    deltaPercent: cs.deltaPercent,
    hasData: cs.hasData,
    hasPreviousData: cs.hasPreviousData,
  }
}

function verbatimRow(
  grid: DashboardBalanceGridOut,
  cells: readonly BalanceCell[],
  key: string,
  kind: ScopedRowKind,
  label: string,
  indent: 0 | 1 = 0,
): ScopedRow {
  const cs = readCellSeries(grid, cells)
  return {
    key, kind, label, indent,
    balance: cs.balance,
    deltaAmount: cs.deltaAmount,
    deltaPercent: cs.deltaPercent,
    hasData: cs.hasData,
    hasPreviousData: cs.hasPreviousData,
  }
}

function derivedRow(
  grid: DashboardBalanceGridOut,
  items: DashboardItemRow[],
  key: string,
  kind: ScopedRowKind,
  label: string,
  indent: 0 | 1 = 0,
): ScopedRow {
  const axisLen = periodsAsc(grid).length
  const balance = rollupBalances(items.map(it => readCellSeries(grid, it.cells).balance), axisLen)
  const d = computeSeriesDeltas(balance)
  return {
    key, kind, label, indent,
    balance,
    deltaAmount: d.deltaAmount,
    deltaPercent: d.deltaPercent,
    hasData: balance.map(v => v !== null),
    hasPreviousData: d.hasPreviousData,
  }
}

function scopeTotalRow(
  grid: DashboardBalanceGridOut,
  lens: Lens,
  verbatimCells: readonly BalanceCell[],
  qualifyingItems: DashboardItemRow[],
  label: string,
): ScopedRow {
  return lens === 'grandTotal'
    ? verbatimRow(grid, verbatimCells, 'scopeTotal', 'scopeTotal', label)
    : derivedRow(grid, qualifyingItems, 'scopeTotal', 'scopeTotal', label)
}

function computeScopeFacts(grid: DashboardBalanceGridOut, row: ScopedRow): ScopeFacts {
  const axis = periodsAsc(grid)
  let firstIdx = -1
  let lastIdx = -1
  let peakValue: number | null = null
  let peakIdx = -1
  let troughValue: number | null = null
  let troughIdx = -1
  let populatedCount = 0
  for (let i = 0; i < row.balance.length; i++) {
    const v = row.balance[i]
    if (v === null) continue
    populatedCount++
    if (firstIdx === -1) firstIdx = i
    lastIdx = i
    if (peakValue === null || v > peakValue) { peakValue = v; peakIdx = i }
    if (troughValue === null || v < troughValue) { troughValue = v; troughIdx = i }
  }
  const lbl = (i: number) => (i >= 0 ? quarterLabel(axis[i].year, axis[i].quarter) : null)
  const netChange =
    firstIdx >= 0 && lastIdx >= 0 && firstIdx !== lastIdx
      ? (row.balance[lastIdx] as number) - (row.balance[firstIdx] as number)
      : null
  return {
    firstPopulatedLabel: lbl(firstIdx),
    lastPopulatedLabel: lbl(lastIdx),
    populatedCount,
    peakValue,
    peakLabel: lbl(peakIdx),
    troughValue,
    troughLabel: lbl(troughIdx),
    netChange,
    latestDeltaAmount: lastIdx >= 0 ? row.deltaAmount[lastIdx] : null,
    latestDeltaPercent: lastIdx >= 0 ? row.deltaPercent[lastIdx] : null,
  }
}

function completenessOf(grid: DashboardBalanceGridOut, row: ScopedRow | undefined): ScopedGrid['completeness'] {
  const axis = periodsAsc(grid)
  if (!row) return { populated: 0, total: axis.length, firstLabel: null, lastLabel: null }
  let first = -1
  let last = -1
  let populated = 0
  for (let i = 0; i < row.balance.length; i++) {
    if (row.balance[i] === null) continue
    populated++
    if (first === -1) first = i
    last = i
  }
  const total = populated > 0 ? last - first + 1 : axis.length
  return {
    populated,
    total,
    firstLabel: first >= 0 ? quarterLabel(axis[first].year, axis[first].quarter) : null,
    lastLabel: last >= 0 ? quarterLabel(axis[last].year, axis[last].quarter) : null,
  }
}

const EMPTY_SCOPED_BASE = {
  rows: [] as ScopedRow[],
  exclusiveRows: [] as ScopedRow[],
  lensStripRows: [] as ScopedRow[],
  splitNote: null as string | null,
}

/**
 * §4.9 — builds the Scoped Dashboard grid model for the current `ViewState`
 * (reacts to `lens` + `drill`; `granularity` + `measure` are applied by the
 * presentational grid; `groupBy` + `comparison` are ignored). 100% off the
 * one already-fetched `grid`.
 */
export function buildScopedGrid(grid: DashboardBalanceGridOut, viewState: ViewState): ScopedGrid {
  const axis = periodsAsc(grid)
  const { lens, drill } = viewState
  const depth = drillDepth(drill)

  // depth 0 — grid does not render; optional 3-row lens strip.
  if (depth === 0) {
    const lensStripRows: ScopedRow[] = [
      verbatimRow(grid, grid.grandTotal, 'lensStrip:gt', 'lensStrip', 'Grand Total'),
      verbatimRow(grid, grid.propertyBreakdown.propertyTotal, 'lensStrip:p', 'lensStrip', 'Property'),
      verbatimRow(grid, grid.propertyBreakdown.nonPropertyTotal, 'lensStrip:np', 'lensStrip', 'Non-Property'),
    ]
    const nonExcl = grid.categories.flatMap(itemsUnderCategory).filter(i => !i.exclusive)
    return {
      ...EMPTY_SCOPED_BASE,
      depth,
      render: false,
      scopeKind: 'set',
      scopeLabel: 'All categories',
      inScopeQualifyingCount: nonExcl.length,
      inScopeNonExclusiveCount: nonExcl.length,
      axis,
      lensStripRows,
      emptyState: { kind: 'none' },
      completeness: { populated: 0, total: axis.length, firstLabel: null, lastLabel: null },
      scopeFacts: null,
    }
  }

  // depth 3 — single item / leaf.
  if (depth === 3) {
    const li = locateItem(grid, drill.itemId)
    const item = li?.item
    const scopeLabel = item ? item.name : 'Unknown item'
    if (!item) {
      return {
        ...EMPTY_SCOPED_BASE, depth, render: true, scopeKind: 'item', scopeLabel,
        inScopeQualifyingCount: 0, inScopeNonExclusiveCount: 0, axis,
        emptyState: { kind: 'noPopulatedPeriods' },
        completeness: { populated: 0, total: axis.length, firstLabel: null, lastLabel: null },
        scopeFacts: null,
      }
    }
    const row = itemRow(grid, item, 'item', 0)
    const qualifies = lensIncludes(lens, item)

    if (item.exclusive) {
      return {
        ...EMPTY_SCOPED_BASE, depth, render: true, scopeKind: 'item', scopeLabel,
        itemType: item.type, exclusive: true,
        inScopeQualifyingCount: 0, inScopeNonExclusiveCount: 0, axis,
        rows: [row],
        emptyState: { kind: 'exclusiveLeaf' },
        completeness: completenessOf(grid, row),
        scopeFacts: computeScopeFacts(grid, row),
      }
    }
    if (!qualifies) {
      return {
        ...EMPTY_SCOPED_BASE, depth, render: true, scopeKind: 'item', scopeLabel,
        itemType: item.type, exclusive: false,
        inScopeQualifyingCount: 0, inScopeNonExclusiveCount: 1, axis,
        emptyState: { kind: 'lensMismatchItem', itemType: item.type, lensLabel: lensLabel(lens) },
        completeness: completenessOf(grid, undefined),
        scopeFacts: null,
      }
    }
    const populated = row.balance.some(v => v !== null)
    return {
      ...EMPTY_SCOPED_BASE, depth, render: true, scopeKind: 'item', scopeLabel,
      itemType: item.type, exclusive: false,
      inScopeQualifyingCount: 1, inScopeNonExclusiveCount: 1, axis,
      rows: [row],
      emptyState: populated ? { kind: 'none' } : { kind: 'noPopulatedPeriods' },
      completeness: completenessOf(grid, row),
      scopeFacts: computeScopeFacts(grid, row),
    }
  }

  // depth 1 / 2 — category / sub-category.
  const scopeCat = findCategory(grid, drill.categoryId)
  const scopeSub = depth === 2 ? findSubCategory(grid, drill.categoryId, drill.subCategoryId) : undefined
  const scopeKind: 'category' | 'subCategory' = depth === 1 ? 'category' : 'subCategory'
  const scopeLabel =
    depth === 1 ? (scopeCat?.name ?? 'Unknown category')
      : `${scopeCat?.name ?? '?'} › ${scopeSub?.name ?? 'Unknown sub-category'}`

  const allItems = depth === 1
    ? (scopeCat ? itemsUnderCategory(scopeCat) : [])
    : (scopeSub?.items ?? [])
  const exclusiveItems = allItems.filter(i => i.exclusive)
  const nonExclusiveItems = allItems.filter(i => !i.exclusive)
  const qualifyingItems = nonExclusiveItems.filter(i => lensIncludes(lens, i))

  const exclusiveRows = exclusiveItems.map(i => itemRow(grid, i, 'exclusiveItem', 0))

  // lens mismatch — no qualifying items but there ARE non-exclusive items.
  if (lens !== 'grandTotal' && qualifyingItems.length === 0 && nonExclusiveItems.length > 0) {
    return {
      ...EMPTY_SCOPED_BASE, depth, render: true, scopeKind, scopeLabel,
      inScopeQualifyingCount: 0, inScopeNonExclusiveCount: nonExclusiveItems.length, axis,
      exclusiveRows,
      emptyState: {
        kind: 'lensMismatchScope',
        qualifyingLensLabel: lens === 'property' ? 'Property' : 'Non-Property',
        totalItems: nonExclusiveItems.length,
      },
      completeness: completenessOf(grid, undefined),
      scopeFacts: null,
    }
  }

  const rows: ScopedRow[] = []
  const totalLabel = `Total: ${depth === 1 ? scopeCat?.name ?? '' : scopeSub?.name ?? ''}`
  const totalCells = depth === 1 ? (scopeCat?.subtotal ?? []) : (scopeSub?.subtotal ?? [])
  const totalRow = scopeTotalRow(grid, lens, totalCells, qualifyingItems, totalLabel)
  rows.push(totalRow)

  // split rows (Grand Total lens only).
  if (lens === 'grandTotal') {
    const propItems = nonExclusiveItems.filter(i => i.type === 'Property')
    const nonPropItems = nonExclusiveItems.filter(i => i.type !== 'Property')
    const distinctTypes = new Set(nonExclusiveItems.map(i => i.type))
    const showSplits = depth === 1 || distinctTypes.size >= 2
    if (showSplits) {
      rows.push(derivedRow(grid, propItems, 'split:p', 'splitProperty', 'Property portion'))
      rows.push(derivedRow(grid, nonPropItems, 'split:np', 'splitNonProperty', 'Non-Property portion'))
    }
  }

  let splitNote: string | null = null
  if (depth === 2 && lens === 'grandTotal') {
    const distinctTypes = [...new Set(nonExclusiveItems.map(i => i.type))]
    if (distinctTypes.length === 1) splitNote = `All items in this sub-category are type: ${distinctTypes[0]}`
  }

  if (depth === 1 && scopeCat) {
    for (const sub of [...scopeCat.subCategories].sort((a, b) => a.orderIndex - b.orderIndex)) {
      const subNonExcl = sub.items.filter(i => !i.exclusive)
      const subQualifying = subNonExcl.filter(i => lensIncludes(lens, i))
      if (lens !== 'grandTotal' && subQualifying.length === 0) continue
      const subLabel = sub.name
      rows.push(
        lens === 'grandTotal'
          ? verbatimRow(grid, sub.subtotal, `subtotal:${sub.id}`, 'subCategorySubtotal', subLabel)
          : derivedRow(grid, subQualifying, `subtotal:${sub.id}`, 'subCategorySubtotal', subLabel),
      )
      const itemsToShow = lens === 'grandTotal' ? subNonExcl : subQualifying
      for (const it of [...itemsToShow].sort((a, b) => a.orderIndex - b.orderIndex)) {
        rows.push(itemRow(grid, it, 'item', 1))
      }
    }
  } else if (depth === 2) {
    const itemsToShow = lens === 'grandTotal' ? nonExclusiveItems : qualifyingItems
    for (const it of [...itemsToShow].sort((a, b) => a.orderIndex - b.orderIndex)) {
      rows.push(itemRow(grid, it, 'item', 0))
    }
  }

  const anyPopulated = totalRow.balance.some(v => v !== null)
  const emptyState: ScopedEmptyState = anyPopulated ? { kind: 'none' } : { kind: 'noPopulatedPeriods' }

  return {
    depth,
    render: true,
    scopeKind,
    scopeLabel,
    inScopeQualifyingCount: qualifyingItems.length,
    inScopeNonExclusiveCount: nonExclusiveItems.length,
    axis,
    rows,
    exclusiveRows,
    lensStripRows: [],
    splitNote,
    emptyState,
    completeness: completenessOf(grid, totalRow),
    scopeFacts: null,
  }
}

/** Yearly ("as-of year end") view of one scoped row, for the yearly grid mode. */
export interface YearlyRowView {
  years: YearlyPoint[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  hasPreviousData: boolean[]
}

export function yearlyRowView(row: ScopedRow, axis: readonly QuarterPoint[]): YearlyRowView {
  const years = asOfYearlySeries(row.balance, axis)
  const d = computeSeriesDeltas(years.map(y => y.value))
  return { years, deltaAmount: d.deltaAmount, deltaPercent: d.deltaPercent, hasPreviousData: d.hasPreviousData }
}

// ── Comparison resolution (§4.5f) ─────────────────────────────────────────

export interface ResolvedComparison {
  ok: boolean
  note: string | null
  periodA: PeriodRef | null
  periodB: PeriodRef | null
  fallbackUsed: boolean
}

/**
 * Resolves QoQ / YoY / custom comparison periods against the populated periods
 * of the given node-total balance series (granularity-aware axis).
 */
export function resolveComparison(
  comparison: ComparisonConfig,
  axis: AxisPoint[],
  nodeBalance: (number | null)[],
): ResolvedComparison {
  const populated = axis.filter((_, i) => nodeBalance[i] !== null)
  const toRef = (a: AxisPoint): PeriodRef =>
    a.quarter === null ? { kind: 'year', year: a.year } : { kind: 'quarter', year: a.year, quarter: a.quarter }

  if (comparison.mode === 'off') {
    return { ok: false, note: null, periodA: null, periodB: null, fallbackUsed: false }
  }
  if (populated.length < 2) {
    return { ok: false, note: 'Need at least two populated periods to compare.', periodA: null, periodB: null, fallbackUsed: false }
  }

  if (comparison.mode === 'custom') {
    const a = comparison.periodA ?? null
    const b = comparison.periodB ?? null
    if (!a || !b) {
      return { ok: false, note: 'Pick two periods to compare.', periodA: a, periodB: b, fallbackUsed: false }
    }
    return { ok: true, note: null, periodA: a, periodB: b, fallbackUsed: false }
  }

  const b = populated[populated.length - 1]
  const periodB = toRef(b)

  if (comparison.mode === 'qoq') {
    const a = populated[populated.length - 2]
    return { ok: true, note: null, periodA: toRef(a), periodB, fallbackUsed: false }
  }

  // yoy
  const exactPrior = populated.find(p => p.year === b.year - 1 && p.quarter === b.quarter)
  if (exactPrior) {
    return { ok: true, note: null, periodA: toRef(exactPrior), periodB, fallbackUsed: false }
  }
  const priorYearAny = [...populated].reverse().find(p => p.year <= b.year - 1)
  if (priorYearAny) {
    return {
      ok: true,
      note: `No exact ${b.quarter === null ? '' : `Q${b.quarter} `}${b.year - 1} value — fell back to ${priorYearAny.label}.`,
      periodA: toRef(priorYearAny),
      periodB,
      fallbackUsed: true,
    }
  }
  return { ok: false, note: 'Insufficient data for a year-over-year comparison.', periodA: null, periodB: null, fallbackUsed: false }
}

// ── Small numeric helpers used by the page / StatRow ───────────────────────

export function lastPopulatedIndex(series: readonly (number | null)[]): number {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return i
  return -1
}

export function firstPopulatedIndex(series: readonly (number | null)[]): number {
  for (let i = 0; i < series.length; i++) if (series[i] !== null) return i
  return -1
}

/**
 * Annualised (CAGR-style) change: `(last/first)^(1/years) - 1`, only when
 * `first > 0`, `last > 0`, and the span is ≥ ~1 year; else `null` ("n/a").
 */
export function annualisedChange(
  first: number | null,
  last: number | null,
  spanYears: number,
): number | null {
  if (first === null || last === null || first <= 0 || last <= 0 || spanYears < 1) return null
  return (Math.pow(last / first, 1 / spanYears) - 1) * 100
}

export function applyGranularity(
  granularity: Granularity,
  quarterAxis: QuarterPoint[],
  series: (number | null)[],
): { axis: AxisPoint[]; values: (number | null)[]; yearly: YearlyPoint[] | null } {
  if (granularity === 'quarterly') {
    return { axis: buildQuarterAxis(quarterAxis), values: series, yearly: null }
  }
  const yearly = asOfYearlySeries(series, quarterAxis)
  return { axis: buildYearlyAxis(yearly), values: yearly.map(y => y.value), yearly }
}

// ── Chart model (§4.5 / §4.6) ─────────────────────────────────────────────

interface RawBucketFull {
  id: string
  label: string
  kind: SeriesKind
  drillId: string | null
  orderIndex: number
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
}

export type ChartEmptyReason = 'noQuarterlyData' | 'noQualifyingItems' | 'leafEmpty' | null

export interface ChartModel {
  depth: DrillDepth
  axis: AxisPoint[]
  /** group-by buckets — trimmed, granularity-applied, "Other" rolled up. */
  buckets: AnalysisSeries[]
  /** node / lens total overlay — trimmed, granularity-applied. */
  aggregate: AnalysisSeries
  composition: CompositionResult
  empty: ChartEmptyReason
  /** true when the depth-3 leaf is exclusive or fails the lens (overlay greyed). */
  leafExcluded: boolean
}

function verbatimBucket(
  grid: DashboardBalanceGridOut,
  cells: readonly BalanceCell[],
  id: string, label: string, kind: SeriesKind, drillId: string | null, orderIndex: number,
): RawBucketFull {
  const cs = readCellSeries(grid, cells)
  return { id, label, kind, drillId, orderIndex, balance: cs.balance, deltaAmount: cs.deltaAmount, deltaPercent: cs.deltaPercent }
}

function derivedBucket(
  grid: DashboardBalanceGridOut,
  items: DashboardItemRow[],
  id: string, label: string, kind: SeriesKind, drillId: string | null, orderIndex: number,
): RawBucketFull {
  const axisLen = periodsAsc(grid).length
  const balance = rollupBalances(items.map(it => readCellSeries(grid, it.cells).balance), axisLen)
  const d = computeSeriesDeltas(balance)
  return { id, label, kind, drillId, orderIndex, balance, deltaAmount: d.deltaAmount, deltaPercent: d.deltaPercent }
}

function buildRawBuckets(grid: DashboardBalanceGridOut, viewState: ViewState): RawBucketFull[] {
  const { lens, drill, groupBy } = viewState
  const depth = drillDepth(drill)

  if (depth === 3) {
    const li = locateItem(grid, drill.itemId)
    if (!li) return []
    return [verbatimBucket(grid, li.item.cells, li.item.id, li.item.name, 'item', null, li.item.orderIndex)]
  }

  if (groupBy === 'itemType') {
    const items = subtreeItems(grid, drill).filter(it => lensIncludes(lens, it))
    return TRACKING_ITEM_TYPES
      .map((type, i) => ({ type, i, items: items.filter(it => it.type === type) }))
      .filter(g => g.items.length > 0)
      .map(g => derivedBucket(grid, g.items, `type:${g.type}`, g.type, 'itemType', null, g.i))
  }

  if (depth === 0) {
    return grid.categories
      .map(cat => {
        const items = itemsUnderCategory(cat).filter(it => lensIncludes(lens, it))
        if (items.length === 0) return null
        return lens === 'grandTotal'
          ? verbatimBucket(grid, cat.subtotal, cat.id, cat.name, 'category', cat.id, cat.orderIndex)
          : derivedBucket(grid, items, cat.id, cat.name, 'category', cat.id, cat.orderIndex)
      })
      .filter((b): b is RawBucketFull => b !== null)
  }

  if (depth === 1) {
    const cat = findCategory(grid, drill.categoryId)
    if (!cat) return []
    return cat.subCategories
      .map(sub => {
        const items = sub.items.filter(it => lensIncludes(lens, it))
        if (items.length === 0) return null
        return lens === 'grandTotal'
          ? verbatimBucket(grid, sub.subtotal, sub.id, sub.name, 'subCategory', sub.id, sub.orderIndex)
          : derivedBucket(grid, items, sub.id, sub.name, 'subCategory', sub.id, sub.orderIndex)
      })
      .filter((b): b is RawBucketFull => b !== null)
  }

  // depth 2 — items in the sub-category
  const sub = findSubCategory(grid, drill.categoryId, drill.subCategoryId)
  if (!sub) return []
  const items = sub.items.filter(it => (lens === 'grandTotal' ? !it.exclusive : lensIncludes(lens, it)))
  return items.map(it => verbatimBucket(grid, it.cells, it.id, it.name, 'item', it.id, it.orderIndex))
}

/** §4.5 / §4.6 — the full chart-facing model for the current `ViewState`. */
export function deriveChartModel(grid: DashboardBalanceGridOut, viewState: ViewState): ChartModel {
  const { granularity, drill } = viewState
  const depth = drillDepth(drill)
  const qAxis = periodsAsc(grid)
  const qLen = qAxis.length

  const emptyModel = (reason: ChartEmptyReason): ChartModel => ({
    depth,
    axis: [],
    buckets: [],
    aggregate: { id: '__aggregate__', label: 'Total', color: AGGREGATE_COLOR, kind: 'aggregate', drillId: null, balance: [], deltaAmount: [], deltaPercent: [] },
    composition: { sharePercent: [], absolute: [] },
    empty: reason,
    leafExcluded: false,
  })

  if (grid.years.length === 0) return emptyModel('noQuarterlyData')

  const nt = nodeTotalSeries(grid, drill)
  let leafExcluded = false
  if (depth === 3) {
    const li = locateItem(grid, drill.itemId)
    leafExcluded = li ? (li.item.exclusive || !lensIncludes(drill.lens, li.item)) : false
  }

  const raw = buildRawBuckets(grid, viewState)
  if (raw.length === 0) return emptyModel(depth === 3 ? 'leafEmpty' : 'noQualifyingItems')

  // "Other" rollup on balances, then re-attach deltas.
  const rolled = rollupOther(raw.map(b => ({
    id: b.id, label: b.label, kind: b.kind as 'category' | 'subCategory' | 'item' | 'itemType',
    drillId: b.drillId, orderIndex: b.orderIndex, balance: b.balance,
  })))
  const rolledFull: RawBucketFull[] = rolled.map(rb => {
    const orig = raw.find(b => b.id === rb.id)
    if (orig) return orig
    const d = computeSeriesDeltas(rb.balance)
    return { id: rb.id, label: rb.label, kind: 'other', drillId: null, orderIndex: rb.orderIndex, balance: rb.balance, deltaAmount: d.deltaAmount, deltaPercent: d.deltaPercent }
  })

  // Trim leading/trailing periods where every visible series is null.
  const visible = [...rolledFull.map(b => b.balance), nt.balance]
  const win = trimEmptyEnds(qLen, i => visible.every(arr => (arr[i] ?? null) === null))
  if (win.start > win.end) return emptyModel(depth === 3 ? 'leafEmpty' : 'noQualifyingItems')

  if (granularity === 'quarterly') {
    const axis = buildQuarterAxis(qAxis).slice(win.start, win.end + 1).map((p, i) => ({ ...p, index: i }))
    const sl = <T,>(a: T[]) => a.slice(win.start, win.end + 1)
    const buckets: AnalysisSeries[] = rolledFull.map(b => ({
      id: b.id, label: b.label, color: bucketColor(b, rolledFull), kind: b.kind, drillId: b.drillId,
      balance: sl(b.balance), deltaAmount: sl(b.deltaAmount), deltaPercent: sl(b.deltaPercent),
    }))
    const aggregate: AnalysisSeries = {
      id: '__aggregate__', label: aggregateLabel(depth), color: AGGREGATE_COLOR, kind: 'aggregate', drillId: null,
      balance: sl(nt.balance), deltaAmount: sl(nt.deltaAmount), deltaPercent: sl(nt.deltaPercent),
      excluded: leafExcluded,
    }
    const composition = computeComposition(buckets.map(b => b.balance), aggregate.balance)
    return { depth, axis, buckets, aggregate, composition, empty: null, leafExcluded }
  }

  // yearly
  const aggYearly = asOfYearlySeries(nt.balance, qAxis)
  const yearlyEmptyAt = (i: number) =>
    rolledFull.every(b => (asOfYearlySeries(b.balance, qAxis)[i]?.value ?? null) === null) &&
    (aggYearly[i]?.value ?? null) === null
  const yWin = trimEmptyEnds(aggYearly.length, yearlyEmptyAt)
  if (yWin.start > yWin.end) return emptyModel(depth === 3 ? 'leafEmpty' : 'noQualifyingItems')

  const axis = buildYearlyAxis(aggYearly).slice(yWin.start, yWin.end + 1).map((p, i) => ({ ...p, index: i }))
  const ysl = <T,>(a: T[]) => a.slice(yWin.start, yWin.end + 1)

  const buckets: AnalysisSeries[] = rolledFull.map(b => {
    const yv = asOfYearlySeries(b.balance, qAxis).map(y => y.value)
    const d = computeSeriesDeltas(yv)
    return {
      id: b.id, label: b.label, color: bucketColor(b, rolledFull), kind: b.kind, drillId: b.drillId,
      balance: ysl(yv), deltaAmount: ysl(d.deltaAmount), deltaPercent: ysl(d.deltaPercent),
    }
  })
  const aggYv = aggYearly.map(y => y.value)
  const aggD = computeSeriesDeltas(aggYv)
  const aggregate: AnalysisSeries = {
    id: '__aggregate__', label: aggregateLabel(depth), color: AGGREGATE_COLOR, kind: 'aggregate', drillId: null,
    balance: ysl(aggYv), deltaAmount: ysl(aggD.deltaAmount), deltaPercent: ysl(aggD.deltaPercent),
    excluded: leafExcluded,
  }
  const composition = computeComposition(buckets.map(b => b.balance), aggregate.balance)
  return { depth, axis, buckets, aggregate, composition, empty: null, leafExcluded }
}

function bucketColor(b: RawBucketFull, all: RawBucketFull[]): string {
  if (b.kind === 'other' || b.id === '__other__') return OTHER_COLOR
  const categoricalIdx = all.filter(x => x.kind !== 'other').findIndex(x => x.id === b.id)
  return CATEGORICAL_PALETTE[(categoricalIdx >= 0 ? categoricalIdx : 0) % CATEGORICAL_PALETTE.length]
}

function aggregateLabel(depth: DrillDepth): string {
  return depth === 0 ? 'Lens total' : 'Scope total'
}

// ── KPI StatRow (§4.5e — scope-aware, SD-OQ-1) ────────────────────────────

export interface StatRowModel {
  latestValue: number | null
  latestPeriodLabel: string | null
  latestDeltaAmount: number | null
  latestDeltaPercent: number | null
  rangeChangeAmount: number | null
  rangeChangePercent: number | null
  rangeSpanLabel: string | null
  annualisedPercent: number | null
  populatedCount: number
  totalPeriods: number
}

/** Computed from the SAME node-total series the Scoped Dashboard scope-total uses. */
export function buildStatRow(axis: AxisPoint[], values: (number | null)[]): StatRowModel {
  const lastIdx = lastPopulatedIndex(values)
  const firstIdx = firstPopulatedIndex(values)
  const d = computeSeriesDeltas(values)

  const first = firstIdx >= 0 ? values[firstIdx] : null
  const last = lastIdx >= 0 ? values[lastIdx] : null
  const rangeChangeAmount = first !== null && last !== null && firstIdx !== lastIdx ? last - first : null
  const rangeChangePercent =
    rangeChangeAmount !== null && first !== null && first !== 0 ? (rangeChangeAmount / first) * 100 : null

  let spanYears = 0
  let rangeSpanLabel: string | null = null
  if (firstIdx >= 0 && lastIdx >= 0 && firstIdx !== lastIdx) {
    const a = axis[firstIdx]
    const b = axis[lastIdx]
    const frac = (p: AxisPoint) => p.year + (p.quarter ? (p.quarter - 1) / 4 : 0.75)
    spanYears = frac(b) - frac(a)
    rangeSpanLabel = `${a.label} → ${b.label}`
  }

  return {
    latestValue: last,
    latestPeriodLabel: lastIdx >= 0 ? axis[lastIdx].label : null,
    latestDeltaAmount: lastIdx >= 0 ? d.deltaAmount[lastIdx] : null,
    latestDeltaPercent: lastIdx >= 0 ? d.deltaPercent[lastIdx] : null,
    rangeChangeAmount,
    rangeChangePercent,
    rangeSpanLabel,
    annualisedPercent: annualisedChange(first, last, spanYears),
    populatedCount: values.filter(v => v !== null).length,
    totalPeriods: values.length,
  }
}
