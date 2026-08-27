import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import UpdateTrackingListDetailPage from '../page'
import { updateTrackingService } from '@/services/updateTracking'
import type { UpdateTrackingListDetail, UpdateTrackingListBalance } from '@/services/updateTracking'

// NOTE on testing strategy for the comma-formatting/caret helpers: they are
// intentionally NOT exported from page.tsx (Next.js App Router statically
// rejects any named export from a page.tsx other than the specific ones it
// recognizes — see the comment in page.tsx above `stripCommas`). So instead
// of unit-testing those pure functions in isolation, this file verifies
// their observable behavior through the real rendered `<input>`: the
// displayed (comma-formatted) value, the resulting caret position after a
// simulated keystroke, and the clean numeric value that ultimately reaches
// `upsertBalances`.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ listId: 'ul-2' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tracking/updates/ul-2',
}))

vi.mock('@/services/updateTracking', () => ({
  updateTrackingService: {
    getUpdateListDetail: vi.fn(),
    updateUpdateList: vi.fn(),
    upsertBalances: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mocked = vi.mocked(updateTrackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DETAIL: UpdateTrackingListDetail = {
  // NOTE: `quarter`/`year` replace the old `quarterYearLabel` field (a
  // concurrent backend+frontend change — see ListHeader). The
  // `UpdateTrackingList` type may not yet reflect this shape depending on
  // landing order (a separate agent is updating services/updateTracking.ts
  // concurrently), but vitest transpiles without type-checking so this
  // fixture runs correctly regardless; `tsc` reconciles once that lands.
  list: { id: 'ul-2', trackingSetId: 'set-1', transactionDate: '2026-06-30', quarter: 2, year: 2026, createdAt: '', updatedAt: '' },
  previousListId: 'ul-1',
  categories: [
    {
      id: 'cat-1', name: 'Assets', orderIndex: 0,
      subCategories: [
        {
          id: 'sub-1', name: 'Current Assets', orderIndex: 0,
          items: [
            {
              id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
              balance: 1200, previousBalance: 1000, deltaAmount: 200, deltaPercent: 20,
              hasPreviousData: true,
            },
            {
              id: 'item-2', name: 'New Fund', type: 'Investment Account', orderIndex: 1,
              balance: null, previousBalance: null, deltaAmount: null, deltaPercent: null,
              hasPreviousData: false,
            },
          ],
        },
      ],
    },
  ],
}

const EMPTY_DETAIL: UpdateTrackingListDetail = {
  list: { id: 'ul-3', trackingSetId: 'set-2', transactionDate: '2026-06-30', quarter: null, year: null, createdAt: '', updatedAt: '' },
  previousListId: null,
  categories: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Rendering the hierarchy
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — rendering', () => {
  it('renders the header, hierarchy, and a back link', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)

    expect(await screen.findByText('Assets')).toBeInTheDocument()
    expect(screen.getByText('Current Assets')).toBeInTheDocument()
    expect(screen.getByText('Cash')).toBeInTheDocument()
    expect(screen.getByText('New Fund')).toBeInTheDocument()

    const backLink = screen.getByRole('link', { name: /Back to Updates list/i })
    expect(backLink).toHaveAttribute('href', '/tracking/updates')
  })

  it('shows a loading state, then an error state on failure', async () => {
    mocked.getUpdateListDetail.mockRejectedValue(new Error('not found'))

    render(<UpdateTrackingListDetailPage />)

    expect(await screen.findByText(/Failed to load this update list/i)).toBeInTheDocument()
  })

  it('shows a link to the previous list when previousListId is present', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)

    const prevLink = await screen.findByRole('link', { name: /View previous update list/i })
    expect(prevLink).toHaveAttribute('href', '/tracking/updates/ul-1')
  })

  it('does not show a previous-list link when previousListId is null', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(EMPTY_DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText(/no tracking items yet/i)

    expect(screen.queryByRole('link', { name: /View previous update list/i })).not.toBeInTheDocument()
  })

  it('shows an empty state when the tracking set has zero tracking items', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(EMPTY_DETAIL)

    render(<UpdateTrackingListDetailPage />)

    expect(await screen.findByText(/no tracking items yet/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Delta display
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — delta display', () => {
  it('shows a positive delta amount and percent in the gain color for an item with prior data', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    const deltaText = screen.getByText('+200.00')
    expect(deltaText).toHaveClass('text-gain')
    expect(screen.getByText('(+20.00%)')).toBeInTheDocument()
  })

  it('shows a negative delta amount in the loss color', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [{
            id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
            balance: 800, previousBalance: 1000, deltaAmount: -200, deltaPercent: -20,
            hasPreviousData: true,
          }],
        }],
      }],
    })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('-200.00')).toHaveClass('text-loss')
  })

  it('shows "No prior data" for an item with hasPreviousData false', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('New Fund')

    expect(screen.getByText('No prior data')).toBeInTheDocument()
  })

  it('coerces a numeric-string delta (Decimal serialization) before formatting', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [{
            id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
            balance: 1200, previousBalance: 1000,
            deltaAmount: '200.00' as unknown as number,
            deltaPercent: '20.00' as unknown as number,
            hasPreviousData: true,
          }],
        }],
      }],
    })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('+200.00')).toBeInTheDocument()
    expect(screen.getByText('(+20.00%)')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Previous balance column
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — Previous Balance column', () => {
  it('renders the previous balance for an item that has one', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    // Cash: previousBalance 1000 -> plain "1000.00", no +/- sign.
    expect(screen.getByText('1000.00')).toBeInTheDocument()
  })

  it('renders "—" for an item with no previous balance', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('New Fund')

    // Both the Delta cell ("No prior data") and the Previous cell ("—")
    // reflect the absence of prior data for "New Fund"; scope to the row.
    const row = screen.getByText('New Fund').closest('tr')
    expect(row).not.toBeNull()
    expect(row!.textContent).toMatch(/—/)
  })

  it('coerces a numeric-string previous balance (Decimal serialization) before formatting', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [{
            id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
            balance: 1200, previousBalance: '1000.00' as unknown as number,
            deltaAmount: 200, deltaPercent: 20, hasPreviousData: true,
          }],
        }],
      }],
    })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('1000.00')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Column order and fixed-width Item column
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — column order and layout', () => {
  it('renders columns in the order Item, Latest Balance, Delta, Previous Balance, Type', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    const headers = screen.getAllByRole('columnheader').map(th => th.textContent)
    expect(headers).toEqual(['Item', 'Latest Balance', 'Delta', 'Previous Balance', 'Type'])
  })

  it('applies the same fixed Item-column width to every sub-category table on the page, sized to the longest name in the WHOLE list', async () => {
    const longName = 'A Very Long Tracking Item Name That Is Much Longer Than The Other One'
    const TWO_TABLES_DETAIL: UpdateTrackingListDetail = {
      list: { id: 'ul-5', trackingSetId: 'set-4', transactionDate: '2026-06-30', quarter: null, year: null, createdAt: '', updatedAt: '' },
      previousListId: null,
      categories: [{
        id: 'cat-a', name: 'Assets', orderIndex: 0,
        subCategories: [
          {
            id: 'sub-a', name: 'Short Names', orderIndex: 0,
            items: [{
              id: 'item-a1', name: 'A', type: 'Bank account', orderIndex: 0,
              balance: 100, previousBalance: null, deltaAmount: null, deltaPercent: null, hasPreviousData: false,
            }],
          },
          {
            id: 'sub-b', name: 'Long Names', orderIndex: 1,
            items: [{
              id: 'item-b1', name: longName, type: 'Investment Account', orderIndex: 0,
              balance: 200, previousBalance: null, deltaAmount: null, deltaPercent: null, hasPreviousData: false,
            }],
          },
        ],
      }],
    }
    mocked.getUpdateListDetail.mockResolvedValue(TWO_TABLES_DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText(longName)

    // Two separate <table>s (one per sub-category) -> two "Item" headers.
    const itemHeaders = screen.getAllByRole('columnheader', { name: 'Item' })
    expect(itemHeaders).toHaveLength(2)

    const [widthShortTable, widthLongTable] = itemHeaders.map(th => th.style.width)
    expect(widthShortTable).not.toBe('')
    // Both tables must share the exact same width, even though the first
    // table's own longest item name ("A") is far shorter than the name in
    // the second table — this is the whole-list max, not a per-table one.
    expect(widthShortTable).toBe(widthLongTable)
    expect(parseInt(widthShortTable, 10)).toBeGreaterThanOrEqual(longName.length)
  })
})

