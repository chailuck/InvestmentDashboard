import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingItemDetailPage from '../page'
import { trackingService } from '@/services/tracking'
import type { TrackingItem, ItemType, RunningTotal, Entry } from '@/services/tracking'
import toast from 'react-hot-toast'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useParams: () => ({ itemId: 'item-1' }),
}))

vi.mock('@/services/tracking', () => ({
  trackingService: {
    getItem: vi.fn(),
    updateItem: vi.fn(),
    listItemTypes: vi.fn(),
    getRunningTotal: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    listBonds: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mocked = vi.mocked(trackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_TYPE: ItemType = {
  id: 'type-1', slug: 'stock', label: 'Stock', sortOrder: 1,
  isSystem: true, isArchived: false, capabilities: [],
}

const ITEM: TrackingItem = {
  id: 'item-1', subCategoryId: 'sub-1', name: 'My Stock', typeId: 'type-1', itemType: ITEM_TYPE,
  type: 'Stock', initialInvestmentTracking: true, exclusive: false, order: 1,
  description: null, accountName: null, remark: null, createdAt: '', updatedAt: '',
}

const ENTRY_BASE: Entry = {
  id: 'e1', trackingItemId: 'item-1', amount: 100, entryDate: '2025-01-01',
  note: null, code: null, name: null, createdAt: '', updatedAt: '',
}

/** Build an entry fixture off the base, overriding only the fields a test cares about. */
const mkEntry = (over: Partial<Entry> & { runningTotal: number }): Entry & { runningTotal: number } => ({
  ...ENTRY_BASE, ...over,
})

const runningTotal = (entries: (Entry & { runningTotal: number })[]): RunningTotal => ({
  itemId: 'item-1',
  currentTotal: entries.length ? entries[entries.length - 1].runningTotal : 0,
  entries,
  profitVsOriginal: {
    netOriginalInvestment: null, currentValue: null, currentValueSlot: null,
    profit: null, profitPercent: null, isCovered: false,
  },
})

/**
 * Dates of the ledger's body rows, in current DOM order.
 * Cell 0 is the row-select checkbox column; cell 1 is Date.
 */
const rowDates = (): (string | null)[] =>
  screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getItem.mockResolvedValue(ITEM)
  mocked.listItemTypes.mockResolvedValue([ITEM_TYPE])
  mocked.updateItem.mockResolvedValue(ITEM)
})

describe('TrackingItemDetailPage — Initial Investment Ledger', () => {
  // ── Layout: no forced horizontal scroll wrapper at normal width ──────────

  it('renders all 7 ledger column headers without capping the page width', async () => {
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
    ]))

    const { container } = render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    for (const name of ['Date', 'Amount', 'Running Total', 'Note', 'Code', 'Name', 'Actions']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }

    // The page root no longer carries the max-w-3xl cap that caused the
    // reported scrollbar — it matches the sibling tracking pages (dashboard,
    // analysis, category, updates), which are all uncapped.
    const root = container.firstChild as HTMLElement
    expect(root.className).not.toMatch(/max-w-/)

    // The table itself still sits in an `overflow-x-auto` wrapper as a phone-
    // width fallback (same pattern as BondsSection) — that wrapper alone
    // does not force a scrollbar at normal desktop/tablet widths.
    const table = screen.getByRole('table')
    expect(table.closest('.overflow-x-auto')).not.toBeNull()
  })

  // ── Sorting: default order ────────────────────────────────────────────────

  it('defaults to Date ascending, with aria-sort reflecting it and no caveat hint shown', async () => {
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-03-01', amount: 50, runningTotal: 150 }),
      mkEntry({ id: '2', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
      mkEntry({ id: '3', entryDate: '2025-02-01', amount: 50, runningTotal: 150 }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    expect(rowDates()).toEqual(['01 Jan 2025', '01 Feb 2025', '01 Mar 2025'])
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.queryByText(/Running Total reflects chronological/i)).toBeNull()
  })

  // ── Sorting: toggle asc/desc + aria-sort + caveat hint ────────────────────

  it('sorts by Amount, toggles direction on repeat click, and shows the Running-Total caveat hint', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 300, runningTotal: 300 }),
      mkEntry({ id: '2', entryDate: '2025-02-01', amount: 100, runningTotal: 400 }),
      mkEntry({ id: '3', entryDate: '2025-03-01', amount: 200, runningTotal: 600 }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: 'Amount' }))
    expect(rowDates()).toEqual(['01 Feb 2025', '01 Mar 2025', '01 Jan 2025'])
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByText(/Running Total reflects chronological/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Amount' }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Mar 2025', '01 Feb 2025'])
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts Running Total numerically and reverses on the second click', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
      mkEntry({ id: '2', entryDate: '2025-02-01', amount: 900, runningTotal: 1000 }),
      mkEntry({ id: '3', entryDate: '2025-03-01', amount: -500, runningTotal: 500 }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: 'Running Total' }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Mar 2025', '01 Feb 2025'])
    expect(screen.getByRole('columnheader', { name: 'Running Total' })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Running Total' }))
    expect(rowDates()).toEqual(['01 Feb 2025', '01 Mar 2025', '01 Jan 2025'])
  })

  // ── Sorting: nulls/blanks last in BOTH directions for Note/Code/Name ─────

  it('keeps a null Note last in both sort directions', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 1, runningTotal: 1, note: 'Zeta' }),
      mkEntry({ id: '2', entryDate: '2025-02-01', amount: 1, runningTotal: 2, note: null }),
      mkEntry({ id: '3', entryDate: '2025-03-01', amount: 1, runningTotal: 3, note: 'Alpha' }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(rowDates()).toEqual(['01 Mar 2025', '01 Jan 2025', '01 Feb 2025'])

    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Mar 2025', '01 Feb 2025'])
  })

  it('keeps a blank Code last in both sort directions, same as null', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 1, runningTotal: 1, code: 'BBB' }),
      mkEntry({ id: '2', entryDate: '2025-02-01', amount: 1, runningTotal: 2, code: '   ' }),
      mkEntry({ id: '3', entryDate: '2025-03-01', amount: 1, runningTotal: 3, code: 'AAA' }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(rowDates()).toEqual(['01 Mar 2025', '01 Jan 2025', '01 Feb 2025'])

    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Mar 2025', '01 Feb 2025'])
  })

  it('sorts Name locale-aware and keeps a null Name last in both directions', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 1, runningTotal: 1, name: 'Banco' }),
      mkEntry({ id: '2', entryDate: '2025-02-01', amount: 1, runningTotal: 2, name: null }),
      mkEntry({ id: '3', entryDate: '2025-03-01', amount: 1, runningTotal: 3, name: 'Apex' }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(rowDates()).toEqual(['01 Mar 2025', '01 Jan 2025', '01 Feb 2025'])
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Mar 2025', '01 Feb 2025'])
  })

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('the Actions column is not sortable (no aria-sort, no button) and each sort control is a real button', async () => {
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: '1', entryDate: '2025-01-01', amount: 1, runningTotal: 1 }),
    ]))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    const actions = screen.getByRole('columnheader', { name: 'Actions' })
    expect(actions).not.toHaveAttribute('aria-sort')
    expect(within(actions).queryByRole('button')).toBeNull()

    for (const name of ['Date', 'Amount', 'Running Total', 'Note', 'Code', 'Name']) {
      const header = screen.getByRole('columnheader', { name })
      expect(header).toHaveAttribute('aria-sort')
      expect(within(header).getByRole('button')).toBeInstanceOf(HTMLButtonElement)
    }
  })

  // ── Existing CRUD flows still work unchanged ──────────────────────────────

  it('still adds a new ledger entry through the existing Add Entry flow', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([]))
    mocked.createEntry.mockResolvedValueOnce(mkEntry({ id: 'new', entryDate: '2025-05-01', amount: 500, runningTotal: 500 }))

    render(<TrackingItemDetailPage />)
    await screen.findByText(/No entries yet/i)

    await user.click(screen.getByRole('button', { name: /Add Entry/i }))
    const amountInput = screen.getByLabelText(/Amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '500')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createEntry).toHaveBeenCalledWith('item-1', expect.objectContaining({ amount: 500 }))
    })
    expect(toast.success).toHaveBeenCalledWith('Entry added')
  })

  it('still edits a ledger entry through the existing Edit flow', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: 'e1', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
    ]))
    mocked.updateEntry.mockResolvedValueOnce(mkEntry({ id: 'e1', entryDate: '2025-01-01', amount: 250, runningTotal: 250 }))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: /Edit entry on 01 Jan 2025/i }))
    const amountInput = screen.getByLabelText(/Amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '250')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(mocked.updateEntry).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: 250 }))
    })
    expect(toast.success).toHaveBeenCalledWith('Entry updated')
  })

  it('still deletes a ledger entry through the existing confirm-delete flow', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal([
      mkEntry({ id: 'e1', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
    ]))
    mocked.deleteEntry.mockResolvedValueOnce(undefined)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: /Delete entry on 01 Jan 2025/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledWith('e1')
    })
  })
})

