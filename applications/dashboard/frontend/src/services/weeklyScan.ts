import { apiClient } from './api'

export const COLOR_MARKS = [
  { value: 'CYAN',   label: 'Potential',    bg: 'bg-cyan-500/20',   text: 'text-cyan-400',   border: 'border-cyan-500/40',   dot: 'bg-cyan-400'   },
  { value: 'GREEN',  label: 'Good',         bg: 'bg-gain/15',       text: 'text-gain',        border: 'border-gain/30',        dot: 'bg-gain'        },
  { value: 'YELLOW', label: 'Monitor',      bg: 'bg-amber-500/15',  text: 'text-amber-400',   border: 'border-amber-500/30',   dot: 'bg-amber-400'   },
  { value: 'RED',    label: 'Skip',         bg: 'bg-loss/15',       text: 'text-loss',         border: 'border-loss/30',        dot: 'bg-loss'         },
  { value: 'PURPLE', label: 'In Portfolio', bg: 'bg-purple-500/15', text: 'text-purple-400',  border: 'border-purple-500/30',  dot: 'bg-purple-400'  },
] as const

export type ColorMark = (typeof COLOR_MARKS)[number]['value']

export const SCAN_STRATEGIES = ['BREAK OUT', 'BUY ON DIP', 'แท่งเทียนกลับตัว', 'NEWS', 'AJ PAO', 'OTHERS']

export interface ScanConfig {
  symbols: string[]
  updated_at: string | null
}

export interface ColorCounts {
  CYAN: number
  GREEN: number
  YELLOW: number
  RED: number
  PURPLE: number
  NONE: number
}

export interface ScanListSummary {
  id: string
  name: string
  created_at: string
  updated_at: string
  total: number
  color_counts: ColorCounts
}

export interface WeeklyScanItem {
  id: string
  symbol: string
  sort_order: number
  color_mark: ColorMark | null
  strategy: string | null
  buy_price: number | null
  size: number | null
  tp: number | null
  sl: number | null
  remark: string | null
  updated_at: string | null
}

export interface WeeklyScan {
  id: string
  name: string
  created_at: string
  updated_at: string
  items: WeeklyScanItem[]
  color_counts: ColorCounts
}

export const weeklyScanService = {
  async getConfig(): Promise<ScanConfig> {
    const { data } = await apiClient.get('/weekly-scan/config')
    return data
  },

  async updateConfig(symbols: string[]): Promise<ScanConfig> {
    const { data } = await apiClient.put('/weekly-scan/config', { symbols })
    return data
  },

  async suggestName(): Promise<string> {
    const { data } = await apiClient.get('/weekly-scan/suggest-name')
    return data.name
  },

  async listScans(): Promise<ScanListSummary[]> {
    const { data } = await apiClient.get('/weekly-scan/scans')
    return data
  },

  async createScan(name: string): Promise<{ id: string; name: string }> {
    const { data } = await apiClient.post('/weekly-scan/scans', { name })
    return data
  },

  async getScan(id: string): Promise<WeeklyScan> {
    const { data } = await apiClient.get(`/weekly-scan/scans/${id}`)
    return data
  },

  async deleteScan(id: string): Promise<void> {
    await apiClient.delete(`/weekly-scan/scans/${id}`)
  },

  async refreshScan(id: string): Promise<WeeklyScan> {
    const { data } = await apiClient.post(`/weekly-scan/scans/${id}/refresh`)
    return data
  },

  async addItem(scanId: string, symbol: string): Promise<WeeklyScanItem> {
    const { data } = await apiClient.post(`/weekly-scan/scans/${scanId}/items`, { symbol })
    return data
  },

  async upsertItem(scanId: string, symbol: string, fields: Partial<Pick<WeeklyScanItem,
    'color_mark' | 'strategy' | 'buy_price' | 'size' | 'tp' | 'sl' | 'remark'
  >>): Promise<WeeklyScanItem> {
    const { data } = await apiClient.put(`/weekly-scan/scans/${scanId}/items/${symbol}`, fields)
    return data
  },

  async deleteItem(scanId: string, symbol: string): Promise<void> {
    await apiClient.delete(`/weekly-scan/scans/${scanId}/items/${symbol}`)
  },
}

export function colorMarkMeta(mark: ColorMark | null) {
  return COLOR_MARKS.find(c => c.value === mark) ?? null
}
