import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import ActionPlanPage from '../page'
import { actionPlanService, type PlanSummary } from '@/services/actionPlan'
import { weeklyScanService, type ScanListSummary } from '@/services/weeklyScan'
import { reviewListService, type ReviewSummary } from '@/services/reviewList'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/actionPlan', () => ({
  actionPlanService: {
    list: vi.fn(),
    suggestName: vi.fn().mockResolvedValue('SUGGESTED'),
    create: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
}))

vi.mock('@/services/weeklyScan', () => ({
  weeklyScanService: {
    listScans: vi.fn(),
    suggestName: vi.fn().mockResolvedValue('SUGGESTED_SCAN'),
    createScan: vi.fn(),
    deleteScan: vi.fn(),
    getScan: vi.fn(),
  },
  COLOR_MARKS: [
    { value: 'CYAN', label: 'Cyan', dot: 'bg-cyan-400', text: 'text-cyan-400' },
    { value: 'GREEN', label: 'Green', dot: 'bg-green-400', text: 'text-green-400' },
    { value: 'YELLOW', label: 'Yellow', dot: 'bg-yellow-400', text: 'text-yellow-400' },
    { value: 'RED', label: 'Red', dot: 'bg-red-400', text: 'text-red-400' },
    { value: 'PURPLE', label: 'Purple', dot: 'bg-purple-400', text: 'text-purple-400' },
    { value: 'NONE', label: 'None', dot: 'bg-gray-400', text: 'text-gray-400' },
  ],
}))

vi.mock('@/services/reviewList', () => ({
  reviewListService: {
    getCurrentWeek: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/services/portfolioDb', () => ({
  portfolioDbService: { getPositions: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/services/objective', () => ({
  objectiveService: { list: vi.fn().mockResolvedValue({ items: [] }) },
}))

vi.mock('@/services/portfolio', () => ({
  portfolioService: { list: vi.fn().mockResolvedValue([]) },
}))

// The Weekly Plan Dashboard tab is not under test here — stub it out so its
// own (unrelated) data dependencies don't need mocking.
vi.mock('@/components/action-plan/WeeklyPlanDashboard', () => ({
  WeeklyPlanDashboard: () => <div data-testid="weekly-plan-dashboard" />,
}))

const mockedListPlans = vi.mocked(actionPlanService.list)
const mockedListScans = vi.mocked(weeklyScanService.listScans)
const mockedGetCurrentWeek = vi.mocked(reviewListService.getCurrentWeek)
const mockedListReviews = vi.mocked(reviewListService.list)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PURCHASE_PLANS: PlanSummary[] = [
  { id: 'p1', name: 'PURCHASE_1', plan_type: 'purchase', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', symbols: 'ADVANC' },
]

const SCANS: ScanListSummary[] = [
  { id: 's1', name: 'SCAN_1', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', total: 5, color_counts: { CYAN: 1, GREEN: 1, YELLOW: 1, RED: 1, PURPLE: 1, NONE: 0 } },
]

const REVIEWS: ReviewSummary[] = [
  { id: 'r1', name: 'Week 1', week_start: '2026-07-27', week_end: '2026-08-02', trade_count: 2, hold_count: 1, updated_at: '2026-08-01T00:00:00Z' } as ReviewSummary,
]

async function renderPlansTab() {
  render(<ActionPlanPage />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Plans/i }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedListPlans.mockImplementation((type: string) =>
    Promise.resolve(type === 'purchase' ? PURCHASE_PLANS : []),
  )
  mockedListScans.mockResolvedValue(SCANS)
  mockedGetCurrentWeek.mockResolvedValue(REVIEWS[0])
  mockedListReviews.mockResolvedValue(REVIEWS)
})

// ---------------------------------------------------------------------------
// Section order / visibility
// ---------------------------------------------------------------------------

describe('ActionPlanPage — Plans tab layout', () => {
  it('renders Weekly Scans, Purchase Action Plan, and Review List in that order', async () => {
    await renderPlansTab()

    await screen.findByText('Weekly Scans')
    const headings = await screen.findAllByRole('heading', { level: 2 })
    const headingTexts = headings.map(h => h.textContent)

    const weeklyIdx = headingTexts.indexOf('Weekly Scans')
    const purchaseIdx = headingTexts.indexOf('Purchase Action Plan')
    const reviewIdx = headingTexts.indexOf('Review List')

    expect(weeklyIdx).toBeGreaterThanOrEqual(0)
    expect(purchaseIdx).toBeGreaterThan(weeklyIdx)
    expect(reviewIdx).toBeGreaterThan(purchaseIdx)
  })

  it('does not render the Portfolio Action Plan section', async () => {
    await renderPlansTab()

    await screen.findByText('Weekly Scans')
    expect(screen.queryByText('Portfolio Action Plan')).not.toBeInTheDocument()
  })

  it('renders separate "Generate Overall Plan" and "Download Overall Plan" buttons', async () => {
    await renderPlansTab()

    expect(await screen.findByRole('button', { name: /Generate Overall Plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download Overall Plan/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Export All MD$/i })).not.toBeInTheDocument()
  })

  it('opens the Generate Overall Plan modal without requiring a scan id', async () => {
    const user = await renderPlansTab()
    await user.click(screen.getByRole('button', { name: /Generate Overall Plan/i }))

    expect(await screen.findByRole('dialog', { name: /Generate Overall Plan/i })).toBeInTheDocument()
  })

  it('shows an expand toggle for the weekly scan table only when more than 5 scans exist', async () => {
    const manyScans: ScanListSummary[] = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`,
      name: `SCAN_${i}`,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      total: 1,
      color_counts: { CYAN: 0, GREEN: 0, YELLOW: 0, RED: 0, PURPLE: 0, NONE: 1 },
    }))
    mockedListScans.mockResolvedValue(manyScans)

    await renderPlansTab()

    await screen.findByText('SCAN_0')
    expect(screen.queryByText('SCAN_6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show all \(7\)/i })).toBeInTheDocument()
  })
})
