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

  // ── Clone feature ──────────────────────────────────────────────────────────

  async clonePreflight(sourceUserId: string, targetUserId: string): Promise<ClonePreflightResponse> {
    const { data } = await apiClient.post(`/users/${sourceUserId}/clone-preflight`, {
      target_user_id: targetUserId,
    })
    return data
  },

  async cloneExecute(
    sourceUserId: string,
    targetUserId: string,
    portfolioModeOverride: 'excel' | 'db' | null,
  ): Promise<CloneExecuteResponse> {
    const body: {
      target_user_id: string
      confirmed: boolean
      portfolio_mode_override?: 'excel' | 'db'
    } = {
      target_user_id: targetUserId,
      confirmed: true,
    }
    if (portfolioModeOverride !== null) {
      body.portfolio_mode_override = portfolioModeOverride
    }
    const { data } = await apiClient.post(`/users/${sourceUserId}/clone`, body)
    return data
  },
}

// ── Clone feature types ────────────────────────────────────────────────────

export interface TableCounts {
  portfolios: number
  holdings: number
  investment_transactions: number
  portfolio_positions_db: number
  action_plans: number
  purchase_plan_items: number
  portfolio_plan_items: number
  user_scan_configs: number
  user_symbol_lists: number
  weekly_scans: number
  weekly_scan_items: number
  pe_scan_results: number
  symbol_notes: number
  weekly_reviews: number
  weekly_review_items: number
}

export interface ClonePreflightResponse {
  source_user_id: string
  source_user_name: string
  target_user_id: string
  target_user_name: string
  source_counts: TableCounts
  target_existing_counts: TableCounts
  target_has_data: boolean
}

export interface CloneExecuteResponse {
  cloned_by_admin_id: string
  cloned_by_admin_name: string
  source_user_id: string
  source_user_name: string
  target_user_id: string
  target_user_name: string
  portfolio_mode_applied: string
  cloned_at: string
  rows_cloned: TableCounts
  total_rows_cloned: number
}
