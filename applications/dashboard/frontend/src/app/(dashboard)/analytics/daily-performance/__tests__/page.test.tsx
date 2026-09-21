import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import DailyPerformancePage from '../page'
import { dailyPerformanceService, type CatchUpResult } from '@/services/dailyPerformance'
import { apiClient } from '@/services/api'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/dailyPerformance', () => ({
  dailyPerformanceService: {
    getRecords: vi.fn(),
    runSnapshot: vi.fn(),
    backfill: vi.fn(),
    catchUp: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
  },
}))

vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

const mockedService = vi.mocked(dailyPerformanceService)
const mockedApiClientGet = apiClient.get as unknown as Mock

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORTFOLIOS = [{ id: 'port-1', name: 'Main Portfolio', is_default: true }]

const NO_HISTORY: CatchUpResult = {
  status: 'no_history',
  message: 'No existing history found for this portfolio.',
  latest_existing_date: null,
  missing_dates_found: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  start_date: null,
  end_date: null,
  partial_failure_note: null,
}

const UP_TO_DATE: CatchUpResult = {
  status: 'up_to_date',
  message: null,
  latest_existing_date: '2026-09-10',
  missing_dates_found: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  start_date: null,
  end_date: '2026-09-10',
  partial_failure_note: null,
}

const COMPLETED_NO_ERRORS: CatchUpResult = {
  status: 'completed',
  message: null,
  latest_existing_date: '2026-09-08',
  missing_dates_found: 3,
  processed: 3,
  skipped: 0,
  errors: 0,
  start_date: '2026-09-09',
  end_date: '2026-09-11',
  partial_failure_note: null,
}

// DEF-001: backend now includes the authoritative "safe to retry" caveat
// only when a run actually left an orphaned date behind (errors > 0).
const PARTIAL_FAILURE_NOTE =
  "Some dates could not be processed and were skipped. Re-running Catch Up will only retry dates from the current " +
  "latest date forward — it will NOT retry a failed date that falls before a later date which succeeded in this run. To " +
  "recover a specific orphaned date, use that row's Refresh action, or run a full Backfill History."

const COMPLETED_WITH_ERRORS: CatchUpResult = {
  status: 'completed',
  message: null,
  latest_existing_date: '2026-09-08',
  missing_dates_found: 3,
  processed: 2,
  skipped: 0,
  errors: 1,
  start_date: '2026-09-09',
  end_date: '2026-09-11',
  partial_failure_note: PARTIAL_FAILURE_NOTE,
}

function setupDefaultMocks() {
  mockedApiClientGet.mockResolvedValue({ data: PORTFOLIOS })
  mockedService.getRecords.mockResolvedValue([])
}

async function renderPageReady() {
  render(<DailyPerformancePage />)
  // Wait for portfolio + initial data load to settle so buttons are enabled.
  await waitFor(() => expect(mockedService.getRecords).toHaveBeenCalled())
  await screen.findByRole('button', { name: /catch up/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaultMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DailyPerformancePage — Catch Up', () => {
  it('renders a "Catch Up" toolbar button', async () => {
    await renderPageReady()
    expect(screen.getByRole('button', { name: /catch up/i })).toBeInTheDocument()
  })

  it('calls dailyPerformanceService.catchUp with the selected portfolio id when clicked', async () => {
    mockedService.catchUp.mockResolvedValue(UP_TO_DATE)
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    await waitFor(() => expect(mockedService.catchUp).toHaveBeenCalledWith('port-1'))
  })

  it('renders a distinct info banner (not an error) for "no_history"', async () => {
    mockedService.catchUp.mockResolvedValue(NO_HISTORY)
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    const banner = await screen.findByText(NO_HISTORY.message!)
    expect(banner.closest('div')).toHaveStyle({ color: '#3b82f6' })
    // No wasted refetch — getRecords was only called once, on initial load.
    expect(mockedService.getRecords).toHaveBeenCalledTimes(1)
  })

  it('renders a distinct info banner (not an error) for "up_to_date" and does not refetch', async () => {
    mockedService.catchUp.mockResolvedValue(UP_TO_DATE)
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    const banner = await screen.findByText(/already up to date through 2026-09-10/i)
    expect(banner.closest('div')).toHaveStyle({ color: '#3b82f6' })
    expect(mockedService.getRecords).toHaveBeenCalledTimes(1)
  })

  it('renders success and triggers a refetch when "completed" with zero errors', async () => {
    mockedService.catchUp.mockResolvedValue(COMPLETED_NO_ERRORS)
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    const banner = await screen.findByText(/caught up 3 day\(s\) of missing history/i)
    expect(banner.closest('div')).toHaveStyle({ color: '#22c55e' })
    await waitFor(() => expect(mockedService.getRecords).toHaveBeenCalledTimes(2))
  })

  it('renders the backend partial_failure_note guidance (not the old "safe to retry" claim) when "completed" with errors > 0', async () => {
    mockedService.catchUp.mockResolvedValue(COMPLETED_WITH_ERRORS)
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    // Counts are still surfaced, and the banner now carries the backend's
    // own DEF-001 guidance instead of the old (inaccurate) generic claim.
    const banner = await screen.findByText(/caught up 2 day\(s\) with 1 error\(s\)/i)
    expect(banner.textContent).toBe(`Caught up 2 day(s) with 1 error(s). ${PARTIAL_FAILURE_NOTE}`)
    expect(banner.closest('div')).toHaveStyle({ color: '#ef4444' })
    expect(banner.textContent).not.toMatch(/safe to retry — catch up is idempotent/i)
    expect(banner.textContent).not.toMatch(/click catch up again/i)
    // Still refetches — records may have partially changed.
    await waitFor(() => expect(mockedService.getRecords).toHaveBeenCalledTimes(2))
  })

  it('falls back to generic non-retryable guidance if the backend omits partial_failure_note', async () => {
    mockedService.catchUp.mockResolvedValue({
      ...COMPLETED_WITH_ERRORS,
      partial_failure_note: null,
    })
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    const banner = await screen.findByText(/caught up 2 day\(s\) with 1 error\(s\)/i)
    expect(banner.textContent).toMatch(/refresh action.*backfill history/i)
    expect(banner.textContent).not.toMatch(/safe to retry — catch up is idempotent/i)
  })

  it('renders a generic failure banner when the request throws', async () => {
    mockedService.catchUp.mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    const banner = await screen.findByText(/catch up failed\. please check the server logs/i)
    expect(banner.closest('div')).toHaveStyle({ color: '#ef4444' })
  })

  it('mutually disables Backfill History, Catch Up, and Run Now while Catch Up is running', async () => {
    let resolveCatchUp: (value: CatchUpResult) => void = () => {}
    mockedService.catchUp.mockImplementation(
      () => new Promise<CatchUpResult>((resolve) => { resolveCatchUp = resolve }),
    )
    const user = userEvent.setup()
    await renderPageReady()

    await user.click(screen.getByRole('button', { name: /catch up/i }))

    expect(screen.getByRole('button', { name: /catching up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /backfill history/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled()

    resolveCatchUp!(UP_TO_DATE)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^catch up$/i })).not.toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: /backfill history/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /run now/i })).not.toBeDisabled()
  })
})