// ---------------------------------------------------------------------------
// Balance editing + Save All
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — balance editing and save', () => {
  it('hydrates the balance input from the loaded item balance, comma-formatted with exactly 2 decimals', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)

    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    expect(input.value).toBe('1,200.00')

    const emptyInput = screen.getByLabelText('Latest balance for New Fund') as HTMLInputElement
    expect(emptyInput.value).toBe('')
  })

  it('disables Save All until a field is edited, then enables it', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash')

    expect(screen.getByRole('button', { name: /Save All/i })).toBeDisabled()

    await user.clear(input)
    await user.type(input, '1300')

    expect(screen.getByRole('button', { name: /Save All/i })).toBeEnabled()
  })

  it('saves only the touched balance via a single bulk upsertBalances call', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    const saved: UpdateTrackingListBalance[] = [
      { id: 'b-1', updateTrackingListId: 'ul-2', trackingItemId: 'item-1', balance: 1300, createdAt: '', updatedAt: '' },
    ]
    mocked.upsertBalances.mockResolvedValueOnce(saved)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash')
    await user.clear(input)
    await user.type(input, '1300')

    await user.click(screen.getByRole('button', { name: /Save All/i }))

    await waitFor(() => {
      expect(mocked.upsertBalances).toHaveBeenCalledWith('ul-2', [{ trackingItemId: 'item-1', balance: 1300 }])
    })
  })

  it('sends null when a balance field is cleared to empty', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    mocked.upsertBalances.mockResolvedValueOnce([])

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash')
    await user.clear(input)

    await user.click(screen.getByRole('button', { name: /Save All/i }))

    await waitFor(() => {
      expect(mocked.upsertBalances).toHaveBeenCalledWith('ul-2', [{ trackingItemId: 'item-1', balance: null }])
    })
  })

  it('surfaces the backend 400 error via toast/inline message on save failure', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    mocked.upsertBalances.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'One or more tracking items do not belong to this update list\'s tracking set' } },
    })

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash')
    await user.clear(input)
    await user.type(input, '1300')
    await user.click(screen.getByRole('button', { name: /Save All/i }))

    expect(await screen.findByText(/do not belong to this update list/i)).toBeInTheDocument()
  })

  it('displays thousand-separator commas live while typing a large balance', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '1500000')

    expect(input.value).toBe('1,500,000')
  })

  it('sends the clean, comma-free numeric balance to upsertBalances even though the input displays commas', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    mocked.upsertBalances.mockResolvedValueOnce([])

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '1500000')

    expect(input.value).toBe('1,500,000')

    await user.click(screen.getByRole('button', { name: /Save All/i }))

    await waitFor(() => {
      expect(mocked.upsertBalances).toHaveBeenCalledWith('ul-2', [{ trackingItemId: 'item-1', balance: 1500000 }])
    })
  })

  it('preserves decimals and negative numbers while comma-formatting', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '-1500000.5')

    expect(input.value).toBe('-1,500,000.5')
  })
})

