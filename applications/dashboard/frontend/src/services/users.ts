import { apiClient } from './api'
import type { UserDetail, UserListResponse } from '@/types'

export interface CreateUserPayload {
  email: string
  name: string
  password: string
  role: 'admin' | 'analyst' | 'viewer'
  is_active: boolean
}

export interface UpdateUserPayload {
  name?: string
  email?: string
  role?: 'admin' | 'analyst' | 'viewer'
  is_active?: boolean
}

export interface ListUsersParams {
  page?: number
  page_size?: number
  role?: string
  is_active?: boolean
  search?: string
}

export const usersService = {
  async list(params: ListUsersParams = {}): Promise<UserListResponse> {
    const { data } = await apiClient.get('/users', { params })
    return data
  },

  async get(id: string): Promise<UserDetail> {
    const { data } = await apiClient.get(`/users/${id}`)
    return data
  },

  async create(payload: CreateUserPayload): Promise<UserDetail> {
    const { data } = await apiClient.post('/users', payload)
    return data
  },

  async update(id: string, payload: UpdateUserPayload): Promise<UserDetail> {
    const { data } = await apiClient.put(`/users/${id}`, payload)
    return data
  },

  async deactivate(id: string): Promise<UserDetail> {
    const { data } = await apiClient.post(`/users/${id}/deactivate`)
    return data
  },

  async activate(id: string): Promise<UserDetail> {
    const { data } = await apiClient.post(`/users/${id}/activate`)
    return data
  },

  async adminResetPassword(id: string, newPassword: string): Promise<void> {
    await apiClient.post(`/users/${id}/reset-password`, { new_password: newPassword })
  },

  async changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/users/me/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  },

  async forgotPassword(email: string): Promise<{ message: string; reset_token?: string }> {
    const { data } = await apiClient.post('/auth/forgot-password', { email })
    return data
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/reset-password', { token, new_password: newPassword })
  },
}
