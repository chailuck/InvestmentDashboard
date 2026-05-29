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
  label: string
  dailyPnl: number
  cumulativePnl: number
}

export interface PerformanceByDate {
  period: string
  label: string
  net: number
  wins: number
  losses: number
  total: number
  winRate: number
}

export interface PerformanceByStock {
  symbol: string
  net: number
  investment: number
  currentValue: number
  pnlPct: number
  wins: number
  losses: number
  total: number
  winRate: number
}

export interface PeriodTransaction {
  symbol: string
  direction: string
  entryDate: string | null
  exitDate: string
  entryPrice: number
  exitPrice: number
  positionSize: number
  netPnl: number
  pnlPct: number
  sl: number | null
  tp: number | null
  remarks: string | null
}

export interface SetIndex {
  name: string
  value: number | null
  change: number | null
  changePct: number | null
}

export interface GlobalIndex {
  name: string
  value: number | null
  change: number | null
  changePct: number | null
}

export type Period = 'daily' | 'weekly' | 'monthly'
export type StatusFilter = 'active' | 'closed' | 'all'

export const portfolioTrackerService = {
  async refresh(): Promise<{
    status: string
    source: string
    destination: string
    source_size_kb: number
    destination_size_kb: number
    message: string
  }> {
    const { data } = await apiClient.post('/portfolio-tracker/refresh')
    return data
  },

  async getPositions(params: {
    from_date?: string
    to_date?: string
    status?: StatusFilter
  }): Promise<PositionsResponse> {
    const { data } = await apiClient.get('/portfolio-tracker/positions', { params })
    return data
  },

  async getPerformance(params: {
    from_date?: string
    to_date?: string
    period?: Period
  }): Promise<DailyPerformance[]> {
    const { data } = await apiClient.get('/portfolio-tracker/performance', { params })
    return data
  },

  async getPerformanceByDate(params: {
    from_date?: string
    to_date?: string
    period?: Period
  }): Promise<PerformanceByDate[]> {
    const { data } = await apiClient.get('/portfolio-tracker/performance/by-date', { params })
    return data
  },

  async getPerformanceByStock(params: {
    from_date?: string
    to_date?: string
  }): Promise<PerformanceByStock[]> {
    const { data } = await apiClient.get('/portfolio-tracker/performance/by-stock', { params })
    return data
  },

  async getRawData(): Promise<{ file: string; columns: string[]; rows: any[][]; total: number }> {
    const { data } = await apiClient.get('/portfolio-tracker/raw-data')
    return data
  },

  async getTransactions(params: {
    period_key: string
    period: Period
    from_date?: string
    to_date?: string
  }): Promise<PeriodTransaction[]> {
    const { data } = await apiClient.get('/portfolio-tracker/performance/transactions', { params })
    return data
  },

  async getSetIndices(): Promise<SetIndex[]> {
    const { data } = await apiClient.get('/portfolio-tracker/market/set-indices')
    return data
  },

  async getGlobalIndices(): Promise<GlobalIndex[]> {
    const { data } = await apiClient.get('/portfolio-tracker/market/global-indices')
    return data
  },
}