// ---------------------------------------------------------------------------
// Client-side delta preview on blur
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — client-side delta preview on blur', () => {
  it('shows a live unsaved-preview delta on blur, computed from the edited value vs previousBalance', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    // Cash: previousBalance = 1000. Edit to 1500 -> delta +500.00 (+50.00%).
    await user.clear(input)
    await user.type(input, '1500')
    await user.tab() // blur

    expect(await screen.findByText('+500.00')).toBeInTheDocument()
    expect(screen.getByText('(+50.00%)')).toBeInTheDocument()
    expect(screen.getByText('(unsaved)')).toBeInTheDocument()
  })

  it('handles a previousBalance of 0: computes deltaAmount but never shows a percent (no Infinity/NaN)', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [{
            id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
            balance: null, previousBalance: 0, deltaAmount: null, deltaPercent: null,
            hasPreviousData: true,
          }],
        }],
      }],
    })

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '250')
    await user.tab()

    expect(await screen.findByText('+250.00')).toBeInTheDocument()
    // No percent span, and definitely no Infinity/NaN text anywhere.
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('does not fabricate a preview when previousBalance is null', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    // "New Fund" has previousBalance: null, hasPreviousData: false.
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement
    await user.type(input, '500')
    await user.tab()

    expect(screen.queryByText('(unsaved)')).not.toBeInTheDocument()
    // Falls back to the server-authoritative "No prior data" state.
    expect(screen.getByText('No prior data')).toBeInTheDocument()
  })

  it('reverts to a neutral "—" (not the stale saved delta, not 0) when the field is cleared back to empty on blur', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '1500')
    await user.tab()
    expect(await screen.findByText('(unsaved)')).toBeInTheDocument()

    await user.clear(input)
    await user.tab()

    await waitFor(() => {
      expect(screen.queryByText('(unsaved)')).not.toBeInTheDocument()
    })
    // Empty is not treated as 0, and the stale saved delta (+200.00) from
    // before the edit must not reappear — the cell shows a neutral "—".
    expect(screen.queryByText(/^\+0\.00$/)).not.toBeInTheDocument()
    expect(screen.queryByText('+200.00')).not.toBeInTheDocument()
    const row = screen.getByText('Cash').closest('tr')
    expect(row!.textContent).toMatch(/—/)
  })

  it('correctly signs a negative edited balance in the preview', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    // previousBalance = 1000, edit to -500 -> delta -1500.00 (-150.00%).
    await user.clear(input)
    await user.type(input, '-500')
    await user.tab()

    expect(await screen.findByText('-1500.00')).toBeInTheDocument()
    expect(screen.getByText('(-150.00%)')).toBeInTheDocument()
  })

  it('reverts the preview to the saved server delta once the edit is saved and the list is refetched', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValueOnce(DETAIL).mockResolvedValueOnce({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [
            {
              id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
              balance: 1500, previousBalance: 1000, deltaAmount: 500, deltaPercent: 50,
              hasPreviousData: true,
            },
            DETAIL.categories[0].subCategories[0].items[1],
          ],
        }],
      }],
    })
    mocked.upsertBalances.mockResolvedValueOnce([])

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '1500')
    await user.tab()
    expect(await screen.findByText('(unsaved)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Save All/i }))

    // Once saved+refetched, dirty is cleared and the row shows the
    // authoritative server delta (+500.00 / +50.00%) without the
    // "(unsaved)" marker.
    await waitFor(() => {
      expect(screen.queryByText('(unsaved)')).not.toBeInTheDocument()
    })
    expect(screen.getByText('+500.00')).toBeInTheDocument()
    expect(screen.getByText('(+50.00%)')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Comma formatting — observed through the rendered input's DOM value
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — comma formatting via the rendered input', () => {
  it('formats large integers with thousand separators as they are typed', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement
    await user.type(input, '1500000')

    expect(input.value).toBe('1,500,000')
  })

  it('preserves decimals while comma-formatting', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement
    await user.type(input, '1500000.5')

    expect(input.value).toBe('1,500,000.5')
  })

  it('strips stray non-numeric characters and collapses duplicate signs/dots as the user types', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement
    await user.type(input, '1a2b3')

    expect(input.value).toBe('123')
  })

  it('clearing the input back to empty is valid and does not force a "0"', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement
    await user.clear(input)

    expect(input.value).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Exactly 2 decimal digits (never 4) for Latest Balance / Previous Balance
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — 2-decimal balance formatting', () => {
  it('shows exactly 2 decimals for Latest Balance and Previous Balance even when the backend returns 4-decimal precision', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      categories: [{
        ...DETAIL.categories[0],
        subCategories: [{
          ...DETAIL.categories[0].subCategories[0],
          items: [{
            id: 'item-1', name: 'Cash', type: 'Bank account', orderIndex: 0,
            balance: '11500.0000' as unknown as number,
            previousBalance: '9000.0000' as unknown as number,
            deltaAmount: 2500, deltaPercent: 27.78, hasPreviousData: true,
          }],
        }],
      }],
    })

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for Cash') as HTMLInputElement

    expect(input.value).toBe('11,500.00')
    expect(screen.getByText('9000.00')).toBeInTheDocument()
  })

  it('truncates a 3rd typed decimal digit live rather than accepting 4-decimal precision', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement
    await user.type(input, '1500.1234')

    expect(input.value).toBe('1,500.12')
  })

  it('does not force-pad decimals while still focused, but normalizes to exactly 2 decimals on blur', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    await user.type(input, '500')
    expect(input.value).toBe('500') // not fought mid-keystroke

    await user.tab() // blur
    expect(input.value).toBe('500.00') // normalized to the "at rest" convention
  })

  it('normalizes a partially-typed decimal (e.g. "500.5") to 2 decimals on blur', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    await user.type(input, '500.5')
    expect(input.value).toBe('500.5')

    await user.tab()
    expect(input.value).toBe('500.50')
  })
})

