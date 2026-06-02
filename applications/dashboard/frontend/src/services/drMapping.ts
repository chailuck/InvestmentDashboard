import { apiClient } from './api'

export interface DrMapping {
  id: number
  dr_symbol: string
  parent_symbol: string
  parent_market: string
  ratio: number
  description: string | null
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface DrMappingCreate {
  dr_symbol: string
  parent_symbol: string
  parent_market: string
  ratio: number
  is_active?: boolean
}

export interface DrMappingUpdate {
  parent_symbol?: string
  parent_market?: string
  ratio?: number
  is_active?: boolean
}

export const PARENT_MARKETS = [
  { value: 'CRYPTO',  label: 'Crypto (BTC-USD, ETH-USD …)' },
  { value: 'COMMODITY', label: 'Commodity (GC=F, CL=F …)' },
  { value: 'US',      label: 'US Equity (AAPL, TSLA …)' },
  { value: 'OTHER',   label: 'Other' },
]

export const drMappingService = {
  async list(): Promise<DrMapping[]> {
    const { data } = await apiClient.get('/dr-mappings')
    return data
  },

  async get(drSymbol: string): Promise<DrMapping> {
    const { data } = await apiClient.get(`/dr-mappings/${encodeURIComponent(drSymbol)}`)
    return data
  },

  async create(body: DrMappingCreate): Promise<DrMapping> {
    const { data } = await apiClient.post('/dr-mappings', body)
    return data
  },

  async update(id: number, body: DrMappingUpdate): Promise<DrMapping> {
    const { data } = await apiClient.put(`/dr-mappings/${id}`, body)
    return data
  },

  async delete(id: number): Promise<void> {
    await apiClient.delete(`/dr-mappings/${id}`)
  },

  /** Estimate DR price in THB: parent_price_USD ÷ ratio × usdThb */
  estimatePrice(parentPriceUsd: number, ratio: number, usdThb: number): number {
    return (parentPriceUsd / ratio) * usdThb
  },
}
