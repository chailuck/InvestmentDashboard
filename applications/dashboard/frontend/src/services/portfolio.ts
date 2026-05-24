import { apiClient } from './api'
import type { Portfolio, Holding, PerformanceSeries, PortfolioMetrics, PaginatedResponse } from '@/types'

export const portfolioService = {
  async list(): Promise<Portfolio[]> {
    const { data } = await apiClient.get('/portfolios')
    return data
  },

  async get(id: string): Promise<Portfolio> {
    const { data } = await apiClient.get(`/portfolios/${id}`)
    return data
  },

  async getHoldings(id: string): Promise<Holding[]> {
    const { data } = await apiClient.get(`/portfolios/${id}/holdings`)
    return data
  },

  async getPerformance(id: string, period: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'ALL' = '3M'): Promise<PerformanceSeries[]> {
    const { data } = await apiClient.get(`/portfolios/${id}/performance`, { params: { period } })
    return data
  },

  async getMetrics(id: string): Promise<PortfolioMetrics> {
    const { data } = await apiClient.get(`/portfolios/${id}/metrics`)
    return data
  },

  async uploadFile(file: File, portfolioId?: string): Promise<{ jobId: string }> {
    const form = new FormData()
    form.append('file', file)
    if (portfolioId) form.append('portfolio_id', portfolioId)
    const { data } = await apiClient.post('/portfolios/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
}
