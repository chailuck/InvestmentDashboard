import { apiClient } from './api'

// ── Types ─────────────────────────────────────────────────────────────────────
// Client for the "Updates" sub-menu of the Financial Tracker (Phase 2): periodic
// balance snapshots (Update Tracking Lists) taken against a Tracking Set's
// existing category/sub-category/item hierarchy. Kept as a sibling file to
// ./tracking.ts (rather than folded into it) because this is a distinct entity
// family — Update Tracking Lists and their per-item Balances — reached through
// its own nested routes; see the JSDoc in tracking.ts for the shared field-
// naming (camelCase) and error-handling (extractApiError) conventions, which
// apply identically here.
//
// NOTE on numeric coercion: the backend serializes deltaAmount/deltaPercent as
// Decimal values, which FastAPI/Pydantic may emit as numeric strings rather
// than JSON numbers depending on configuration. Call sites must coerce with
// Number(...) before formatting/comparing and guard against NaN — the types
// below declare `number | null` because that is the *intended* shape, not a
// guarantee of what a given response byte-for-byte contains.

export interface UpdateTrackingList {
  id: string
  trackingSetId: string
  /** ISO date string, e.g. "2026-06-30" — the snapshot's as-of date. */
  transactionDate: string
  /** 1-4, or null if unset. Independently settable/clearable from `year`. */
  quarter: number | null
  /** e.g. 2026 (bounded 2000-2100 server-side), or null if unset. Independently settable/clearable from `quarter`. */
  year: number | null
  createdAt: string
  updatedAt: string
}

export interface UpdateTrackingListItemDetail {
  id: string
  name: string
  type: string
  /**
   * Wire field is `orderIndex` (not `order`) — unlike TrackingItemOut/
   * CategoryOut/SubCategoryOut elsewhere, this composite detail response
   * deliberately does not alias `order_index` to `order` on the backend
   * (see app/schemas/update_tracking_list.py).
   */
  orderIndex: number
  balance: number | null
  previousBalance: number | null
  deltaAmount: number | null
  deltaPercent: number | null
  hasPreviousData: boolean
}

export interface UpdateTrackingListSubCategoryDetail {
  id: string
  name: string
  /** Wire field is `orderIndex` — see note on UpdateTrackingListItemDetail. */
  orderIndex: number
  items: UpdateTrackingListItemDetail[]
}

export interface UpdateTrackingListCategoryDetail {
  id: string
  name: string
  /** Wire field is `orderIndex` — see note on UpdateTrackingListItemDetail. */
  orderIndex: number
  subCategories: UpdateTrackingListSubCategoryDetail[]
}

export interface UpdateTrackingListDetail {
  list: UpdateTrackingList
  previousListId: string | null
  categories: UpdateTrackingListCategoryDetail[]
}

export interface UpdateTrackingListBalance {
  id: string
  updateTrackingListId: string
  trackingItemId: string
  balance: number | null
  createdAt: string
  updatedAt: string
}

// ── Input payloads ────────────────────────────────────────────────────────────

export interface UpdateTrackingListInput {
  transactionDate: string
  quarter?: number | null
  year?: number | null
}

export interface BalanceInput {
  trackingItemId: string
  balance: number | null
}

// ── Service ───────────────────────────────────────────────────────────────────
// Confirmed against the backend engineer's actual implementation
// (tracking-backend): nested under /sets/{setId}/update-lists for
// create/list, flat /update-lists/{id}... for read/update/delete/detail/
// balances. All calls go through the shared `apiClient` axios instance (see
// ./api.ts) so bearer-token injection and 401 refresh behave identically to
// every other service in this app; errors are plain AxiosErrors and calling
// UI code should use `extractApiError` from ./api to surface the backend's
// `{ detail: "..." }` message.

const p = (suffix: string) => `/tracking${suffix}`

export const updateTrackingService = {
  async listUpdateLists(setId: string): Promise<UpdateTrackingList[]> {
    const { data } = await apiClient.get(p(`/sets/${setId}/update-lists`))
    return data as UpdateTrackingList[]
  },
  async createUpdateList(setId: string, input: UpdateTrackingListInput): Promise<UpdateTrackingList> {
    const { data } = await apiClient.post(p(`/sets/${setId}/update-lists`), input)
    return data as UpdateTrackingList
  },
  async getUpdateList(id: string): Promise<UpdateTrackingList> {
    const { data } = await apiClient.get(p(`/update-lists/${id}`))
    return data as UpdateTrackingList
  },
  async updateUpdateList(id: string, input: Partial<UpdateTrackingListInput>): Promise<UpdateTrackingList> {
    const { data } = await apiClient.put(p(`/update-lists/${id}`), input)
    return data as UpdateTrackingList
  },
  async deleteUpdateList(id: string): Promise<void> {
    await apiClient.delete(p(`/update-lists/${id}`))
  },
  async getUpdateListDetail(id: string): Promise<UpdateTrackingListDetail> {
    const { data } = await apiClient.get(p(`/update-lists/${id}/detail`))
    return data as UpdateTrackingListDetail
  },
  /** Bulk-upserts balances for one or more items belonging to this list. */
  async upsertBalances(id: string, balances: BalanceInput[]): Promise<UpdateTrackingListBalance[]> {
    const { data } = await apiClient.put(p(`/update-lists/${id}/balances`), { balances })
    return data as UpdateTrackingListBalance[]
  },
}
