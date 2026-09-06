import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingItemDetailPage from '../page'
import { trackingService } from '@/services/tracking'
import type { TrackingItem, RunningTotal, ProfitVsOriginal, Bond } from '@/services/tracking'

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
    listBonds: vi.fn(),
    getBond: vi.fn(),
    createBond: vi.fn(),
    updateBond: vi.fn(),
    deleteBond: vi.fn(),
  },
  TRACKING_ITEM_TYPES: [
    'Bank account', 'Property', 'Investment Account', 'TaxSaving', 'Materials', 'Insurance', 'BOND',
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

const ITEM_BOND: TrackingItem = {
  ...ITEM_NO_TRACKING,
  name: 'Government Bonds',
  type: 'BOND',
  initialInvestmentTracking: false,
}

const BONDS: Bond[] = [
  {
    id: 'b1', trackingItemId: 'item-1', code: 'TH-GOV-2030', issuer: 'Kingdom of Thailand',
    startDate: '2025-01-01', expiredDate: '2030-01-01', amount: 100000, status: 'Active',
    interestRate: null, years: null,
    createdAt: '', updatedAt: '',
  },
  {
    id: 'b2', trackingItemId: 'item-1', code: 'TH-GOV-2040', issuer: null,
    startDate: '2030-01-01', expiredDate: '2040-01-01', amount: 50000, status: 'Pre-order',
    interestRate: null, years: null,
    createdAt: '', updatedAt: '',
  },
  {
    id: 'b3', trackingItemId: 'item-1', code: 'TH-GOV-2020', issuer: 'MOF',
    startDate: '2010-01-01', expiredDate: '2020-01-01', amount: 25000, status: 'Expire',
    interestRate: null, years: null,
    createdAt: '', updatedAt: '',
  },
  {
    id: 'b4', trackingItemId: 'item-1', code: 'TH-GOV-UNK', issuer: null,
    startDate: null, expiredDate: null, amount: 0, status: 'Unknown',
    interestRate: null, years: null,
    createdAt: '', updatedAt: '',
  },
]

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
    { id: 'e1', trackingItemId: 'item-1', amount: 1000, entryDate: '2026-01-01', note: 'initial buy', code: null, name: null, createdAt: '', updatedAt: '', runningTotal: 1000 },
    { id: 'e2', trackingItemId: 'item-1', amount: 500, entryDate: '2026-02-01', note: null, code: null, name: null, createdAt: '', updatedAt: '', runningTotal: 1500 },
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
    mocked.createEntry.mockResolvedValueOnce({ id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: null, code: null, name: null, createdAt: '', updatedAt: '' })

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
      id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: 'bonus', code: null, name: null, createdAt: '', updatedAt: '',
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
      id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: null, code: null, name: null, createdAt: '', updatedAt: '',
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
      id: 'e1', trackingItemId: 'item-1', amount: 1000, entryDate: '2026-01-01', note: 'initial buy', code: null, name: null, createdAt: '', updatedAt: '',
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

  it('renders Note, Code and Name columns in the ledger table: values when set, an em dash when null', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(RUNNING_TOTAL)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Note' })

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(['Date', 'Amount', 'Running Total', 'Note', 'Code', 'Name', 'Actions'])

    // e1 has note 'initial buy', null code/name; e2 has all-null note/code/name -> "—".
    const e1Row = screen.getByText('initial buy').closest('tr')!
    expect(within(e1Row).getByText('01 Jan 2026')).toBeInTheDocument()
    const e2Row = screen.getByText('01 Feb 2026').closest('tr')!
    const e2Cells = within(e2Row).getAllByRole('cell')
    expect(e2Cells[3]).toHaveTextContent('—') // Note
    expect(e2Cells[4]).toHaveTextContent('—') // Code
    expect(e2Cells[5]).toHaveTextContent('—') // Name
  })

  it('threads Code and Name through createEntry (trimmed) and submits null when left blank', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())
    mocked.createEntry.mockResolvedValueOnce({
      id: 'e-new', trackingItemId: 'item-1', amount: 2000, entryDate: '2026-03-01', note: null, code: 'ISIN-1', name: 'Series A', createdAt: '', updatedAt: '',
    })

    render(<TrackingItemDetailPage />)
    await screen.findByText('Initial Investment Ledger')

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    await user.type(screen.getByLabelText(/Amount/i), '2000')

    const codeField = screen.getByLabelText(/Code \(optional\)/i)
    const nameField = screen.getByLabelText(/Name \(optional\)/i)
    expect(codeField).toHaveAttribute('maxlength', '100')
    expect(nameField).toHaveAttribute('maxlength', '100')
    await user.type(codeField, '  ISIN-1  ')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createEntry).toHaveBeenCalledWith('item-1', expect.objectContaining({
        amount: 2000, code: 'ISIN-1', name: null,
      }))
    })
  })
})