describe('TrackingItemDetailPage — Ledger multi-select & bulk delete', () => {
  const THREE_ENTRIES = [
    mkEntry({ id: 'e1', entryDate: '2025-01-01', amount: 100, runningTotal: 100 }),
    mkEntry({ id: 'e2', entryDate: '2025-02-01', amount: 200, runningTotal: 300 }),
    mkEntry({ id: 'e3', entryDate: '2025-03-01', amount: 300, runningTotal: 600 }),
  ]

  it('selects individual rows via their checkboxes', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    const cb1 = screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })
    const cb2 = screen.getByRole('checkbox', { name: /Select entry on 01 Feb 2025/i })
    expect(cb1).not.toBeChecked()

    await user.click(cb1)
    expect(cb1).toBeChecked()
    expect(screen.getByText('1 selected', { selector: 'p' })).toBeInTheDocument()

    await user.click(cb2)
    expect(screen.getByText('2 selected', { selector: 'p' })).toBeInTheDocument()
  })

  it('select-all header checkbox reflects none / indeterminate / all states', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    const selectAll = screen.getByRole('checkbox', { name: 'Select all ledger entries' }) as HTMLInputElement
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(true)

    await user.click(selectAll)
    expect(selectAll.checked).toBe(true)
    expect(selectAll.indeterminate).toBe(false)
    expect(screen.getByText('3 selected', { selector: 'p' })).toBeInTheDocument()

    await user.click(selectAll)
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(false)
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('keeps selection keyed by entry id across a sort-order change', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    // Select the Jan 1 entry (row 1 under the default Date-ascending sort).
    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    expect(rowDates()).toEqual(['01 Jan 2025', '01 Feb 2025', '01 Mar 2025'])

    // Sort by Amount descending — row order flips.
    await user.click(screen.getByRole('button', { name: 'Amount' }))
    await user.click(screen.getByRole('button', { name: 'Amount' }))
    expect(rowDates()).toEqual(['01 Mar 2025', '01 Feb 2025', '01 Jan 2025'])

    // The Jan 1 row, now in a different position, is still checked; others are not.
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Mar 2025/i })).not.toBeChecked()
    expect(screen.getByText('1 selected', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows the bulk action bar only when at least one row is selected, and Clear selection empties it', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })).not.toBeChecked()
  })

  it('bulk-deletes all selected entries on confirm, invalidating the running-total query exactly once', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    mocked.deleteEntry.mockResolvedValue(undefined)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })
    expect(mocked.getRunningTotal).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('checkbox', { name: 'Select all ledger entries' }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('3 ledger entries')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledTimes(3)
    })
    expect(mocked.deleteEntry).toHaveBeenCalledWith('e1')
    expect(mocked.deleteEntry).toHaveBeenCalledWith('e2')
    expect(mocked.deleteEntry).toHaveBeenCalledWith('e3')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    // 1 initial fetch + exactly 1 refetch from a single batch invalidation
    // (NOT once per deleted row).
    expect(mocked.getRunningTotal).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith('Deleted 3 entries')
  })

  it('surfaces a partial failure clearly, invalidates once, and keeps only the failed row selected', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    // Shaped like an axios error so `extractApiError` surfaces the real
    // message instead of falling back to the generic "unexpected error".
    const axiosLikeError = { isAxiosError: true, response: { data: { detail: 'Network error' } }, message: 'Network error' }
    mocked.deleteEntry.mockImplementation((id: string) => (
      id === 'e2' ? Promise.reject(axiosLikeError) : Promise.resolve(undefined)
    ))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: 'Select all ledger entries' }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledTimes(3)
    })

    // Modal stays open (not silently reported as full success) with the
    // failure clearly surfaced, including which row and why.
    await waitFor(() => {
      expect(within(dialog).getByText(/2 of 3 deleted/)).toBeInTheDocument()
    })
    expect(within(dialog).getByText(/Network error/)).toBeInTheDocument()

    // Only the failed row (Feb 1 / e2) remains selected; succeeded rows are cleared.
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Feb 2025/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Mar 2025/i })).not.toBeChecked()
    expect(screen.getByText('1 selected', { selector: 'p' })).toBeInTheDocument()

    // Exactly one refetch for the whole batch even on partial failure.
    expect(mocked.getRunningTotal).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith('1 entry failed to delete')
  })

  it('cancelling the bulk-delete confirmation deletes nothing and leaves the selection untouched', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocked.deleteEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })).toBeChecked()
    expect(screen.getByText('1 selected', { selector: 'p' })).toBeInTheDocument()
  })

  it('row checkboxes and bulk-bar controls are real, keyboard-operable elements', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    const checkbox = screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })
    expect(checkbox.tagName).toBe('INPUT')
    checkbox.focus()
    await user.keyboard(' ')
    expect(checkbox).toBeChecked()

    const deleteSelectedBtn = screen.getByRole('button', { name: 'Delete Selected' })
    const clearBtn = screen.getByRole('button', { name: 'Clear selection' })
    expect(deleteSelectedBtn.tagName).toBe('BUTTON')
    expect(clearBtn.tagName).toBe('BUTTON')

    clearBtn.focus()
    await user.keyboard('{Enter}')
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull()
  })

  it('single-row delete still works unaffected by the multi-select feature', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    mocked.deleteEntry.mockResolvedValueOnce(undefined)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('button', { name: /Delete entry on 01 Jan 2025/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledTimes(1)
      expect(mocked.deleteEntry).toHaveBeenCalledWith('e1')
    })
  })

  // ── DEF-001 regression: stale bulkError must not leak into a freshly
  //    reopened confirmation after the previous attempt was cancelled
  //    mid-flight ────────────────────────────────────────────────────────────

  it('does not show a stale error from a cancelled in-flight bulk delete when the dialog is reopened (DEF-001)', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))

    // Deferred deleteEntry calls so we can cancel the modal *before* the
    // batch settles, then settle it afterwards with a partial failure —
    // reproducing DEF-001's exact repro order (cancel, then settle, then
    // reopen).
    const deferreds: Record<string, { resolve: () => void; reject: (err: unknown) => void }> = {}
    mocked.deleteEntry.mockImplementation(
      (id: string) => new Promise<void>((resolve, reject) => { deferreds[id] = { resolve, reject } }),
    )

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: 'Select all ledger entries' }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // The batch is in flight (all three deleteEntry calls issued, none settled).
    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledTimes(3)
    })

    // Cancel is NOT disabled during loading (unlike Delete) — click it while
    // the delete is still in flight, which unmounts the modal and clears
    // bulkError at the time.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Now let the already-in-flight batch settle, moments later, with a
    // partial failure — this is the completion logic DEF-001 says still
    // runs (and calls setBulkError) even though the modal was dismissed.
    const axiosLikeError = { isAxiosError: true, response: { data: { detail: 'Network error' } }, message: 'Network error' }
    deferreds.e1.resolve()
    deferreds.e2.reject(axiosLikeError)
    deferreds.e3.resolve()

    // Wait for the post-settle completion logic (setSelectedIds, invalidate,
    // setBulkError) to finish running.
    await waitFor(() => {
      expect(mocked.getRunningTotal).toHaveBeenCalledTimes(2)
    })
    // The failed row (e2 / Feb 1) stays selected so the user can retry it.
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Feb 2025/i })).toBeChecked()

    // Re-open the confirmation for a brand-new attempt on the still-selected
    // (previously-failed) row.
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    const reopenedDialog = await screen.findByRole('dialog')

    // No stale error/result text from the cancelled attempt should appear —
    // this is a fresh, not-yet-attempted delete.
    expect(reopenedDialog.textContent).not.toMatch(/deleted/)
    expect(reopenedDialog.textContent).not.toMatch(/failed/)
    expect(reopenedDialog.textContent).not.toMatch(/Network error/)
  })

  // ── Coverage gap 1: confirmation detail-summary content ───────────────────

  it('renders the selected entries’ dates and amounts in the bulk-delete confirmation summary', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Feb 2025/i }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('01 Jan 2025 (+100.00)')
    expect(dialog.textContent).toContain('01 Feb 2025 (+200.00)')
  })

  // ── Coverage gap 2: >5 selected rows caps the summary with "+N more" ─────

  it('caps the bulk-delete confirmation summary at 5 items and shows a "+N more" suffix for 6+ selected rows', async () => {
    const user = userEvent.setup()
    const SIX_ENTRIES = [
      mkEntry({ id: 'e1', entryDate: '2025-01-01', amount: 10, runningTotal: 10 }),
      mkEntry({ id: 'e2', entryDate: '2025-02-01', amount: 20, runningTotal: 30 }),
      mkEntry({ id: 'e3', entryDate: '2025-03-01', amount: 30, runningTotal: 60 }),
      mkEntry({ id: 'e4', entryDate: '2025-04-01', amount: 40, runningTotal: 100 }),
      mkEntry({ id: 'e5', entryDate: '2025-05-01', amount: 50, runningTotal: 150 }),
      mkEntry({ id: 'e6', entryDate: '2025-06-01', amount: 60, runningTotal: 210 }),
    ]
    mocked.getRunningTotal.mockResolvedValue(runningTotal(SIX_ENTRIES))

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: 'Select all ledger entries' }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('dialog')
    // First 5 (Jan–May) are listed individually...
    for (const date of ['01 Jan 2025', '01 Feb 2025', '01 Mar 2025', '01 Apr 2025', '01 May 2025']) {
      expect(dialog.textContent).toContain(date)
    }
    // ...the 6th (Jun) is folded into the "+1 more" suffix, not listed by name.
    expect(dialog.textContent).not.toContain('01 Jun 2025')
    expect(dialog.textContent).toContain('+1 more')
  })

  // ── Coverage gap 3: aria-live regions update with selection-count and
  //    delete-result text (asserted directly, not via the visible `<p>`) ───

  it('updates the aria-live polite regions with selection-count and delete-result text', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    mocked.deleteEntry.mockResolvedValue(undefined)

    const { container } = render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    const liveRegions = Array.from(container.querySelectorAll('[aria-live="polite"]')) as HTMLElement[]
    expect(liveRegions).toHaveLength(2)
    const [selectionLive, resultLive] = liveRegions

    // Both start empty.
    expect(selectionLive.textContent).toBe('')
    expect(resultLive.textContent).toBe('')

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))
    expect(selectionLive.textContent).toBe('1 selected')

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Feb 2025/i }))
    expect(selectionLive.textContent).toBe('2 selected')

    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(resultLive.textContent).toBe('2 deleted')
    })
  })

  // ── Coverage gap 4: keyboard operability of "Delete Selected" and the
  //    modal's own Delete/Cancel buttons ────────────────────────────────────

  it('Delete Selected and the modal’s Delete/Cancel buttons are keyboard-operable', async () => {
    const user = userEvent.setup()
    mocked.getRunningTotal.mockResolvedValue(runningTotal(THREE_ENTRIES))
    mocked.deleteEntry.mockResolvedValue(undefined)

    render(<TrackingItemDetailPage />)
    await screen.findByRole('columnheader', { name: 'Date' })

    await user.click(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i }))

    // Activate "Delete Selected" via Enter.
    const deleteSelectedBtn = screen.getByRole('button', { name: 'Delete Selected' })
    expect(deleteSelectedBtn.tagName).toBe('BUTTON')
    deleteSelectedBtn.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog')

    // Activate the modal's Cancel via Enter — dialog closes, selection kept.
    const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancelBtn.tagName).toBe('BUTTON')
    cancelBtn.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Select entry on 01 Jan 2025/i })).toBeChecked()

    // Re-open "Delete Selected" via Space this time.
    deleteSelectedBtn.focus()
    await user.keyboard(' ')
    const dialog2 = await screen.findByRole('dialog')

    // Activate the modal's Delete via Space.
    const confirmDeleteBtn = within(dialog2).getByRole('button', { name: 'Delete' })
    expect(confirmDeleteBtn.tagName).toBe('BUTTON')
    confirmDeleteBtn.focus()
    await user.keyboard(' ')

    await waitFor(() => {
      expect(mocked.deleteEntry).toHaveBeenCalledWith('e1')
    })
  })
})
