import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingDashboardPage from '../page'
import { trackingService } from '@/services/tracking'
import type {
  TrackingSet, DashboardBalanceGridOut, BalanceCell,
} from '@/services/tracking'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// This page has no router/params dependency (unlike updates/[listId]/page.tsx)
// — it only reads a `useState` selection plus the two React Query hooks
// below — so `next/navigation` does not need to be mocked here.

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listSets: vi.fn(),
    getBalanceGrid: vi.fn(),
  },
}))

const mocked = vi.mocked(trackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SETS: TrackingSet[] = [
  { id: 'set-1', name: 'Main Set', description: null, createdAt: '', updatedAt: '' },
]

/** A fully-populated "normal" cell — used everywhere we don't care about the specific values. */
const filled = (balance: number): BalanceCell => ({
  year: 0, quarter: 0, balance, deltaAmount: 10, deltaPercent: 1, hasData: true, hasPreviousData: true,
})

/** 8 filled cells (2 years x 4 quarters), ascending balances — used for subtotal/total rows. */
const filledRow = (base: number): BalanceCell[] =>
  Array.from({ length: 8 }, (_, i) => filled(base + i * 10))

// `Kbank` cells are positionally aligned to [2024 Q1..Q4, 2026 Q1..Q4]:
//  - index 0 (2024 Q1): hasData:false, hasPreviousData:true -> exercises the
//    "blank quarter, but delta still resolvable" case (both cells show "—").
//  - index 4 (2026 Q1): hasPreviousData:false -> exercises "No prior data".
const KBANK_CELLS: BalanceCell[] = [
  { year: 2024, quarter: 1, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: true },
  { year: 2024, quarter: 2, balance: 1000, deltaAmount: 100, deltaPercent: 11.11, hasData: true, hasPreviousData: true },
  { year: 2024, quarter: 3, balance: 1100, deltaAmount: 100, deltaPercent: 10, hasData: true, hasPreviousData: true },
  { year: 2024, quarter: 4, balance: 1200, deltaAmount: 100, deltaPercent: 9.09, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 1, balance: 1300, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
  { year: 2026, quarter: 2, balance: 1400, deltaAmount: 100, deltaPercent: 7.69, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 3, balance: 1500, deltaAmount: 100, deltaPercent: 7.14, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 4, balance: 1600, deltaAmount: 100, deltaPercent: 6.67, hasData: true, hasPreviousData: true },
]

// Grid deliberately uses years in an order the backend would send (whatever
// that order is) that is NOT what a client-side sort would reconstruct —
// here, ascending and non-contiguous (skips 2025) — to prove the page
// renders `years` verbatim rather than re-sorting (e.g. into the descending
// order the type comment documents as the *typical* real-world shape).
const GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2024, quarters: [1, 2, 3, 4] },
    { year: 2026, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    {
      id: 'cat-1', name: 'Assets', orderIndex: 0,
      subtotal: filledRow(2000),
      subCategories: [
        {
          id: 'sub-1', name: 'Bank', orderIndex: 0,
          subtotal: filledRow(1500),
          items: [
            { id: 'item-1', name: 'Kbank', type: 'Bank account', orderIndex: 0, exclusive: false, cells: KBANK_CELLS },
            { id: 'item-2', name: 'SpecialFund', type: 'Investment Account', orderIndex: 1, exclusive: true, cells: filledRow(500) },
          ],
        },
      ],
    },
  ],
  grandTotal: filledRow(3000),
  propertyBreakdown: {
    propertyTotal: filledRow(800),
    nonPropertyTotal: filledRow(2200),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listSets.mockResolvedValue(SETS)
  mocked.getBalanceGrid.mockResolvedValue(GRID)
})

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — cell formatting', () => {
  it('renders "—" for both balance and delta on a blank quarter (hasData:false) whose delta is still resolvable', async () => {
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    const row = screen.getByText('Kbank').closest('tr')!
    const tds = within(row).getAllByRole('cell')
    // tds[0] = name cell; tds[1]/tds[2] = balance/delta for the first (2024 Q1) column.
    expect(tds[1]).toHaveTextContent('—')
    expect(tds[2]).toHaveTextContent('—')
    expect(tds[2]).not.toHaveTextContent('No prior data')
  })

  it('renders "No prior data" (not "0", not blank) for a cell with hasPreviousData:false', async () => {
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    expect(await screen.findByText('No prior data')).toBeInTheDocument()
    expect(screen.queryByText('+0.00')).not.toBeInTheDocument()
  })

  it('renders an exclusive item in its own row carrying an "Excl." badge', async () => {
    render(<TrackingDashboardPage />)

    const badge = await screen.findByText('Excl.')
    const row = badge.closest('tr')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('SpecialFund')
  })
})