// ---------------------------------------------------------------------------
// Bond register section (BOND-typed items)
// ---------------------------------------------------------------------------

describe('TrackingItemDetailPage — bond register section', () => {
  it('does NOT render the Bonds section for a non-BOND item, and never queries bonds', async () => {
    mocked.getItem.mockResolvedValue(ITEM_WITH_TRACKING)
    mocked.getRunningTotal.mockResolvedValue(emptyRunningTotal())

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')

    expect(screen.queryByRole('heading', { name: 'Bonds' })).not.toBeInTheDocument()
    expect(mocked.listBonds).not.toHaveBeenCalled()
  })

  it('does NOT reveal the Bonds section when the type <select> is switched to BOND but not yet saved', async () => {
    // Companion to the ledger "toggle flipped but not saved" test: the bond
    // endpoints 400 on a non-BOND item, so the register is gated on the
    // PERSISTED item.type from the query cache, never the pending <select>
    // value. Switching the select must not mount BondsSection or fire listBonds.
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_NO_TRACKING) // type: 'Bank account'

    render(<TrackingItemDetailPage />)
    await screen.findByDisplayValue('Cash Account')

    await user.selectOptions(screen.getByLabelText('Type'), 'BOND')
    expect(screen.getByLabelText('Type')).toHaveValue('BOND') // pending edit is reflected

    expect(screen.queryByRole('heading', { name: 'Bonds' })).not.toBeInTheDocument()
    expect(mocked.listBonds).not.toHaveBeenCalled()
  })

  it('renders the Bonds section, one row per bond, with the correct status badge text', async () => {
    mocked.getItem.mockResolvedValue(ITEM_BOND)
    mocked.listBonds.mockResolvedValue(BONDS)

    render(<TrackingItemDetailPage />)
    expect(await screen.findByRole('heading', { name: 'Bonds' })).toBeInTheDocument()

    // One row per bond code (wait for the bonds query to resolve).
    const b1Row = (await screen.findByText('TH-GOV-2030')).closest('tr')!
    expect(within(b1Row).getByText('Active')).toBeInTheDocument()
    expect(within(b1Row).getByText('100000.00')).toBeInTheDocument()

    const b2Row = screen.getByText('TH-GOV-2040').closest('tr')!
    expect(within(b2Row).getByText('Pre-order')).toBeInTheDocument()
    expect(within(b2Row).getAllByRole('cell')[1]).toHaveTextContent('—') // null issuer

    const b3Row = screen.getByText('TH-GOV-2020').closest('tr')!
    expect(within(b3Row).getByText('Expire')).toBeInTheDocument()

    // Unknown renders as an em dash but keeps an accessible label.
    const b4Row = screen.getByText('TH-GOV-UNK').closest('tr')!
    expect(within(b4Row).getByLabelText('Status unknown')).toHaveTextContent('—')
  })

  it('shows the empty state when the item has no bonds', async () => {
    mocked.getItem.mockResolvedValue(ITEM_BOND)
    mocked.listBonds.mockResolvedValue([])

    render(<TrackingItemDetailPage />)
    await screen.findByRole('heading', { name: 'Bonds' })

    expect(await screen.findByText('No bonds yet.')).toBeInTheDocument()
  })

  it('adds a bond via createBond (required Code + Amount, cleared optional fields sent as null)', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_BOND)
    mocked.listBonds.mockResolvedValue([])
    mocked.createBond.mockResolvedValueOnce(BONDS[0])

    render(<TrackingItemDetailPage />)
    await screen.findByRole('heading', { name: 'Bonds' })

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    await user.type(screen.getByLabelText(/^Code$/i), 'TH-GOV-2030')
    await user.type(screen.getByLabelText(/Amount/i), '100000')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createBond).toHaveBeenCalledWith('item-1', expect.objectContaining({
        code: 'TH-GOV-2030', amount: 100000, issuer: null, startDate: null, expiredDate: null,
      }))
    })
  })

  it('rejects a whitespace-only code client-side (no createBond call)', async () => {
    const user = userEvent.setup()
    mocked.getItem.mockResolvedValue(ITEM_BOND)
    mocked.listBonds.mockResolvedValue([])

    render(<TrackingItemDetailPage />)
    await screen.findByRole('heading', { name: 'Bonds' })

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    // Whitespace passes the native `required` check but fails the trim() guard.
    await user.type(screen.getByLabelText(/^Code$/i), '   ')
    await user.type(screen.getByLabelText(/Amount/i), '100')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(/Code is required/i)).toBeInTheDocument()
    expect(mocked.createBond).not.toHaveBeenCalled()
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
        { id: 'e1', trackingItemId: 'item-1', amount: 1500, entryDate: '2026-01-01', note: null, code: null, name: null, createdAt: '', updatedAt: '', runningTotal: 1500 },
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
