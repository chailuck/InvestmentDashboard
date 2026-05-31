import { apiClient } from './api'

export type AssetType = 'SET' | 'CRYPTO' | 'DR'

export interface ChartData {
  symbol: string
  candles: { time: string; open: number; high: number; low: number; close: number }[]
  volume: { time: string; value: number; color: string }[]
  rsi: { time: string; value: number }[]
  stoch_k: { time: string; value: number }[]
  stoch_d: { time: string; value: number }[]
  vrvp: { price_low: number; price_high: number; volume: number }[]
}

export interface SearchResult {
  symbol: string
  ticker?: string
  asset_type: AssetType
  name?: string
  price?: number
  change_pct?: number
  found: boolean
}

export const analyticsService = {
  async getChartData(symbol: string, assetType: AssetType, period = '6mo'): Promise<ChartData> {
    const { data } = await apiClient.get('/analytics/chart', {
      params: { symbol, asset_type: assetType, period },
    })
    return data as ChartData
  },

  async search(q: string, assetType: AssetType): Promise<SearchResult> {
    const { data } = await apiClient.get('/analytics/search', {
      params: { q, asset_type: assetType },
    })
    return data as SearchResult
  },

  async getAnalysisLog(symbol: string): Promise<{ found: boolean; content: string | null; filename: string | null; file_type: 'html' | 'md' | null }> {
    const { data } = await apiClient.get('/analytics/analysis-log', { params: { symbol } })
    return data
  },

  async getFiboChart(symbol: string): Promise<{ found: boolean; image: string | null; filename: string | null }> {
    const { data } = await apiClient.get('/analytics/fibo-chart', { params: { symbol } })
    return data
  },

  async getNote(symbol: string): Promise<{ note: string; found: boolean }> {
    const { data } = await apiClient.get('/analytics/note', { params: { symbol } })
    return data
  },

  async saveNote(symbol: string, assetType: AssetType, note: string): Promise<void> {
    await apiClient.put('/analytics/note', { symbol, asset_type: assetType, note })
  },
}
