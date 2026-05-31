import { apiClient } from './api'

export interface DbPosition {
  id: string
  symbol: string
  direction: 'LONG' | 'SHORT'
  entryDate: string | null
  exitDate: string | null
  entryPrice: number | null
  exitPrice: number | null
  currentPrice: number | null
  positionSize: number | null
  netPnl: number
  pnlPct: number
  sl: number | null
  tp: number | null
  status: 'active' | 'closed'
  remarks: string | null
  parentId: string | null
  hasChildren: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface PositionInput {
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
}

export const portfolioDbService = {
  async getMode(): Promise<'excel' | 'db'> {
    const { data } = await apiClient.get('/portfolio-db/mode')
    return data.mode
  },

  async setMode(mode: 'excel' | 'db'): Promise<void> {
    await apiClient.put('/portfolio-db/mode', null, { params: { mode } })
  },

  async getPositions(status = 'all'): Promise<DbPosition[]> {
    const { data } = await apiClient.get('/portfolio-db/positions', { params: { status } })
    return data.positions
  },

  async create(input: PositionInput): Promise<DbPosition> {
    const { data } = await apiClient.post('/portfolio-db/positions', input)
    return data
  },

  async update(id: string, input: PositionInput): Promise<DbPosition> {
    const { data } = await apiClient.put(`/portfolio-db/positions/${id}`, input)
    return data
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/portfolio-db/positions/${id}`)
  },

  async sell(id: string, quantity: number, exitPrice: number, exitDate: string, remarks?: string): Promise<any> {
    const { data } = await apiClient.post(`/portfolio-db/positions/${id}/sell`, {
      quantity, exit_price: exitPrice, exit_date: exitDate, remarks: remarks || null,
    })
    return data
  },

  async undoSell(id: string): Promise<any> {
    const { data } = await apiClient.post(`/portfolio-db/positions/${id}/undo-sell`)
    return data
  },
}
