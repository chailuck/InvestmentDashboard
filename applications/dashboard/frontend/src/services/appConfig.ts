import { apiClient } from './api'

export interface AppConfig {
  excel_source_path: string
  excel_working_path: string
  pe_threshold: number
  price_threshold: number
}

export const appConfigService = {
  async get(): Promise<AppConfig> {
    const { data } = await apiClient.get('/app-config')
    return data
  },

  async update(updates: Partial<AppConfig>): Promise<AppConfig> {
    const { data } = await apiClient.put('/app-config', updates)
    return data
  },

  async testPath(path: string): Promise<{ ok: boolean; message: string }> {
    const { data } = await apiClient.post('/app-config/test-path', { excel_source_path: path })
    return data
  },
}

export async function getDocContent(docName: 'requirements' | 'design'): Promise<{ content: string; filename: string }> {
  const { data } = await apiClient.get(`/docs-content/${docName}`)
  return data
}
