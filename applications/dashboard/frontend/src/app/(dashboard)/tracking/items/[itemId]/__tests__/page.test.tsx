import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingItemDetailPage from '../page'
import { trackingService } from '@/services/tracking'
import type { TrackingItem, RunningTotal, ProfitVsOriginal } from '@/services/tracking'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ itemId: 'item-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tracking/items/item-1',
}))

vi.mock('@/services/tracking', () => ({
  trackingService: {
    getItem: vi.fn(),
    updateItem: vi.fn(),
    listEntries: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    getRunningTotal: vi.fn(),
  },
  TRACKING_ITEM_TYPES: [
    'Bank account', 'Property', 'Investment Account', 'TaxSaving', 'Materials', 'Insurance',
  ],
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mocked = vi.mocked(trackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_NO_TRACKING: TrackingItem = {
  id: 'item-1', subCategoryId: 'sub-1', name: 'Cash Account', type: 'Bank account',
  initialInvestmentTracking: false, exclusive: false, order: 0,
  description: null, accountName: 'xxx-123', remark: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

const ITEM_WITH_TRACKING: TrackingItem = {
  ...ITEM_NO_TRACKING,
  initialInvestmentTracking: true,
}

/** A "covered" profit block: entries present AND a current-value snapshot present. */
const COVERED_PROFIT: ProfitVsOriginal = {
  netOriginalInvestment: 1500,
  currentValue: 1825,
  currentValueSlot: { year: 2026, quarter: 2 },
  profit: 325,
  profitPercent: 21.67,
  isCovered: true,
}

/** A "no snapshot" profit block: entries may exist, but no update-list balance yet — every figure null. */
const NO_SNAPSHOT_PROFIT: ProfitVsOriginal = {
  netOriginalInvestment: null,
  currentValue: null,
  currentValueSlot: null,
  profit: null,
  profitPercent: null,
  isCovered: false,
}

const RUNNING_TOTAL: RunningTotal = {
  itemId: 'item-1',
  currentTotal: 1500,
  entries: [
    { id: 'e1', trackingItemId: 'item-1', amount: 1000, entryDate: '2026-01-01', note: 'initial buy', createdAt: '', updatedAt: '', runningTotal: 1000 },
    { id: 'e2', trackingItemId: 'item-1', amount: 500, entryDate: '2026-02-01', note: null, createdAt: '', updatedAt: '', runningTotal: 1500 },
  ],
  profitVsOriginal: COVERED_PROFIT,
}

/** Convenience builder for the many "empty ledger" running-total mocks below. */
const emptyRunningTotal = (): RunningTotal => ({
  itemId: 'item-1', currentTotal: 0, entries: [], profitVsOriginal: NO_SNAPSHOT_PROFIT,
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Basic rendering + back link
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — rendering', () => {
  it('renders the item fields and a back-to-Category link', async () => {
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)

    render(<TrackingItemDetailPage />)

    expect(await screen.findByDisplayValue('Cash Account')).toBeInTheDocument()
    const backLink = screen.getByRole('link', { name: /Back to Category page/i })
    expect(backLink).toHaveAttribute('href', '/tracking/category')
  })

  it('shows a loading state, then an error state on failure', async () => {
    mocked.getItem.mockRejectedValue(new Error('not found'))

    render(<TrackingItemDetailPage />)

    expect(await screen.findByText(/Failed to load this tracking item/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Conditional ledger rendering — the core Phase 1 requirement
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — conditional ledger section', () => {
  it('hides the ledger section when Initial Investment Tracking is No', async () => {
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)

    render(<TrackingItemDetailPage />)

    await screen.findByDisplayValue('Cash Account')
    expect(screen.queryByText('Initial Investment Ledger')).not.toBeInTheDocument()
    expect(mocked.getRunningTotal).not.toHaveBeenCalled()
  })

  it('shows the ledger section with entries when Initial Investment Tracking is Yes', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(RUNNING_TOTAL)

    render(<TrackingItemDetailPage />)

    await screen.findByDisplayValue('Cash Account')
    expect(await screen.findByText('Initial Investment Ledger')).toBeInTheDocument()
    const currentTotalLine = (await screen.findByText(/Current total/i)).closest('p')!
    expect(currentTotalLine).toHaveTextContent('+1500.00')
  })

  it('does NOT reveal the ledger section when the toggle is flipped to Yes but not yet saved', async () => {
    // The backend 400s GET running-total / POST entries until the item's
    // PERSISTED initialInvestmentTracking flag is true (see
    // tracking-backend/app/api/v1/endpoints/tracking_items.py). Mounting the
    // ledger off the local, unsaved toggle state would fire a doomed query
    // the instant the user flips the toggle but before they click Save.
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')
    expect(screen.queryByText('Initial Investment Ledger')).not.toBeInTheDocument()

    const toggleGroup = screen.getByRole('group', { name: 'Initial Investment Tracking' })
    const yesButton = within(toggleGroup).getByRole('button', { name: 'Yes' })
    await user.click(yesButton)

    // The toggle control itself reflects the pending edit...
    expect(yesButton).toHaveAttribute('aria-pressed', 'true')
    // ...but the ledger must stay hidden, and its query must not fire, until
    // the flag is actually persisted.
    expect(screen.queryByText('Initial Investment Ledger')).not.toBeInTheDocument()
    expect(mocked.getRunningTotal).not.toHaveBeenCalled()
  })

  it('reveals the ledger section only after Save completes and the item refetches with the persisted flag', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValueOnce(ITEM_NO_TRACKING)
    mocked.updateItem.mockResolvedValueOnce(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')

    const toggleGroup = screen.getByRole('group', { name: 'Initial Investment Tracking' })
    await user.click(within(toggleGroup).getByRole('button', { name: 'Yes' }))
    expect(screen.queryByText('Initial Investment Ledger')).not.toBeInTheDocument()

    // Once Save succeeds, the item query is invalidated and refetched — this
    // time the server returns the flag as persisted.
    mocked.getItem.mockResolvedValueOnce(ITEM_WITH_TRACKING)
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    expect(await screen.findByText('Initial Investment Ledger')).toBeInTheDocument()
  })

  it('models the backend 400 that would occur if the ledger query ever fired before the flag is persisted', async () => {
    // Companion test for the fix above: if this regresses and the ledger
    // section is ever gated back on the unsaved form state, this captures
    // what the user would see — the backend's 400 "not enabled" detail.
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)
    mocked.getRunningTotal.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Initial investment tracking is not enabled for this item' } },
    })

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')

    // Correctly gated: the ledger section never mounts while unsaved, so its
    // query never fires and the 400 is never reached.
    expect(mocked.getRunningTotal).not.toHaveBeenCalled()
  })

  it('allows adding an entry once the ledger is visible', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())
    mocked.createEntry.mockResolvedValueOnce({ id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: null, createdAt: '', updatedAt: '' })

    render(<TrackingItemDetailPage />)
    await screen.findByText('Initial Investment Ledger')

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    await user.type(screen.getByLabelText(/Amount/i), '2000')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createEntry).toHaveBeenCalledWith('item-1', expect.objectContaining({ amount: 2000 }))
    })
  })

  it('rejects a zero amount entry client-side', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())

    render(<TrackingItemDetailPage />)
    await screen.findByText('Initial Investment Ledger')

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    await user.type(screen.getByLabelText(/Amount/i), '0')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(/non-zero/i)).toBeInTheDocument()
    expect(mocked.createEntry).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Saving item fields
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — save', () => {
  it('saves updated fields via updateItem', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)
    mocked.updateItem.mockResolvedValueOnce({ ...ITEM_NO_TRACKING, name: 'Cash Account Renamed' })

    render(<TrackingItemDetailPage />)
    const nameInput = await screen.findByDisplayValue('Cash Account')
    await user.clear(nameInput)
    await user.type(nameInput, 'Cash Account Renamed')
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(mocked.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ name: 'Cash Account Renamed' }))
    })
  })

  it('shows the backend error inline on save failure', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING)
    mocked.updateItem.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Name is required' } },
    })

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Ledger entry note field (EntryForm + ledger table Note column)
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — ledger entry note', () => {
  it('renders an optional multiline Note field in the add form and submits a trimmed note', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())
    mocked.createEntry.mockResolvedValueOnce({
      id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: 'bonus', createdAt: '', updatedAt: '',
    })

    render(<TrackingItemDetailPage />)
    await screen.findByText('Initial Investment Ledger')

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    await user.type(screen.getByLabelText(/Amount/i), '2000')
    const noteField = screen.getByLabelText(/Note \(optional\)/i)
    expect(noteField.tagName).toBe('TEXTAREA')
    expect(noteField).toHaveAttribute('maxlength', '500')
    await user.type(noteField, '   bonus   ')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createEntry).toHaveBeenCalledWith('item-1', expect.objectContaining({ amount: 2000, note: 'bonus' }))
    })
  })

  it('submits note as null when the Note field is left blank', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())
    mocked.createEntry.mockResolvedValueOnce({
      id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: null, createdAt: '', updatedAt: '',
    })

    render(<TrackingItemDetailPage />)
    await screen.findByText('Initial Investment Ledger')

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    await user.type(screen.getByLabelText(/Amount/i), '2000')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createEntry).toHaveBeenCalledWith('item-1', expect.objectContaining({ amount: 2000, note: null }))
    })
  })

  it('hydrates the Note field from the existing entry in edit mode and threads it through updateEntry', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(RUNNING_TOTAL)
    mocked.updateEntry.mockResolvedValueOnce({
      id: 'e1', trackingItemId: 'item-1', amount: 1000, entryDate: '2026-01-01', note: 'initial buy', createdAt: '', updatedAt: '',
    })

    render(<TrackingItemDetailPage />)
    await screen.findByRole('button', { name: /Edit entry on 01 Jan 2026/i })

    await user.click(screen.getByRole('button', { name: /Edit entry on 01 Jan 2026/i }))
    expect(screen.getByLabelText(/Note \(optional\)/i)).toHaveValue('initial buy')

    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(mocked.updateEntry).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: 1000, note: 'initial buy' }))
    })
  })

  it('renders a Note column in the ledger table: the note text for a set note, an em dash for a null note', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(RUNNING_TOTAL)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Note' })

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(['Date', 'Amount', 'Running Total', 'Note', 'Actions'])

    // e1 has note 'initial buy'; e2 has note null -> "—".
    const e1Row = screen.getByText('initial buy').closest('tr')!
    expect(within(e1Row).getByText('01 Jan 2026')).toBeInTheDocument()
    const e2Row = screen.getByText('01 Feb 2026').closest('tr')!
    const e2NoteCell = within(e2Row).getAllByRole('cell')[3]
    expect(e2NoteCell).toHaveTextContent('—')
  })
})

