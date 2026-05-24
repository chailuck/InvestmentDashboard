import { apiClient } from './api'
import type { AuthTokens, User } from '@/types'

export const authService = {
  async login(email: string, password: string): Promise<{ tokens: AuthTokens; user: User }> {
    const { data } = await apiClient.post('/auth/login', { email, password })
    return {
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      },
      user: data.user,
    }
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { data } = await apiClient.post('/auth/refresh', { refresh_token: refreshToken })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout').catch(() => {})
  },

  async me(): Promise<User> {
    const { data } = await apiClient.get('/auth/me')
    return data
  },
}
