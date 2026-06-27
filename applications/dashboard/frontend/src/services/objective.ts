import { apiClient } from './api'
import { FEELINGS, type FeelingValue } from './reviewList'

export { FEELINGS, type FeelingValue }

export type ObjectiveFilter = 'all' | '1m' | '3m' | '6m' | 'week' | 'week2' | 'no_reason'

export interface ObjectivePosition {
  id: string
  symbol: string
  direction: string
  entry_date: string | null
  entry_price: number | null
  position_size: number | null
  sl: number | null
  tp: number | null
  status: string
  exit_date: string | null
  exit_price: number | null
  remarks: string | null
  reason: string | null
  feel: FeelingValue | null
  sell_reason: string | null
  sell_feel: FeelingValue | null
  portfolio_id: string | null
}

export interface ObjectiveListResponse {
  items: ObjectivePosition[]
  total: number
}

export interface ObjectivePatchPayload {
  reason?: string | null
  feel?: FeelingValue | null
  sell_reason?: string | null
  sell_feel?: FeelingValue | null
}

function filterToParams(filter: ObjectiveFilter): Record<string, unknown> {
  if (filter === '1m') return { months: 1 }
  if (filter === '3m') return { months: 3 }
  if (filter === '6m') return { months: 6 }
  if (filter === 'week') return { week: true }
  if (filter === 'week2') return { week2: true }
  if (filter === 'no_reason') return { no_reason_only: true }
  return {}
}

export const objectiveService = {
  async list(portfolioId: string, filter: ObjectiveFilter): Promise<ObjectiveListResponse> {
    const { data } = await apiClient.get('/objective', {
      params: { portfolio_id: portfolioId, ...filterToParams(filter) },
    })
    return data as ObjectiveListResponse
  },

  async patch(positionId: string, payload: ObjectivePatchPayload): Promise<ObjectivePosition> {
    const { data } = await apiClient.patch(`/objective/${positionId}`, payload)
    return data as ObjectivePosition
  },
}
