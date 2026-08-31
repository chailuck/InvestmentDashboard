/**
 * Feature-local view-model types for the Financial Tracker "Analysis" view.
 *
 * `ViewState` (per ANALYSIS-DESIGN.html §4.4 + the rev-2 note) is the single
 * source of truth for every chart, the comparison panel, the Scoped Dashboard
 * section and the CSV export. It is fully URL-serialisable via flat query
 * params (see `lib/tracking-analysis.ts` `viewStateToQuery` / `queryToViewState`).
 *
 * These types are deliberately NOT added to `services/tracking.ts` — they are
 * a client-only view concern, not part of the wire contract.
 */

export type Lens = 'grandTotal' | 'property' | 'nonProperty'
export type Granularity = 'quarterly' | 'yearly'
export type Measure = 'balance' | 'deltaAmount' | 'deltaPercent'
export type GroupByDim = 'category' | 'subCategory' | 'item' | 'itemType'
export type DeltaMode = 'bars' | 'waterfall'
export type ComparisonMode = 'off' | 'qoq' | 'yoy' | 'custom'

/** Drill depth 0 (lens total) → 3 (single item / leaf). */
export type DrillDepth = 0 | 1 | 2 | 3

export interface DrillPath {
  lens: Lens
  /** depth 1 */
  categoryId?: string
  /** depth 2 */
  subCategoryId?: string
  /** depth 3 (leaf) */
  itemId?: string
}

export type PeriodRef =
  | { kind: 'quarter'; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: 'year'; year: number }

export interface ComparisonConfig {
  mode: ComparisonMode
  /** Resolved for qoq/yoy at derive time; user-set for custom. */
  periodA?: PeriodRef
  periodB?: PeriodRef
}

export interface ViewState {
  trackingSetId: string
  /** default 'grandTotal' */
  lens: Lens
  /** default 'quarterly' */
  granularity: Granularity
  /** default 'balance' */
  measure: Measure
  /** default follows drill depth (see §4.4 depth ↔ group-by table) */
  groupBy: GroupByDim
  /** default { lens: 'grandTotal' } */
  drill: DrillPath
  /** Breakdown-snapshot focus period; default = latest populated period. */
  snapshotPeriod?: PeriodRef
  /** default 'bars' */
  deltaMode: DeltaMode
  /** default { mode: 'off' } */
  comparison: ComparisonConfig
  /**
   * Ephemeral UI preference — Scoped Dashboard collapse override. `undefined`
   * means "use the per-depth default" (expanded at depth ≥ 1, collapsed at 0).
   */
  scopedDashboardCollapsed?: boolean
}

// ── Derived view-model shapes shared between the page and its components ─────

/** One position on the (possibly trimmed, granularity-aware) period axis. */
export interface AxisPoint {
  index: number
  /** e.g. "Q3 2025" (quarterly) or "2025" (yearly). */
  label: string
  year: number
  /** null for a yearly point. */
  quarter: 1 | 2 | 3 | 4 | null
  /** yearly only — which quarter supplied the "as-of" value. */
  asOfQuarter: 1 | 2 | 3 | 4 | null
  /** yearly only — e.g. "as of Q3 2025". */
  asOfLabel: string | null
}

export type SeriesKind =
  | 'category'
  | 'subCategory'
  | 'item'
  | 'itemType'
  | 'aggregate'
  | 'other'

/** A single plotted series (group-by bucket, or the lens/scope-total overlay). */
export interface AnalysisSeries {
  id: string
  label: string
  color: string
  kind: SeriesKind
  /** category / sub-category / item id to drill into on click; null if not drillable. */
  drillId: string | null
  /** Aligned to the axis — `null` is a genuine gap, never interpolated. */
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  /** True when the series is greyed/annotated (exclusive leaf under a lens). */
  excluded?: boolean
}