// ---------------------------------------------------------------------------
// Row hierarchy / styling
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category/SubCategory subtotal rows', () => {
  it('renders Category and SubCategory rows distinctly from Item rows (background + toggle button)', async () => {
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    const categoryRow = screen.getByText('Assets').closest('tr')!
    const subCategoryRow = screen.getByText('Bank').closest('tr')!
    const itemRow = screen.getByText('Kbank').closest('tr')!

    expect(categoryRow).toHaveClass('bg-surface-elevated/40')
    expect(subCategoryRow).toHaveClass('bg-surface-elevated/20')
    expect(itemRow).not.toHaveClass('bg-surface-elevated/40')
    expect(itemRow).not.toHaveClass('bg-surface-elevated/20')

    // Category/SubCategory rows double as toggle buttons; the item row does not.
    expect(within(categoryRow).getByRole('button', { name: /Assets/ })).toBeInTheDocument()
    expect(within(subCategoryRow).getByRole('button', { name: /Bank/ })).toBeInTheDocument()
    expect(within(itemRow).queryByRole('button')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Year ordering
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — year column order', () => {
  it('renders years in the exact order the fixture provides, without re-sorting', async () => {
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    const yearButtons = screen.getAllByRole('button', { name: /columns$/i })
    expect(yearButtons.map(b => b.getAttribute('aria-label'))).toEqual([
      'Collapse 2024 columns',
      'Collapse 2026 columns',
    ])
  })
})

// ---------------------------------------------------------------------------
// Collapse behavior — Category
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category collapse', () => {
  it('hides SubCategory/Item rows when a Category is collapsed, while its own subtotal row stays visible', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    const beforeCellCount = within(screen.getByText('Assets').closest('tr')!).getAllByRole('cell').length

    await user.click(screen.getByRole('button', { name: 'Collapse Assets' }))

    expect(screen.queryByText('Bank')).not.toBeInTheDocument()
    expect(screen.queryByText('Kbank')).not.toBeInTheDocument()

    const categoryRow = screen.getByText('Assets').closest('tr')!
    expect(categoryRow).toBeInTheDocument()
    expect(within(categoryRow).getAllByRole('cell')).toHaveLength(beforeCellCount)

    // Toggling again re-expands.
    await user.click(screen.getByRole('button', { name: 'Expand Assets' }))
    expect(await screen.findByText('Kbank')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Collapse behavior — Year (column removal, not CSS hiding)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Year column collapse', () => {
  it('removes that year\'s 8 <td>s per row when its column header is collapsed (not just CSS-hidden)', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    const grandTotalRowBefore = screen.getByText('Grand Total').closest('tr')!
    const beforeCount = within(grandTotalRowBefore).getAllByRole('cell').length
    expect(beforeCount).toBe(1 + 2 * 4 * 2) // label + 2 years x 4 quarters x (balance+delta)

    await user.click(screen.getByRole('button', { name: 'Collapse 2024 columns' }))

    const grandTotalRowAfter = screen.getByText('Grand Total').closest('tr')!
    const afterCount = within(grandTotalRowAfter).getAllByRole('cell').length
    expect(afterCount).toBe(beforeCount - 8)
  })
})

// ---------------------------------------------------------------------------
// Global Detail / Summary toggle
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — global Detail/Summary toggle', () => {
  it('collapses every Category and SubCategory on "Summary", and re-expands all on "Detail"', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await screen.findByText('Kbank')

    await user.click(screen.getByRole('button', { name: /Summary/i }))

    expect(screen.queryByText('Bank')).not.toBeInTheDocument()
    expect(screen.queryByText('Kbank')).not.toBeInTheDocument()
    // The Category rollup itself must remain.
    expect(screen.getByText('Assets')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Detail/i }))

    expect(await screen.findByText('Bank')).toBeInTheDocument()
    expect(screen.getByText('Kbank')).toBeInTheDocument()
  })
})