// ---------------------------------------------------------------------------
// Profit vs Original panel
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — Profit vs Original panel', () => {
  it('shows all four rows with the server-provided figures for a covered item, never computing percent client-side', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(RUNNING_TOTAL) // COVERED_PROFIT

    render(<TrackingItemDetailPage />)
    const panel = await screen.findByTestId('profit-vs-original')
    expect(within(panel).getByText('Original investment (cost basis)')).toBeInTheDocument()
    expect(within(panel).getByText('Current balance / snapshot')).toBeInTheDocument()
    expect(within(panel).getByText('Profit vs original')).toBeInTheDocument()
    expect(within(panel).getByText('Profit %')).toBeInTheDocument()

    expect(within(panel).getByText('+1500.00')).toBeInTheDocument() // netOriginalInvestment
    expect(within(panel).getByText(/\+1825\.00/)).toBeInTheDocument() // currentValue
    expect(within(panel).getByText(/as of Q2 2026/)).toBeInTheDocument()
    expect(within(panel).getByText('+325.00')).toBeInTheDocument() // profit
    expect(within(panel).getByText('21.67%')).toBeInTheDocument() // server profitPercent, verbatim
  })

  it('shows the "no snapshot yet" line (never 0 / 0% / 100%) when currentValue is null', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue({
      itemId: 'item-1',
      currentTotal: 1500,
      entries: [
        { id: 'e1', trackingItemId: 'item-1', amount: 1500, entryDate: '2026-01-01', note: null, createdAt: '', updatedAt: '', runningTotal: 1500 },
      ],
      profitVsOriginal: {
        netOriginalInvestment: 1500, currentValue: null, currentValueSlot: null,
        profit: null, profitPercent: null, isCovered: false,
      },
    })

    render(<TrackingItemDetailPage />)
    const panel = await screen.findByTestId('profit-vs-original')
    expect(within(panel).getByText(/No snapshot yet/i)).toBeInTheDocument()
    expect(within(panel).queryByText('0')).not.toBeInTheDocument()
    expect(within(panel).queryByText('0%')).not.toBeInTheDocument()
    expect(within(panel).queryByText('0.00%')).not.toBeInTheDocument()
    expect(within(panel).queryByText('100%')).not.toBeInTheDocument()
    expect(within(panel).queryByText('100.00%')).not.toBeInTheDocument()
  })

  it('does not render the panel at all when the item has zero ledger entries', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())

    render(<TrackingItemDetailPage />)
    // Wait for the (empty) ledger to finish loading before asserting absence.
    await screen.findByText(/No entries yet/i)

    expect(screen.queryByTestId('profit-vs-original')).not.toBeInTheDocument()
  })
})
