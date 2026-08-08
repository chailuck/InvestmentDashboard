import { apiClient } from './api'

// ── Request / response shapes ────────────────────────────────────────────────

export interface OverallPlanGenerateRequest {
  action_plan_id: string
  weekly_scan_id: string
}

export interface OverallPlanGenerateResponse {
  filename: string
  path: string
  written_at: string
  action_plan_id: string
  action_plan_name: string
  weekly_scan_id: string
  weekly_scan_name: string
  portfolio_id: string
  portfolio_name: string
}

// ── Service ───────────────────────────────────────────────────────────────────

export const overallPlanService = {
  /**
   * Trigger server-side generation of the combined "Overall Plan" markdown file
   * from a purchase action plan + a weekly scan. The server resolves the
   * portfolio automatically (single default portfolio per user) and writes the
   * file — this call is a thin trigger, no markdown assembly happens client-side.
   */
  async generate(payload: OverallPlanGenerateRequest): Promise<OverallPlanGenerateResponse> {
    const { data } = await apiClient.post('/overall-plan/generate', payload)
    return data as OverallPlanGenerateResponse
  },
}
