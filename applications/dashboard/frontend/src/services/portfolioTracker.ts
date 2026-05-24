import { apiClient } from './api'

export interface Position {
  id: number
  symbol: string
  direction: string
  entryDate: string | null
  exitDate: string | null
  entryPrice: number
  currentPrice: number
  exitPrice: number | null
  positionSize: number
  netPnl: number
  pnlPct: number
  sl: number | null
  tp: number | null
  status: 'active' | 'closed'
}

export interface PositionsResponse {
  positions: Position[]
  total: number
  totalNetPnl: number
}

export interface DailyPerformance {
  date: string
  dailyPnl: number
  cumulativePnl: number
}

export const portfolioTrackerService = {
  async getPositions(params: {
    from_date?: string
    to_date?: string
    status?: 'active' | 'closed' | 'all'
  }): Promise<PositionsResponse> {
    const { data } = await apiClient.get('/portfolio-tracker/positions', { params })
    return data
  },

  async getPerformance(params: {
    from_date?: string
    to_date?: string
  }): Promise<DailyPerformance[]> {
    const { data } = await apiClient.get('/portfolio-tracker/performance', { params })
    return data
  },
}
