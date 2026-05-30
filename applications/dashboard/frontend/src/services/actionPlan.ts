import { apiClient } from './api'

export type PlanType = 'purchase' | 'portfolio'
export type ViewMonths = 3 | 6 | 12 | null

// ── Summary (list view) ───────────────────────────────────────────────────────

export interface PlanSummary {
  id: string
  name: string
  plan_type: PlanType
  created_at: string
  updated_at: string
  symbols: string
}

// ── Item shapes ───────────────────────────────────────────────────────────────

export interface PurchaseItem {
  id?: string
  sort_order: number
  stock: string
  current_price: number | null
  size: number | null
  buy_price: number | null
  tp: number | null
  sl: number | null
  strategy: string | null
  reason: string | null
  triggered: boolean
}

export interface PortfolioItem {
  id?: string
  sort_order: number
  symbol: string
  current_price: number | null
  size: number | null
  entry_price: number | null
  tp: number | null
  sl: number | null
  order_size: number | null
}

// ── Full plan (detail view) ───────────────────────────────────────────────────

export interface ActionPlan {
  id: string
  name: string
  plan_type: PlanType
  notes: string | null
  set_analysis: string | null
  ai_recommend: string | null
  created_at: string
  updated_at: string
  purchase_items: PurchaseItem[]
  portfolio_items: PortfolioItem[]
}

// ── Service ───────────────────────────────────────────────────────────────────

export const actionPlanService = {
  /** Suggest a unique plan name for today (YYYY-MM-DD[-NN]). */
  async suggestName(type: PlanType): Promise<string> {
    const { data } = await apiClient.get('/action-plans/suggest-name', {
      params: { plan_type: type },
    })
    return data.name as string
  },

  /** Fetch the latest closing price for a Thai SET stock. Returns null on error. */
  async getStockPrice(symbol: string): Promise<number | null> {
    try {
      const { data } = await apiClient.get('/action-plans/stock-price', {
        params: { symbol },
      })
      return data.price as number
    } catch {
      return null
    }
  },

  /** List plans, optionally filtered by months (null = all). */
  async list(type: PlanType, months?: number | null): Promise<PlanSummary[]> {
    const params: Record<string, unknown> = { plan_type: type }
    if (months) params.months = months
    const { data } = await apiClient.get('/action-plans', { params })
    return data as PlanSummary[]
  },

  /** Create an empty plan and return its id + name. */
  async create(name: string, type: PlanType): Promise<{ id: string; name: string }> {
    const { data } = await apiClient.post('/action-plans', { name, plan_type: type })
    return data
  },

  /** Fetch a plan with all its items. */
  async get(id: string): Promise<ActionPlan> {
    const { data } = await apiClient.get(`/action-plans/${id}`)
    return data as ActionPlan
  },

  /** Replace the name and/or items of a plan. */
  async update(
    id: string,
    payload: {
      name?: string
      purchase_items?: Omit<PurchaseItem, 'id'>[]
      portfolio_items?: Omit<PortfolioItem, 'id'>[]
      notes?: string | null
      set_analysis?: string | null
      ai_recommend?: string | null
    },
  ): Promise<void> {
    await apiClient.put(`/action-plans/${id}`, payload)
  },

  /** Hard-delete a plan (irreversible). */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/action-plans/${id}`)
  },

  /** Duplicate a plan with a new name. Returns the new plan id + name. */
  async duplicate(id: string, newName: string): Promise<{ id: string; name: string }> {
    const { data } = await apiClient.post(
      `/action-plans/${id}/duplicate`,
      null,
      { params: { new_name: newName } },
    )
    return data
  },
}
