import { apiClient } from './api'

export interface AppConfig {
  excel_source_path: string
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
}

export async function getDocContent(docName: 'requirements' | 'design'): Promise<{ content: string; filename: string }> {
  const { data } = await apiClient.get(`/docs-content/${docName}`)
  return data
}
