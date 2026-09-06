import { apiClient } from './api'

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors the new Financial Tracker backend service, reached through the
// existing Next.js proxy at /api/proxy/api/v1/tracking/... . Field names are
// camelCase because that is the shape the new backend returns (unlike the
// legacy snake_case services in this folder).

export interface TrackingSet {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  trackingSetId: string
  name: string
  description: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export interface SubCategory {
  id: string
  categoryId: string
  name: string
  description: string | null
  order: number
  createdAt: string
  updatedAt: string
}

// ── Configurable item types (Financial Tracker — Configurable Item Types) ─────
// The closed 7-value `type` enum is gone. An item's type is now a row in the
// admin-managed `ft_item_type` table, referenced by `typeId`. `label` / sort
// order / archived state are data an admin edits; `capabilities` are a fixed,
// code-owned registry (`counts_as_property`, `bond_register`) the client only
// ever *reads* as a flag — it never hard-codes a label again.

/** A single configurable tracking-item type. `itemCount` is populated ONLY on
 *  the admin list route (`GET /tracking/item-types`); it is absent elsewhere. */
export interface ItemType {
  id: string
  slug: string
  label: string
  sortOrder: number
  isSystem: boolean
  isArchived: boolean
  /** Fixed code-owned capability keys, e.g. `counts_as_property`, `bond_register`. */
  capabilities: string[]
  /** Number of tracking items currently assigned this type — admin list route only. */
  itemCount?: number
}

/** Create payload for a custom item type (admin only). */
export interface ItemTypeCreateInput {
  label: string
  sortOrder?: number
  /** Subset of the admin-assignable capability set (currently only `counts_as_property`). */
  capabilities?: string[]
}

/** Presence-aware update payload for an item type (admin only). `slug` is never accepted. */
export interface ItemTypeUpdateInput {
  label?: string
  sortOrder?: number
  capabilities?: string[]
}

// ── Bond register ───────────────────────────────────────────────────────────
// A `BOND`-typed tracking item owns a standalone bond register: rows recording
// an individual bond holding's code, issuer, term dates and face amount. The
// backend derives `status` from the term dates against "today" (see
// `computeBondStatus` in lib/bond-status.ts for the mirrored client rule) —
// the register table always shows the server value, never a client guess.

export type BondStatus = 'Pre-order' | 'Active' | 'Expire' | 'Unknown'

export interface Bond {
  id: string
  trackingItemId: string
  code: string
  issuer: string | null
  /** ISO date (yyyy-MM-dd) or `null`. */
  startDate: string | null
  /** ISO date (yyyy-MM-dd) or `null`. */
  expiredDate: string | null
  /** Face amount — coerced from the backend's Decimal-as-string to a real number here. */
  amount: number
  /** Server-computed from the term dates; render verbatim, never derived client-side. */
  status: BondStatus
  /**
   * Coupon rate as a percentage (e.g. `3.25` means 3.25%). Coerced from the
   * backend's Decimal-as-string (`"3.2500"`); `null` when unset.
   */
  interestRate: number | null
  /**
   * Server-computed whole-year term span (see `computeBondYears` for the
   * mirrored client rule). `null` when either term date is missing. Render the
   * server value verbatim — the client mirror is a transient form preview only.
   */
  years: number | null
  createdAt: string
  updatedAt: string
}

export interface BondInput {
  /** Required, non-blank, max 100 chars. */
  code: string
  /** Optional, max 200 chars. Blank is coerced to `null` by the backend; send `null` to clear. */
  issuer?: string | null
  /** ISO date (yyyy-MM-dd). Send `null` to clear; omit to leave untouched on update. */
  startDate?: string | null
  /** ISO date (yyyy-MM-dd). Send `null` to clear; omit to leave untouched on update. */
  expiredDate?: string | null
  /** Face amount, `>= 0` (0 is allowed). */
  amount: number
  /** Coupon rate as a percentage in `[0, 100]`. Send `null` to clear. */
  interestRate: number | null
}

export interface TrackingItem {
  id: string
  subCategoryId: string
  name: string
  /** FK to the configurable item type — what create/update now send. */
  typeId: string
  /** Embedded resolved type (label + capabilities). Read `itemType.capabilities` for behaviour gates. */
  itemType: ItemType
  /**
   * Transition-period read-only field: the type's `label`, kept on the payload
   * for un-migrated clients. Prefer `itemType.label`. Dropped after the backend
   * `ft_tracking_item.type` column is removed.
   */
  type: string
  initialInvestmentTracking: boolean
  exclusive: boolean
  order: number
  description: string | null
  accountName: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface Entry {
  id: string
  trackingItemId: string
  amount: number
  entryDate: string
  /** Optional free-text note (UTF-8 / Thai OK), max 500 chars. `null` when unset. */
  note: string | null
  /** Optional short code (max 100 chars). `null` when unset. */
  code: string | null
  /** Optional short name/label (max 100 chars). `null` when unset. */
  name: string | null
  createdAt: string
  updatedAt: string
}

/** The (year, quarter) grid slot a `currentValue` figure was read from — the most-recent populated balance slot for the item. */
export interface CurrentValueSlot {
  year: number
  quarter: number
}

/**
 * Read-time "profit vs original investment" figures for a single tracking
 * item. ALWAYS present on `RunningTotal`; every inner field is `null` when
 * the underlying data is absent:
 *  - `netOriginalInvestment` — `null` when the item has 0 ledger entries (NOT 0).
 *  - `currentValue` / `currentValueSlot` — `null` when the item has no
 *    populated update-list balance slot.
 *  - `profit` — `null` unless BOTH `netOriginalInvestment` and `currentValue`
 *    are present.
 *  - `profitPercent` — `null` unless `netOriginalInvestment > 0` AND
 *    `currentValue` is present. Never computed client-side.
 *  - `isCovered` — `(>= 1 entry) AND (currentValue not null)`.
 */
export interface ProfitVsOriginal {
  netOriginalInvestment: number | null
  currentValue: number | null
  currentValueSlot: CurrentValueSlot | null
  profit: number | null
  profitPercent: number | null
  isCovered: boolean
}

export interface RunningTotal {
  itemId: string
  currentTotal: number
  entries: (Entry & { runningTotal: number })[]
  /** Always present. See `ProfitVsOriginal` — inner fields are `null` when data is absent. */
  profitVsOriginal: ProfitVsOriginal
}

// ── Original-investment rollup (Dashboard "Original Investment vs Profit") ────
// `GET /tracking/sets/{setId}/dashboard/original-investment` — a per-item
// rollup of each in-scope (non-exclusive, `initialInvestmentTracking=true`)
// item's cost basis vs its most-recent balance snapshot. `items[]` contains
// BOTH covered rows and not-covered rows (the latter carrying `null`
// numeric fields). Cross-user `setId` -> 404.

export interface OriginalInvestmentCoverage {
  /** Items with a computable profit figure. */
  shownCount: number
  /** All in-scope tracked items. */
  totalCount: number
  /** In-scope items with no computable profit figure — surfaced as a footnote. */
  excludedItemNames: string[]
}

export interface OriginalInvestmentItemRow {
  itemId: string
  itemName: string
  categoryName: string
  subCategoryName: string
  /** Signed sum of the item's ledger entries; `null` when not covered. */
  netOriginalInvestment: number | null
  /** Balance in the item's most-recent populated slot; `null` when none. */
  currentValue: number | null
  currentValueSlot: CurrentValueSlot | null
  profit: number | null
  /** Server-computed; render `null` as "—". Never computed client-side. */
  profitPercent: number | null
  isCovered: boolean
}

export interface OriginalInvestmentTotals {
  /** Aggregated over COVERED items only; `null` when `shownCount === 0`. */
  netOriginalInvestment: number | null
  currentValue: number | null
  profit: number | null
  /** `null` when the summed `netOriginalInvestment` is <= 0. */
  profitPercent: number | null
}

export interface OriginalInvestmentRollup {
  trackingSetId: string
  /** ISO-8601 UTC timestamp the rollup was generated. */
  generatedAt: string
  coverage: OriginalInvestmentCoverage
  items: OriginalInvestmentItemRow[]
  totals: OriginalInvestmentTotals
}

// ── Dashboard balance grid (Financial Tracker Phase 3) ───────────────────────
// Read-only quarterly/yearly rollup grid. Every `cells`/`subtotal`/
// `grandTotal`/`propertyTotal`/`nonPropertyTotal` array below has exactly
// `years.length * 4` entries, positionally aligned to iterating `years`
// top-to-bottom then `[1,2,3,4]` per year — the page renders the header once
// from `years` and zips every row's array against that same flattened index,
// with zero client-side date/quarter matching.

/** One balance snapshot cell for a single (year, quarter) column. */
export interface BalanceCell {
  year: number
  quarter: number // 1-4
  balance: number | null
  deltaAmount: number | null
  deltaPercent: number | null
  hasData: boolean
  hasPreviousData: boolean
}

/** One year's column-group header — `quarters` is always `[1, 2, 3, 4]`. */
export interface DashboardYearColumn {
  year: number
  quarters: number[]
}

export interface DashboardItemRow {
  id: string
  name: string
  /** FK to the item's configurable type. */
  typeId: string
  /** Immutable stable key for the item's type — safe to key derivations on across renames. */
  typeSlug: string
  /** True when the type carries the `counts_as_property` capability — drives the Property lens / split. */
  countsAsProperty: boolean
  /** Transition-period read-only display label (the type's `label`). Prefer `typeSlug` for logic. */
  type: string
  orderIndex: number
  exclusive: boolean
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  cells: BalanceCell[]
}

export interface DashboardSubCategoryRow {
  id: string
  name: string
  orderIndex: number
  items: DashboardItemRow[]
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  subtotal: BalanceCell[]
}

export interface DashboardCategoryRow {
  id: string
  name: string
  orderIndex: number
  subCategories: DashboardSubCategoryRow[]
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  subtotal: BalanceCell[]
}

export interface DashboardPropertyBreakdown {
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  propertyTotal: BalanceCell[]
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  nonPropertyTotal: BalanceCell[]
}

export interface DashboardBalanceGridOut {
  trackingSetId: string
  /** Descending by year — the page renders columns in this order verbatim, without re-sorting. */
  years: DashboardYearColumn[]
  categories: DashboardCategoryRow[]
  /** Positionally aligned to the flattened `years x quarters` order — see module header. */
  grandTotal: BalanceCell[]
  propertyBreakdown: DashboardPropertyBreakdown
}

// ── Full backup export (Email Dashboard feature) ─────────────────────────────
// `GET /tracking/sets/{setId}/export` — a full JSON snapshot of everything
// under one tracking set, used as the email attachment for the "Email
// Dashboard" button on the Dashboard page. The frontend treats the deep
// internals (categories/subCategories/trackingItems/etc.) as an OPAQUE blob
// it re-transmits verbatim as a base64 attachment — it never parses or
// validates their shape — so only the top-level envelope is typed here.
export interface TrackingSetExport {
  exportVersion: number
  exportedAt: string
  trackingSet: {
    id: string
    name: string
    description: string | null
    createdAt: string
    updatedAt: string
  }
  categories: unknown[]
  subCategories: unknown[]
  trackingItems: unknown[]
  updateTrackingLists: unknown[]
  updateTrackingListBalances: unknown[]
  initialInvestmentEntries: unknown[]
}

// ── Input payloads ────────────────────────────────────────────────────────────
// Server-managed fields (id, order, createdAt, updatedAt) are never sent by the client.

export interface TrackingSetInput {
  name: string
  description?: string | null
}

export interface CategoryInput {
  name: string
  description?: string | null
}

export interface SubCategoryInput {
  name: string
  description?: string | null
}

export interface TrackingItemInput {
  name: string
  /** FK to a non-archived `ft_item_type` row (hard switch from the old `type` label). */
  typeId: string
  initialInvestmentTracking: boolean
  exclusive: boolean
  description?: string | null
  accountName?: string | null
  remark?: string | null
}

export interface EntryInput {
  /** Signed amount — positive to increase, negative to decrease. Must be non-zero. */
  amount: number
  entryDate: string
  /**
   * Optional free-text note (UTF-8 / Thai OK), max 500 chars. Send `null` (or
   * omit) to clear it. The backend PUT is presence-aware: omitting the key
   * leaves an existing note untouched; sending `null` clears it.
   */
  note?: string | null
  /**
   * Optional short code, max 100 chars. Same presence-aware / blank->null
   * semantics as `note`: omit to leave untouched, `null` to clear.
   */
  code?: string | null
  /**
   * Optional short name/label, max 100 chars. Same presence-aware / blank->null
   * semantics as `note`: omit to leave untouched, `null` to clear.
   */
  name?: string | null
}

// ── Service ───────────────────────────────────────────────────────────────────
// Endpoint shapes below are the assumed REST contract for the new tracking
// backend (nested-resource style: children are created/listed under their
// parent's id, mutated/deleted by their own id) EXCEPT the three `reorder*`
// methods, which are confirmed against the backend engineer's actual
// implementation (tracking-backend/app/api/v1/endpoints/*.py +
// app/schemas/category.py): those routes are PUT, not POST, and expect a
// body of `{ items: [{ id, order }, ...] }` rather than a flat id array —
// see `toOrderItems` below. The remaining (non-reorder) endpoint shapes have
// NOT been confirmed against the backend engineer's actual implementation —
// flag for alignment once that surface area is reviewed. All calls go
// through the shared `apiClient` axios instance (see ./api.ts) so
// bearer-token injection and 401 refresh behave identically to every other
// service in this app; errors are plain AxiosErrors and calling UI code
// should use `extractApiError` from ./api to surface the backend's
// `{ detail: "..." }` message.

const p = (suffix: string) => `/tracking${suffix}`

/**
 * Converts a flat, newly-ordered id list into the `{ id, order }[]` shape the
 * backend's `ReorderRequest` schema requires. Order values are the new
 * 1-indexed position — the backend only cares about relative order, not that
 * values start at 0.
 */
const toOrderItems = (orderedIds: string[]) =>
  orderedIds.map((id, idx) => ({ id, order: idx + 1 }))

// ── Decimal coercion ────────────────────────────────────────────────────────
// The tracking backend serializes every Pydantic `Decimal` field as a JSON
// STRING ("0", "1200.4000", …), never a number. Every money field in the
// interfaces above is declared `number` / `number | null` and consumer code
// calls `.toFixed()` / arithmetic on them directly, so any response carrying
// those fields MUST be coerced here at the service boundary — otherwise the
// UI throws "n.toFixed is not a function" on first render (mirrors the
// dashboard page's own `toFiniteOrNull`).

type Wire = Record<string, unknown>

/** Coerce a JSON number-or-string to a finite number; non-finite / missing → 0. */
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Coerce a JSON number-or-string to a finite number, preserving null/absent as null. */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const normalizeProfitVsOriginal = (p: Wire | null | undefined): ProfitVsOriginal => {
  const w = (p ?? {}) as Wire
  return {
    netOriginalInvestment: numOrNull(w.netOriginalInvestment),
    currentValue: numOrNull(w.currentValue),
    currentValueSlot: (w.currentValueSlot as CurrentValueSlot | null) ?? null,
    profit: numOrNull(w.profit),
    profitPercent: numOrNull(w.profitPercent),
    isCovered: Boolean(w.isCovered),
  }
}

const normalizeRunningTotal = (d: Wire): RunningTotal => ({
  itemId: String(d.itemId),
  currentTotal: num(d.currentTotal),
  entries: ((d.entries as Wire[] | undefined) ?? []).map(e => ({
    id: String(e.id),
    trackingItemId: String(e.trackingItemId ?? ''),
    amount: num(e.amount),
    entryDate: String(e.entryDate),
    note: (e.note as string | null) ?? null,
    code: (e.code as string | null) ?? null,
    name: (e.name as string | null) ?? null,
    createdAt: String(e.createdAt ?? ''),
    updatedAt: String(e.updatedAt ?? ''),
    runningTotal: num(e.runningTotal),
  })),
  profitVsOriginal: normalizeProfitVsOriginal(d.profitVsOriginal as Wire | null | undefined),
})

const normalizeOriginalInvestmentRollup = (d: Wire): OriginalInvestmentRollup => {
  const totals = (d.totals ?? {}) as Wire
  return {
    trackingSetId: String(d.trackingSetId),
    generatedAt: String(d.generatedAt),
    coverage: d.coverage as OriginalInvestmentCoverage,
    items: ((d.items as Wire[] | undefined) ?? []).map(r => ({
      itemId: String(r.itemId),
      itemName: String(r.itemName),
      categoryName: String(r.categoryName),
      subCategoryName: String(r.subCategoryName),
      netOriginalInvestment: numOrNull(r.netOriginalInvestment),
      currentValue: numOrNull(r.currentValue),
      currentValueSlot: (r.currentValueSlot as CurrentValueSlot | null) ?? null,
      profit: numOrNull(r.profit),
      profitPercent: numOrNull(r.profitPercent),
      isCovered: Boolean(r.isCovered),
    })),
    totals: {
      netOriginalInvestment: numOrNull(totals.netOriginalInvestment),
      currentValue: numOrNull(totals.currentValue),
      profit: numOrNull(totals.profit),
      profitPercent: numOrNull(totals.profitPercent),
    },
  }
}

/**
 * Coerce a raw bond wire object to the `Bond` shape. `amount` arrives as a
 * Decimal-as-string ("1000.0000") and MUST be coerced to a real number so the
 * register table can call `.toFixed(2)` on it; `status` is passed through
 * verbatim (the backend owns that value); nullable string fields normalize
 * `undefined` to `null`. `interestRate` arrives as a Decimal-as-string
 * ("3.2500") and `years` as a JSON number-or-null — both go through the
 * null-preserving `numOrNull` helper so `0` survives and `null`/absent → `null`.
 */
const normalizeBond = (w: Wire): Bond => ({
  id: String(w.id),
  trackingItemId: String(w.trackingItemId ?? ''),
  code: String(w.code ?? ''),
  issuer: (w.issuer as string | null) ?? null,
  startDate: (w.startDate as string | null) ?? null,
  expiredDate: (w.expiredDate as string | null) ?? null,
  amount: num(w.amount),
  status: String(w.status) as BondStatus,
  interestRate: numOrNull(w.interestRate),
  years: numOrNull(w.years),
  createdAt: String(w.createdAt ?? ''),
  updatedAt: String(w.updatedAt ?? ''),
})

/**
 * Coerce a raw item-type wire object to the `ItemType` shape: `capabilities`
 * forced to a real `string[]`, the four flags to real booleans, `sortOrder` to
 * a number. `itemCount` is preserved only when the route actually sent it (the
 * admin list route) — `null`/absent collapses to `undefined`.
 */
const normalizeItemType = (w: Wire): ItemType => {
  const rawCaps = w.capabilities
  const capabilities = Array.isArray(rawCaps) ? (rawCaps as unknown[]).map(String) : []
  const out: ItemType = {
    id: String(w.id ?? ''),
    slug: String(w.slug ?? ''),
    label: String(w.label ?? ''),
    sortOrder: num(w.sortOrder),
    isSystem: Boolean(w.isSystem),
    isArchived: Boolean(w.isArchived),
    capabilities,
  }
  if (w.itemCount !== null && w.itemCount !== undefined && w.itemCount !== '') {
    out.itemCount = num(w.itemCount)
  }
  return out
}

export const trackingService = {
  // Tracking Sets ────────────────────────────────────────────────────────────
  async listSets(): Promise<TrackingSet[]> {
    const { data } = await apiClient.get(p('/sets'))
    return data as TrackingSet[]
  },
  async createSet(input: TrackingSetInput): Promise<TrackingSet> {
    const { data } = await apiClient.post(p('/sets'), input)
    return data as TrackingSet
  },
  async updateSet(id: string, input: TrackingSetInput): Promise<TrackingSet> {
    const { data } = await apiClient.put(p(`/sets/${id}`), input)
    return data as TrackingSet
  },
  async deleteSet(id: string): Promise<void> {
    await apiClient.delete(p(`/sets/${id}`))
  },

  // Categories ─────────────────────────────────────────────────────────────
  async listCategories(setId: string): Promise<Category[]> {
    const { data } = await apiClient.get(p(`/sets/${setId}/categories`))
    return data as Category[]
  },
  async createCategory(setId: string, input: CategoryInput): Promise<Category> {
    const { data } = await apiClient.post(p(`/sets/${setId}/categories`), input)
    return data as Category
  },
  async updateCategory(id: string, input: CategoryInput): Promise<Category> {
    const { data } = await apiClient.put(p(`/categories/${id}`), input)
    return data as Category
  },
  async deleteCategory(id: string): Promise<void> {
    await apiClient.delete(p(`/categories/${id}`))
  },
  /** Persists a full reorder — `orderedIds` is the complete, newly-ordered list of category ids for this set. */
  async reorderCategories(setId: string, orderedIds: string[]): Promise<void> {
    await apiClient.put(p(`/sets/${setId}/categories/reorder`), { items: toOrderItems(orderedIds) })
  },

  // Sub-categories ─────────────────────────────────────────────────────────
  async listSubCategories(categoryId: string): Promise<SubCategory[]> {
    const { data } = await apiClient.get(p(`/categories/${categoryId}/sub-categories`))
    return data as SubCategory[]
  },
  async createSubCategory(categoryId: string, input: SubCategoryInput): Promise<SubCategory> {
    const { data } = await apiClient.post(p(`/categories/${categoryId}/sub-categories`), input)
    return data as SubCategory
  },
  async updateSubCategory(id: string, input: SubCategoryInput): Promise<SubCategory> {
    const { data } = await apiClient.put(p(`/sub-categories/${id}`), input)
    return data as SubCategory
  },
  async deleteSubCategory(id: string): Promise<void> {
    await apiClient.delete(p(`/sub-categories/${id}`))
  },
  async reorderSubCategories(categoryId: string, orderedIds: string[]): Promise<void> {
    await apiClient.put(p(`/categories/${categoryId}/sub-categories/reorder`), { items: toOrderItems(orderedIds) })
  },

  // Tracking Items ─────────────────────────────────────────────────────────
  async listItems(subCategoryId: string): Promise<TrackingItem[]> {
    const { data } = await apiClient.get(p(`/sub-categories/${subCategoryId}/items`))
    return data as TrackingItem[]
  },
  async getItem(itemId: string): Promise<TrackingItem> {
    const { data } = await apiClient.get(p(`/items/${itemId}`))
    return data as TrackingItem
  },
  async createItem(subCategoryId: string, input: TrackingItemInput): Promise<TrackingItem> {
    const { data } = await apiClient.post(p(`/sub-categories/${subCategoryId}/items`), input)
    return data as TrackingItem
  },
  async updateItem(id: string, input: Partial<TrackingItemInput>): Promise<TrackingItem> {
    const { data } = await apiClient.put(p(`/items/${id}`), input)
    return data as TrackingItem
  },
  async deleteItem(id: string): Promise<void> {
    await apiClient.delete(p(`/items/${id}`))
  },
  async reorderItems(subCategoryId: string, orderedIds: string[]): Promise<void> {
    await apiClient.put(p(`/sub-categories/${subCategoryId}/items/reorder`), { items: toOrderItems(orderedIds) })
  },

  // Configurable item types ───────────────────────────────────────────────────
  // `GET` is open to any authed tracker user (every item picker needs it);
  // every write is admin-only (403 for non-admins). Error bodies follow the
  // service's `{ detail: "..." }` convention — use `extractApiError`.

  /**
   * Lists item types ordered by `sortOrder` asc then `label`. `includeArchived`
   * defaults to `false` (picker view); pass `true` for the admin screen and to
   * resolve an item's own archived type on the item-detail page.
   */
  async listItemTypes(includeArchived = false): Promise<ItemType[]> {
    const { data } = await apiClient.get(p('/item-types'), {
      params: { includeArchived },
    })
    return ((data as Wire[] | undefined) ?? []).map(normalizeItemType)
  },
  /** Creates a custom type (admin). 409 duplicate label, 422 bad/SYSTEM_ONLY capability. */
  async createItemType(input: ItemTypeCreateInput): Promise<ItemType> {
    const { data } = await apiClient.post(p('/item-types'), input)
    return normalizeItemType(data as Wire)
  },
  /** Presence-aware edit of label / sortOrder / capabilities (admin). `slug` is rejected server-side. */
  async updateItemType(id: string, input: ItemTypeUpdateInput): Promise<ItemType> {
    const { data } = await apiClient.put(p(`/item-types/${id}`), input)
    return normalizeItemType(data as Wire)
  },
  /**
   * Persists a full reorder (admin). `orderedIds` MUST be the complete set of
   * type ids in their new order — the backend 400s an incomplete set.
   */
  async reorderItemTypes(orderedIds: string[]): Promise<void> {
    await apiClient.put(p('/item-types/order'), { items: toOrderItems(orderedIds) })
  },
  /** Archives a type (admin, idempotent). 409 when it is the last non-archived type. */
  async archiveItemType(id: string): Promise<ItemType> {
    const { data } = await apiClient.put(p(`/item-types/${id}/archive`), {})
    return normalizeItemType(data as Wire)
  },
  /** Un-archives a type (admin, idempotent). */
  async unarchiveItemType(id: string): Promise<ItemType> {
    const { data } = await apiClient.put(p(`/item-types/${id}/unarchive`), {})
    return normalizeItemType(data as Wire)
  },
  /** Hard-deletes a zero-item custom type (admin). 409 for a system type or one still in use. */
  async deleteItemType(id: string): Promise<void> {
    await apiClient.delete(p(`/item-types/${id}`))
  },

  // Ledger entries (Initial Investment Tracking) ──────────────────────────
  async listEntries(itemId: string): Promise<Entry[]> {
    const { data } = await apiClient.get(p(`/items/${itemId}/entries`))
    return data as Entry[]
  },
  async createEntry(itemId: string, input: EntryInput): Promise<Entry> {
    const { data } = await apiClient.post(p(`/items/${itemId}/entries`), input)
    return data as Entry
  },
  async updateEntry(id: string, input: EntryInput): Promise<Entry> {
    const { data } = await apiClient.put(p(`/entries/${id}`), input)
    return data as Entry
  },
  async deleteEntry(id: string): Promise<void> {
    await apiClient.delete(p(`/entries/${id}`))
  },
  async getRunningTotal(itemId: string): Promise<RunningTotal> {
    const { data } = await apiClient.get(p(`/items/${itemId}/running-total`))
    return normalizeRunningTotal(data as Wire)
  },

  // Bond register (BOND-typed items) ─────────────────────────────────────────
  async listBonds(itemId: string): Promise<Bond[]> {
    const { data } = await apiClient.get(p(`/items/${itemId}/bonds`))
    return ((data as Wire[] | undefined) ?? []).map(normalizeBond)
  },
  async getBond(bondId: string): Promise<Bond> {
    const { data } = await apiClient.get(p(`/bonds/${bondId}`))
    return normalizeBond(data as Wire)
  },
  async createBond(itemId: string, input: BondInput): Promise<Bond> {
    const { data } = await apiClient.post(p(`/items/${itemId}/bonds`), input)
    return normalizeBond(data as Wire)
  },
  async updateBond(bondId: string, input: Partial<BondInput>): Promise<Bond> {
    const { data } = await apiClient.put(p(`/bonds/${bondId}`), input)
    return normalizeBond(data as Wire)
  },
  async deleteBond(bondId: string): Promise<void> {
    await apiClient.delete(p(`/bonds/${bondId}`))
  },

  // Dashboard ──────────────────────────────────────────────────────────────
  async getBalanceGrid(setId: string): Promise<DashboardBalanceGridOut> {
    const { data } = await apiClient.get(p(`/sets/${setId}/dashboard/balance-grid`))
    return data as DashboardBalanceGridOut
  },
  /** Per-item cost-basis-vs-profit rollup for one tracking set (404 if it doesn't exist or isn't owned by the caller). */
  async getOriginalInvestmentRollup(setId: string): Promise<OriginalInvestmentRollup> {
    const { data } = await apiClient.get(p(`/sets/${setId}/dashboard/original-investment`))
    return normalizeOriginalInvestmentRollup(data as Wire)
  },

  // Full backup export ─────────────────────────────────────────────────────
  /** Fetches the full JSON backup export for one tracking set (404 if it doesn't exist or isn't owned by the caller) — used as the "Email Dashboard" button's attachment. */
  async getExport(setId: string): Promise<TrackingSetExport> {
    const { data } = await apiClient.get(p(`/sets/${setId}/export`))
    return data as TrackingSetExport
  },
}
