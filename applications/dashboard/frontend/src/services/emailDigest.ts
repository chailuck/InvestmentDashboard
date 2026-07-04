import { apiClient } from './api'

export interface EmailDigestSettings {
  enabled: boolean
  schedule_time: string  // "HH:MM" format e.g. "17:30"
  recipient: string
}

export const emailDigestService = {
  getSettings: async (): Promise<EmailDigestSettings> => {
    const { data } = await apiClient.get('/email/settings')
    return data
  },
  updateSettings: async (settings: Partial<EmailDigestSettings>): Promise<EmailDigestSettings> => {
    const { data } = await apiClient.put('/email/settings', settings)
    return data
  },
  sendNow: async (): Promise<{ success: boolean; sent_at?: string; error?: string }> => {
    const { data } = await apiClient.post('/email/send-now')
    return data
  },
}
