import { apiClient } from './api'

// ── Feeling levels ────────────────────────────────────────────────────────────

export const FEELINGS = [
  { value: 5, label: 'Very Good', iconKey: 'ChevronsUp',   color: 'text-emerald-400', bg: 'bg-emerald-400/15 border-emerald-400/30' },
  { value: 4, label: 'Good',      iconKey: 'ChevronUp',    color: 'text-green-400',   bg: 'bg-green-400/15 border-green-400/30' },
  { value: 3, label: 'Moderate',  iconKey: 'Minus',        color: 'text-amber-400',   bg: 'bg-amber-400/15 border-amber-400/30' },
  { value: 2, label: 'Bad',       iconKey: 'ChevronDown',  color: 'text-orange-400',  bg: 'bg-orange-400/15 border-orange-400/30' },
  { value: 1, label: 'Very Bad',  iconKey: 'ChevronsDown', color: 'text-red-400',     bg: 'bg-red-400/15 border-red-400/30' },
] as const

export type FeelingValue = 1 | 2 | 3 | 4 | 5
export type ItemType = 'TRADE' | 'HOLD'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewSummary {
  id: string
  week_start: string
  week_end: string
  name: string
  trade_count: number
  hold_count: number
  buy_count: number
  sell_count: number
  created_at: string
  updated_at: string
}

export interface ReviewItem {
  id: string
  review_id: string
  symbol: string
  item_type: ItemType
  // Buy leg
  buy_date: string | null
  buy_price: number | null
  buy_size: number | null
  // Sell leg
  sell_date: string | null
  sell_price: number | null
  sell_size: number | null
  // Week price snapshot
  week_open_price: number | null
  week_close_price: number | null
  week_change_pct: number | null
  // Annotations
  buy_reason: string | null
  buy_feeling: FeelingValue | null
  sell_reason: string | null
  sell_feeling: FeelingValue | null
  source_position_id: string | null
  sort_order: number
  updated_at: string
}

export interface OpenSuggestion {
  id: string
  symbol: string
  entry_date: string | null
  entry_price: number | null
  position_size: number | null
  direction: string
}

export interface ReviewDetail {
  id: string
  week_start: string
  week_end: string
  name: string
  notes: string | null
  created_at: string
  updated_at: string
  trade_items: ReviewItem[]
  hold_items: ReviewItem[]
  open_suggestions: OpenSuggestion[]
}

export interface ReviewItemIn {
  symbol: string
  item_type: ItemType
  buy_date?: string | null
  buy_price?: number | null
  buy_size?: number | null
  sell_date?: string | null
  sell_price?: number | null
  sell_size?: number | null
  buy_reason?: string | null
  buy_feeling?: FeelingValue | null
  sell_reason?: string | null
  sell_feeling?: FeelingValue | null
  source_position_id?: string | null
  sort_order?: number
}

// ── Service ───────────────────────────────────────────────────────────────────

export const reviewListService = {
  /** Get or auto-create this week's review. */
  async getCurrentWeek(): Promise<ReviewSummary> {
    const { data } = await apiClient.get('/review-list/current-week')
    return data as ReviewSummary
  },

  /** List all reviews, optionally filtered by months. */
  async list(months?: number | null): Promise<ReviewSummary[]> {
    const params: Record<string, unknown> = {}
    if (months) params.months = months
    const { data } = await apiClient.get('/review-list', { params })
    return data as ReviewSummary[]
  },

  /** Get full review detail with items and open-position suggestions. */
  async get(id: string): Promise<ReviewDetail> {
    const { data } = await apiClient.get(`/review-list/${id}`)
    return data as ReviewDetail
  },

  /** Update review header. */
  async update(id: string, payload: { name?: string; notes?: string | null }): Promise<void> {
    await apiClient.put(`/review-list/${id}`, payload)
  },

  /** Delete review. */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/review-list/${id}`)
  },

  /** Sync TRADE items from portfolio_positions_db. */
  async syncFromPortfolio(id: string): Promise<{ added: number; updated: number }> {
    const { data } = await apiClient.post(`/review-list/${id}/sync`)
    return data
  },

  /** Refresh Monday-open / Friday-close prices from yfinance for all symbols. */
  async refreshPrices(id: string): Promise<{ updated: number; symbols: { symbol: string; week_open_price: number | null; week_close_price: number | null }[] }> {
    const { data } = await apiClient.post(`/review-list/${id}/refresh-prices`)
    return data
  },

  /** Add a single item to the review. */
  async addItem(reviewId: string, item: ReviewItemIn): Promise<ReviewItem> {
    const { data } = await apiClient.post(`/review-list/${reviewId}/items`, item)
    return data as ReviewItem
  },

  /** Patch reasons / feelings on a single item (auto-save). */
  async patchItem(
    reviewId: string,
    itemId: string,
    payload: { buy_reason?: string | null; buy_feeling?: FeelingValue | null; sell_reason?: string | null; sell_feeling?: FeelingValue | null },
  ): Promise<ReviewItem> {
    const { data } = await apiClient.patch(`/review-list/${reviewId}/items/${itemId}`, payload)
    return data as ReviewItem
  },

  /** Delete a single item. */
  async deleteItem(reviewId: string, itemId: string): Promise<void> {
    await apiClient.delete(`/review-list/${reviewId}/items/${itemId}`)
  },
}
