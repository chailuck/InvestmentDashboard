import axios, { type AxiosInstance, type AxiosError } from 'axios'
import { useAuthStore } from '@/store/auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

// Attach access token
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-refresh on 401
apiClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as any
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const { refreshToken, setTokens } = useAuthStore.getState()
        const { data } = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, { refreshToken })
        setTokens(data)
        original.headers.Authorization = `Bearer ${data.accessToken}`
        return apiClient(original)
      } catch {
        useAuthStore.getState().clearAuth()
      }
    }
    return Promise.reject(error)
  }
)

export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as any
    return data?.detail ?? data?.message ?? err.message ?? 'Request failed'
  }
  return 'An unexpected error occurred'
}
