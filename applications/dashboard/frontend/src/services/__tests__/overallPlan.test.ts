import { describe, it, expect, vi, beforeEach } from 'vitest'
import { overallPlanService, type OverallPlanGenerateResponse } from '@/services/overallPlan'
import { apiClient } from '@/services/api'

// ---------------------------------------------------------------------------
// Mock the API client so no real HTTP requests are made
// ---------------------------------------------------------------------------

vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.post)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('overallPlanService.generate', () => {
  it('calls POST /overall-plan/generate with the action plan and scan ids', async () => {
    const mockResponse: OverallPlanGenerateResponse = {
      filename: 'OVERALL PLAN 20260801.md',
      path: '/data/overall/OVERALL PLAN 20260801.md',
      written_at: '2026-08-01T10:00:00Z',
      action_plan_id: 'plan-1',
      action_plan_name: 'PURCHASE_01_08_2026',
      weekly_scan_id: 'scan-1',
      weekly_scan_name: 'WEEKLY_SCAN_01_08_2026',
      portfolio_id: 'port-1',
      portfolio_name: 'Main Portfolio',
    }
    mockedPost.mockResolvedValueOnce({ data: mockResponse })

    const result = await overallPlanService.generate({
      action_plan_id: 'plan-1',
      weekly_scan_id: 'scan-1',
    })

    expect(mockedPost).toHaveBeenCalledWith('/overall-plan/generate', {
      action_plan_id: 'plan-1',
      weekly_scan_id: 'scan-1',
    })
    expect(result).toEqual(mockResponse)
  })

  it('propagates errors from the API client (e.g. 404 Purchase plan not found)', async () => {
    const err = {
      isAxiosError: true,
      response: { status: 404, data: { detail: 'Purchase plan not found' } },
    }
    mockedPost.mockRejectedValueOnce(err)

    await expect(
      overallPlanService.generate({ action_plan_id: 'missing', weekly_scan_id: 'scan-1' }),
    ).rejects.toEqual(err)
  })
})
