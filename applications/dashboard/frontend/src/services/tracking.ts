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

export type TrackingItemType =
  | 'Bank account'
  | 'Property'
  | 'Investment Account'
  | 'TaxSaving'
  | 'Materials'
  | 'Insurance'

/** All valid item type values, in display order — used to populate the type <select>. */
export const TRACKING_ITEM_TYPES: TrackingItemType[] = [
  'Bank account',
  'Property',
  'Investment Account',
  'TaxSaving',
  'Materials',
  'Insurance',
]

export interface TrackingItem {
  id: string
  subCategoryId: string
  name: string
  type: TrackingItemType
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
  createdAt: string
  updatedAt: string
}

export interface RunningTotal {
  itemId: string
  currentTotal: number
  entries: (Entry & { runningTotal: number })[]
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
  type: TrackingItemType
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
    return data as RunningTotal
  },

  // Dashboard ──────────────────────────────────────────────────────────────
  async getBalanceGrid(setId: string): Promise<DashboardBalanceGridOut> {
    const { data } = await apiClient.get(p(`/sets/${setId}/dashboard/balance-grid`))
    return data as DashboardBalanceGridOut
  },
}
