import { apiClient } from './api'

export interface UserPortfolio {
  id: string
  name: string
  description: string | null
  is_default: boolean
  portfolio_mode: 'excel' | 'db'
  excel_source_path: string | null
  excel_working_path: string | null
  sort_order: number
  created_at: string | null
  updated_at: string | null
}

export interface PortfolioCreate {
  name: string
  portfolio_mode?: 'excel' | 'db'
  excel_source_path?: string | null
  excel_working_path?: string | null
  description?: string | null
}

export interface PortfolioUpdate {
  name?: string
  portfolio_mode?: 'excel' | 'db'
  excel_source_path?: string | null
  excel_working_path?: string | null
  description?: string | null
  sort_order?: number
}

export interface PortfolioRiskMetrics {
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  volatility: number
  beta: number
  alpha: number
  var95: number
  calmarRatio: number
}

export const portfolioService = {
  async list(): Promise<UserPortfolio[]> {
    const { data } = await apiClient.get('/portfolios')
    return data
  },

  async getMetrics(_portfolioId: string): Promise<PortfolioRiskMetrics | null> {
    return null
  },

  async create(body: PortfolioCreate): Promise<UserPortfolio> {
    const { data } = await apiClient.post('/portfolios', body)
    return data
  },

  async update(id: string, body: PortfolioUpdate): Promise<UserPortfolio> {
    const { data } = await apiClient.put(`/portfolios/${id}`, body)
    return data
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/portfolios/${id}`)
  },

  async setDefault(id: string): Promise<UserPortfolio> {
    const { data } = await apiClient.put(`/portfolios/${id}/set-default`)
    return data
  },
}
