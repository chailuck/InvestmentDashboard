import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingUpdatesPage from '../page'
import { trackingService } from '@/services/tracking'
import { updateTrackingService } from '@/services/updateTracking'
import type { TrackingSet } from '@/services/tracking'
import type { UpdateTrackingList } from '@/services/updateTracking'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tracking/updates',
}))

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listSets: vi.fn(),
  },
}))

vi.mock('@/services/updateTracking', () => ({
  updateTrackingService: {
    listUpdateLists: vi.fn(),
    createUpdateList: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mockedTracking = vi.mocked(trackingService)
const mockedUpdateTracking = vi.mocked(updateTrackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SETS: TrackingSet[] = [
  { id: 'set-1', name: 'Main Set', description: null, createdAt: '', updatedAt: '' },
  { id: 'set-2', name: 'Retirement', description: null, createdAt: '', updatedAt: '' },
]

const LISTS: UpdateTrackingList[] = [
  { id: 'ul-2', trackingSetId: 'set-1', transactionDate: '2026-06-30', quarter: 2, year: 2026, createdAt: '', updatedAt: '' },
  { id: 'ul-1', trackingSetId: 'set-1', transactionDate: '2026-03-31', quarter: null, year: null, createdAt: '', updatedAt: '' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockedTracking.listSets.mockResolvedValue(SETS)
  mockedUpdateTracking.listUpdateLists.mockImplementation(async (setId: string) =>
    setId === 'set-1' ? LISTS : [],
  )
})

// ---------------------------------------------------------------------------
// Set selector + list rendering
// ---------------------------------------------------------------------------

describe('TrackingUpdatesPage — rendering', () => {
  it('loads sets, defaults to the first set, and renders its update lists most-recent-first (server order)', async () => {
    render(<TrackingUpdatesPage />)

    const select = await screen.findByLabelText('Tracking Set') as HTMLSelectElement
    expect(select.value).toBe('set-1')

    await screen.findByText('Q2')
    const rows = screen.getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/tracking/updates/'))
    // Server already returns most-recent-first; the page must preserve that order.
    expect(rows[0]).toHaveAttribute('href', '/tracking/updates/ul-2')
    expect(rows[1]).toHaveAttribute('href', '/tracking/updates/ul-1')
  })

  it('shows Quarter and Year as two separate columns, with a dash for a list with neither set', async () => {
    render(<TrackingUpdatesPage />)
    await screen.findByText('Q2')
    expect(screen.getByText('2026')).toBeInTheDocument()
    // The 'ul-1' row has quarter=null, year=null — two separate dash cells.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows an empty state when the selected set has zero update lists', async () => {
    mockedUpdateTracking.listUpdateLists.mockResolvedValue([])
    render(<TrackingUpdatesPage />)

    expect(await screen.findByText(/No update lists yet/i)).toBeInTheDocument()
  })

  it('shows an empty state when no tracking sets exist yet', async () => {
    mockedTracking.listSets.mockResolvedValue([])
    render(<TrackingUpdatesPage />)

    expect(await screen.findByText(/No tracking sets yet/i)).toBeInTheDocument()
    expect(await screen.findByText(/Create a tracking set on the Category page/i)).toBeInTheDocument()
  })

  it('shows an error state when tracking sets fail to load', async () => {
    mockedTracking.listSets.mockRejectedValue(new Error('boom'))
    render(<TrackingUpdatesPage />)

    expect(await screen.findByText(/Failed to load tracking sets/i)).toBeInTheDocument()
  })

  it('shows an error state when update lists fail to load', async () => {
    mockedUpdateTracking.listUpdateLists.mockRejectedValue(new Error('boom'))
    render(<TrackingUpdatesPage />)

    expect(await screen.findByText(/Failed to load update lists/i)).toBeInTheDocument()
  })

  it('re-fetches update lists when a different tracking set is selected', async () => {
    const user = userEvent.setup()
    render(<TrackingUpdatesPage />)
    await screen.findByText('Q2')

    await user.selectOptions(screen.getByLabelText('Tracking Set'), 'set-2')

    await waitFor(() => {
      expect(mockedUpdateTracking.listUpdateLists).toHaveBeenCalledWith('set-2')
    })
  })
})

// ---------------------------------------------------------------------------
// Create Update List flow
// ---------------------------------------------------------------------------

describe('TrackingUpdatesPage — create update list', () => {
  it('creates a new update list for the selected set and navigates to its detail page', async () => {
    const user = userEvent.setup()
    const created: UpdateTrackingList = {
      id: 'ul-new', trackingSetId: 'set-1', transactionDate: '2026-08-24', quarter: 3, year: 2026, createdAt: '', updatedAt: '',
    }
    mockedUpdateTracking.createUpdateList.mockResolvedValueOnce(created)

    render(<TrackingUpdatesPage />)
    await screen.findByText('Q2')

    await user.click(screen.getByRole('button', { name: /Create New List/i }))
    // Native date inputs always carry their value as an ISO yyyy-MM-dd string
    // regardless of display locale — set it directly via fireEvent rather
    // than simulating keystrokes, which is unreliable for type="date" inputs.
    const dateInput = screen.getByLabelText('Transaction Date')
    fireEvent.change(dateInput, { target: { value: '2026-08-24' } })
    await user.selectOptions(screen.getByLabelText(/Quarter/i), '3')
    await user.type(screen.getByLabelText(/Year/i), '2026')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mockedUpdateTracking.createUpdateList).toHaveBeenCalledWith('set-1', {
        transactionDate: '2026-08-24', quarter: 3, year: 2026,
      })
    })
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tracking/updates/ul-new')
    })
  })

  it('shows the backend error inline and keeps the modal open on failure', async () => {
    const user = userEvent.setup()
    mockedUpdateTracking.createUpdateList.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'transactionDate is required' } },
    })

    render(<TrackingUpdatesPage />)
    await screen.findByText('Q2')

    await user.click(screen.getByRole('button', { name: /Create New List/i }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('transactionDate is required')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