// ---------------------------------------------------------------------------
// Cursor position — simulated at the DOM level via fireEvent so we control
// the raw (pre-reformat) input value and selectionStart exactly the way the
// browser would present them right after a keystroke, then assert where the
// caret actually lands after our reformat-and-restore logic runs. This is
// the most reliable way to verify the caret-jump / mid-string-insertion fix
// without relying on userEvent's own (less precise) caret simulation.
// ---------------------------------------------------------------------------

describe('UpdateTrackingListDetailPage — caret position after comma-reformatting', () => {
  it('keeps the caret at the end when appending digits at the end of a long number', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    // Seed to "1,234" (as if typed already), caret at the end.
    fireEvent.change(input, { target: { value: '1234', selectionStart: 4 } })
    expect(input.value).toBe('1,234')

    // Simulate the browser having appended "5" at the end: raw DOM value is
    // "1,2345" with the caret now at index 6, before our onChange reformats
    // it to "12,345".
    fireEvent.change(input, { target: { value: '1,2345', selectionStart: 6 } })

    expect(input.value).toBe('12,345')
    expect(input.selectionStart).toBe(6)
  })

  it('lands the caret right after a digit inserted in the middle of an already-formatted number', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    // Seed to "1,500,000".
    fireEvent.change(input, { target: { value: '1500000', selectionStart: 7 } })
    expect(input.value).toBe('1,500,000')

    // Simulate clicking between "1," and "500,000" (raw index 2) and typing
    // "2": the browser inserts it first, producing "1,2500,000" with the
    // caret now at index 3 — our reformat turns this into "12,500,000" and
    // the caret must land right after the inserted "2" (index 2), not at
    // the end of the field.
    fireEvent.change(input, { target: { value: '1,2500,000', selectionStart: 3 } })

    expect(input.value).toBe('12,500,000')
    expect(input.selectionStart).toBe(2)
  })

  it('keeps the caret in place when a digit is inserted further into the tail group', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    fireEvent.change(input, { target: { value: '12500', selectionStart: 5 } })
    expect(input.value).toBe('12,500')

    // Insert "9" between the "5" and the first "0" of "12,500" (raw index
    // 4, right after "12,5") -> raw becomes "12,5900" with caret at 5,
    // right after the inserted "9".
    fireEvent.change(input, { target: { value: '12,5900', selectionStart: 5 } })

    expect(input.value).toBe('125,900')
    expect(input.selectionStart).toBe(5)
  })

  it('lands the caret correctly when a 3rd decimal digit is typed and truncated away by the 2-decimal cap', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    render(<UpdateTrackingListDetailPage />)
    const input = await screen.findByLabelText('Latest balance for New Fund') as HTMLInputElement

    fireEvent.change(input, { target: { value: '11500.12', selectionStart: 8 } })
    expect(input.value).toBe('11,500.12')

    // Type a 3rd decimal digit "9" at the end -> raw DOM value momentarily
    // "11,500.129" with caret at 10, but the 2-decimal cap in
    // sanitizeNumericInput drops the "9" entirely, so the display is
    // unchanged from before this keystroke and the caret settles at the
    // (now unchanged) end of the field rather than anywhere invalid.
    fireEvent.change(input, { target: { value: '11,500.129', selectionStart: 10 } })

    expect(input.value).toBe('11,500.12')
    expect(input.selectionStart).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// Header edit (transaction date / quarter + year)
// ---------------------------------------------------------------------------
// `quarterYearLabel` (a single free-text field) has been replaced by
// separate `quarter` (1-4) / `year` numeric fields — a concurrent
// backend+frontend change (see the NOTE on the DETAIL fixture above).

describe('UpdateTrackingListDetailPage — header display (quarter/year)', () => {
  it('displays "Q{quarter} {year}" when both are set', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('Q2 2026')).toBeInTheDocument()
  })

  it('displays just the quarter when only quarter is set', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      list: { ...DETAIL.list, quarter: 3, year: null },
    })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('Q3')).toBeInTheDocument()
  })

  it('displays just the year when only year is set', async () => {
    mocked.getUpdateListDetail.mockResolvedValue({
      ...DETAIL,
      list: { ...DETAIL.list, quarter: null, year: 2026 },
    })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('displays "—" when neither quarter nor year is set', async () => {
    mocked.getUpdateListDetail.mockResolvedValue(EMPTY_DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText(/no tracking items yet/i)

    const label = screen.getByText('Quarter/Year')
    expect(label.nextElementSibling?.textContent).toBe('—')
  })
})

describe('UpdateTrackingListDetailPage — header edit (transaction date / quarter / year)', () => {
  it('hydrates the Quarter select and Year input from the current values when entering edit mode', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')
    await user.click(screen.getByRole('button', { name: /Edit transaction date/i }))

    const quarterSelect = screen.getByLabelText('Quarter') as HTMLSelectElement
    const yearInput = screen.getByLabelText('Year') as HTMLInputElement
    expect(quarterSelect.value).toBe('2')
    expect(yearInput.value).toBe('2026')
  })

  it('edits and saves separate quarter and year fields as { quarter, year }', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    mocked.updateUpdateList.mockResolvedValueOnce({ ...DETAIL.list, quarter: 3, year: 2026 })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    await user.click(screen.getByRole('button', { name: /Edit transaction date/i }))
    const quarterSelect = screen.getByLabelText('Quarter')
    await user.selectOptions(quarterSelect, '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocked.updateUpdateList).toHaveBeenCalledWith('ul-2', {
        transactionDate: '2026-06-30', quarter: 3, year: 2026,
      })
    })
  })

  it('sends null for quarter/year when cleared back to the unset option / empty', async () => {
    const user = userEvent.setup()
    mocked.getUpdateListDetail.mockResolvedValue(DETAIL)
    mocked.updateUpdateList.mockResolvedValueOnce({ ...DETAIL.list, quarter: null, year: null })

    render(<UpdateTrackingListDetailPage />)
    await screen.findByText('Cash')

    await user.click(screen.getByRole('button', { name: /Edit transaction date/i }))
    const quarterSelect = screen.getByLabelText('Quarter')
    const yearInput = screen.getByLabelText('Year') as HTMLInputElement
    await user.selectOptions(quarterSelect, '')
    await user.clear(yearInput)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocked.updateUpdateList).toHaveBeenCalledWith('ul-2', {
        transactionDate: '2026-06-30', quarter: null, year: null,
      })
    })
  })
})
