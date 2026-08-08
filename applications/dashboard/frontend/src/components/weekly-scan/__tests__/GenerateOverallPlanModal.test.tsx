import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { GenerateOverallPlanModal } from '../GenerateOverallPlanModal'
import { actionPlanService, type PlanSummary } from '@/services/actionPlan'
import { weeklyScanService, type ScanListSummary } from '@/services/weeklyScan'
import { overallPlanService, type OverallPlanGenerateResponse } from '@/services/overallPlan'
import toast from 'react-hot-toast'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/actionPlan', () => ({
  actionPlanService: { list: vi.fn() },
}))

vi.mock('@/services/weeklyScan', () => ({
  weeklyScanService: { listScans: vi.fn() },
}))

vi.mock('@/services/overallPlan', () => ({
  overallPlanService: { generate: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mockedListPlans = vi.mocked(actionPlanService.list)
const mockedListScans = vi.mocked(weeklyScanService.listScans)
const mockedGenerate = vi.mocked(overallPlanService.generate)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLANS: PlanSummary[] = [
  { id: 'plan-old', name: 'PURCHASE_01_07_2026', plan_type: 'purchase', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', symbols: 'BH,KBANK' },
  { id: 'plan-new', name: 'PURCHASE_01_08_2026', plan_type: 'purchase', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', symbols: 'ADVANC' },
]

const SCANS: ScanListSummary[] = [
  { id: 'scan-current', name: 'WEEKLY_SCAN_CURRENT', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', total: 10, color_counts: { CYAN: 1, GREEN: 1, YELLOW: 1, RED: 1, PURPLE: 1, NONE: 5 } },
  { id: 'scan-other', name: 'WEEKLY_SCAN_OTHER', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', total: 8, color_counts: { CYAN: 0, GREEN: 0, YELLOW: 0, RED: 0, PURPLE: 0, NONE: 8 } },
]

const SUCCESS_RESPONSE: OverallPlanGenerateResponse = {
  filename: 'OVERALL PLAN 20260801.md',
  path: '/data/overall/OVERALL PLAN 20260801.md',
  written_at: '2026-08-01T10:00:00Z',
  action_plan_id: 'plan-new',
  action_plan_name: 'PURCHASE_01_08_2026',
  weekly_scan_id: 'scan-current',
  weekly_scan_name: 'WEEKLY_SCAN_CURRENT',
  portfolio_id: 'port-1',
  portfolio_name: 'Main Portfolio',
}

function renderModal(overrides: Partial<{ scanId: string }> = {}) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(
    <GenerateOverallPlanModal
      scanId={overrides.scanId ?? 'scan-current'}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  )
  return { onClose, onSuccess }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedListPlans.mockResolvedValue(PLANS)
  mockedListScans.mockResolvedValue(SCANS)
})

// ---------------------------------------------------------------------------
// Default selections
// ---------------------------------------------------------------------------

describe('GenerateOverallPlanModal — default selections', () => {
  it('defaults the purchase plan dropdown to the most recent plan', async () => {
    renderModal()

    const planSelect = await screen.findByLabelText<HTMLSelectElement>('Purchase Action Plan')
    await waitFor(() => expect(planSelect.value).toBe('plan-new'))
  })

  it('defaults the weekly scan dropdown to the scan id from the page (prop), not the most recent', async () => {
    // scan-current is NOT the newest by created_at among SCANS in this fixture ordering test —
    // both share the same created_at as "current"; use a distinct prop to prove it's driven by
    // the prop rather than recency.
    renderModal({ scanId: 'scan-other' })

    const scanSelect = await screen.findByLabelText<HTMLSelectElement>('Weekly Scan')
    await waitFor(() => expect(scanSelect.value).toBe('scan-other'))
  })
})

// ---------------------------------------------------------------------------
// Dropdown population
// ---------------------------------------------------------------------------

describe('GenerateOverallPlanModal — dropdown population', () => {
  it('populates the purchase plan dropdown from the mocked API response', async () => {
    renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    expect(screen.getByText('PURCHASE_01_07_2026')).toBeInTheDocument()
  })

  it('populates the weekly scan dropdown from the mocked API response', async () => {
    renderModal()

    await screen.findByText('WEEKLY_SCAN_CURRENT')
    expect(screen.getByText('WEEKLY_SCAN_OTHER')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Confirm / generate
// ---------------------------------------------------------------------------

describe('GenerateOverallPlanModal — confirm', () => {
  it('calls overallPlanService.generate with the selected ids and reports success', async () => {
    mockedGenerate.mockResolvedValueOnce(SUCCESS_RESPONSE)
    const user = userEvent.setup()
    const { onSuccess } = renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith({
        action_plan_id: 'plan-new',
        weekly_scan_id: 'scan-current',
      })
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(SUCCESS_RESPONSE))
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('OVERALL PLAN 20260801.md'))
  })

  it('sends the ids chosen by the user when they change the selections', async () => {
    mockedGenerate.mockResolvedValueOnce(SUCCESS_RESPONSE)
    const user = userEvent.setup()
    renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    await user.selectOptions(screen.getByLabelText('Purchase Action Plan'), 'plan-old')
    await user.selectOptions(screen.getByLabelText('Weekly Scan'), 'scan-other')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => {
      expect(mockedGenerate).toHaveBeenCalledWith({
        action_plan_id: 'plan-old',
        weekly_scan_id: 'scan-other',
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

describe('GenerateOverallPlanModal — error responses', () => {
  async function triggerGenerateWithError(detail: string) {
    mockedGenerate.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { detail } },
    })
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText(detail)
    return { onClose }
  }

  it('renders "Purchase plan not found" inline and keeps the modal open', async () => {
    const { onClose } = await triggerGenerateWithError('Purchase plan not found')
    expect(onClose).not.toHaveBeenCalled()
    // Dropdowns remain interactive for re-selection
    expect(screen.getByLabelText('Purchase Action Plan')).not.toBeDisabled()
  })

  it('renders "Weekly scan not found" inline and keeps the modal open', async () => {
    const { onClose } = await triggerGenerateWithError('Weekly scan not found')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders the 422 "no default portfolio" message inline', async () => {
    mockedGenerate.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { detail: 'No default portfolio configured for this user' } },
    })
    const user = userEvent.setup()
    renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('No default portfolio configured for this user')).toBeInTheDocument()
  })

  it('renders the 500 "failed to write" message inline and allows retry', async () => {
    mockedGenerate.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { detail: 'Failed to write overall plan file' } },
    })
    mockedGenerate.mockResolvedValueOnce(SUCCESS_RESPONSE)
    const user = userEvent.setup()
    const { onSuccess } = renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    const generateBtn = screen.getByRole('button', { name: 'Generate' })

    await user.click(generateBtn)
    expect(await screen.findByText('Failed to write overall plan file')).toBeInTheDocument()

    // Retry — button should be enabled again and a second click should succeed
    expect(generateBtn).not.toBeDisabled()
    await user.click(generateBtn)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(SUCCESS_RESPONSE))
  })
})

// ---------------------------------------------------------------------------
// Disabled states
// ---------------------------------------------------------------------------

describe('GenerateOverallPlanModal — disabled states', () => {
  it('disables Generate and shows a message when no purchase plans exist', async () => {
    mockedListPlans.mockResolvedValue([])
    renderModal()

    await screen.findByText(/No purchase plans found/i)
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  })

  it('disables Generate and shows a message when no weekly scans exist', async () => {
    mockedListScans.mockResolvedValue([])
    renderModal()

    await screen.findByText(/No weekly scans found/i)
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  })

  it('disables Generate while the request is in-flight (prevents double-submit)', async () => {
    let resolveGenerate: (v: OverallPlanGenerateResponse) => void = () => {}
    mockedGenerate.mockReturnValueOnce(
      new Promise(resolve => { resolveGenerate = resolve }),
    )
    const user = userEvent.setup()
    renderModal()

    await screen.findByText('PURCHASE_01_08_2026')
    const generateBtn = screen.getByRole('button', { name: 'Generate' })
    await user.click(generateBtn)

    await waitFor(() => expect(generateBtn).toBeDisabled())
    expect(mockedGenerate).toHaveBeenCalledTimes(1)

    // Clean up the pending promise so it doesn't leak into other tests
    resolveGenerate(SUCCESS_RESPONSE)
  })
})
