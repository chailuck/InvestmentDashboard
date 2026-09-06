import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { BondsSection } from '@/components/tracking/BondsSection'
import { trackingService } from '@/services/tracking'
import type { Bond } from '@/services/tracking'

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listBonds: vi.fn(),
    getBond: vi.fn(),
    createBond: vi.fn(),
    updateBond: vi.fn(),
    deleteBond: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mocked = vi.mocked(trackingService)

const BOND: Bond = {
  id: 'b1', trackingItemId: 'item-1', code: 'TH-GOV-2030', issuer: 'Kingdom of Thailand',
  startDate: '2025-01-01', expiredDate: '2030-01-01', amount: 100000, status: 'Active',
  interestRate: null, years: null, createdAt: '', updatedAt: '',
}

/** Build a bond fixture off the base, overriding only the fields a test cares about. */
const mk = (over: Partial<Bond>): Bond => ({ ...BOND, ...over })

/** Codes of the body rows, in current DOM order (header row dropped). */
const rowCodes = (): (string | null)[] =>
  screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BondsSection', () => {
  it('shows the loading state, then an error state when the list query fails', async () => {
    mocked.listBonds.mockRejectedValue(new Error('boom'))

    render(<BondsSection itemId="item-1" />)

    expect(await screen.findByText(/Failed to load bonds/i)).toBeInTheDocument()
  })

  it('renders a right-aligned amount with two decimals from the coerced number', async () => {
    mocked.listBonds.mockResolvedValue([{ ...BOND, amount: 1234.5 }])

    render(<BondsSection itemId="item-1" />)

    expect(await screen.findByText('1234.50')).toBeInTheDocument()
  })

  it('edits a bond: hydrates the form and sends code + amount + value-or-null clears via updateBond', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([BOND])
    mocked.updateBond.mockResolvedValueOnce({ ...BOND, amount: 120000 })

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('TH-GOV-2030')

    await user.click(screen.getByRole('button', { name: 'Edit bond TH-GOV-2030' }))
    expect(screen.getByLabelText(/^Code$/i)).toHaveValue('TH-GOV-2030')
    expect(screen.getByLabelText(/Issuer/i)).toHaveValue('Kingdom of Thailand')

    const amount = screen.getByLabelText(/Amount/i)
    await user.clear(amount)
    await user.type(amount, '120000')
    // Clear the issuer -> should be sent as null.
    await user.clear(screen.getByLabelText(/Issuer/i))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(mocked.updateBond).toHaveBeenCalledWith('b1', expect.objectContaining({
        code: 'TH-GOV-2030', amount: 120000, issuer: null,
        startDate: '2025-01-01', expiredDate: '2030-01-01',
      }))
    })
  })

  it('deletes a bond through the confirm modal', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([BOND])
    mocked.deleteBond.mockResolvedValueOnce(undefined)

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('TH-GOV-2030')

    await user.click(screen.getByRole('button', { name: 'Delete bond TH-GOV-2030' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteBond).toHaveBeenCalledWith('b1')
    })
  })

  it('status-preview badge reflects computeBondStatus from the form start/expired inputs', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('No bonds yet.')

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    const previewCell = screen.getByText('Status preview').closest('div') as HTMLElement

    // No dates entered yet -> 'Unknown' (em dash carrying an accessible label).
    expect(within(previewCell).getByLabelText('Status unknown')).toBeInTheDocument()

    // A window that straddles today -> 'Active'.
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2000-01-01' } })
    fireEvent.change(screen.getByLabelText(/Expired date/i), { target: { value: '2999-12-31' } })
    expect(within(previewCell).getByText('Active')).toBeInTheDocument()

    // Start moved into the far future -> 'Pre-order'.
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2999-01-01' } })
    expect(within(previewCell).getByText('Pre-order')).toBeInTheDocument()

    // Window entirely in the past -> 'Expire'.
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2000-01-01' } })
    fireEvent.change(screen.getByLabelText(/Expired date/i), { target: { value: '2000-12-31' } })
    expect(within(previewCell).getByText('Expire')).toBeInTheDocument()
  })

  it('renders the delete error inline in the confirm modal when deleteBond fails, and keeps the modal open', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([BOND])
    mocked.deleteBond.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { detail: 'Could not delete bond' } },
    })

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('TH-GOV-2030')

    await user.click(screen.getByRole('button', { name: 'Delete bond TH-GOV-2030' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByText('Could not delete bond')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('surfaces the backend error message inline when create fails', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([])
    mocked.createBond.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Item is not a BOND item' } },
    })

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('No bonds yet.')

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    await user.type(screen.getByLabelText(/^Code$/i), 'X1')
    await user.type(screen.getByLabelText(/Amount/i), '0')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Item is not a BOND item')).toBeInTheDocument()
  })

  // ── Interest Rate / Years columns ──────────────────────────────────────────

  it('renders the Interest Rate and Years column headers', async () => {
    mocked.listBonds.mockResolvedValue([BOND])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('TH-GOV-2030')

    expect(screen.getByRole('columnheader', { name: 'Interest Rate' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Years' })).toBeInTheDocument()
  })

  it('renders the interest rate as a percentage, an em dash for null, and 0% for zero', async () => {
    mocked.listBonds.mockResolvedValue([
      mk({ id: 'a', code: 'RATE-A', interestRate: 3.25, years: 5 }),
      mk({ id: 'b', code: 'RATE-B', interestRate: null, years: 5 }),
      mk({ id: 'c', code: 'RATE-C', interestRate: 0, years: 5 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('RATE-A')

    const rowA = screen.getByText('RATE-A').closest('tr') as HTMLElement
    const rowB = screen.getByText('RATE-B').closest('tr') as HTMLElement
    const rowC = screen.getByText('RATE-C').closest('tr') as HTMLElement
    expect(within(rowA).getByText('3.25%')).toBeInTheDocument()
    expect(within(rowB).getByText('—')).toBeInTheDocument()
    expect(within(rowC).getByText('0%')).toBeInTheDocument()
  })

  it('renders the years span verbatim, an em dash for null, and 0 for zero', async () => {
    mocked.listBonds.mockResolvedValue([
      mk({ id: 'a', code: 'YR-A', interestRate: 2, years: 5 }),
      mk({ id: 'b', code: 'YR-B', interestRate: 2, years: null }),
      mk({ id: 'c', code: 'YR-C', interestRate: 2, years: 0 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('YR-A')

    const rowA = screen.getByText('YR-A').closest('tr') as HTMLElement
    const rowB = screen.getByText('YR-B').closest('tr') as HTMLElement
    const rowC = screen.getByText('YR-C').closest('tr') as HTMLElement
    expect(within(rowA).getByText('5')).toBeInTheDocument()
    expect(within(rowB).getByText('—')).toBeInTheDocument()
    expect(within(rowC).getByText('0')).toBeInTheDocument()
  })

  // ── Client-side register sorting ──────────────────────────────────────────

  it('defaults to expiry date ascending with the null-expiry bond last', async () => {
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'C1', expiredDate: '2031-01-01' }),
      mk({ id: '2', code: 'C2', expiredDate: '2029-01-01' }),
      mk({ id: '3', code: 'C3', expiredDate: '2030-01-01' }),
      mk({ id: '4', code: 'C4', expiredDate: null }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('C1')

    expect(rowCodes()).toEqual(['C2', 'C3', 'C1', 'C4'])
    expect(screen.getByRole('columnheader', { name: 'Expired' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts by Code ascending on first click and descending on the second, updating aria-sort', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'BBB', expiredDate: '2029-01-01' }),
      mk({ id: '2', code: 'AAA', expiredDate: '2031-01-01' }),
      mk({ id: '3', code: 'CCC', expiredDate: '2030-01-01' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('AAA')

    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(rowCodes()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(screen.getByRole('columnheader', { name: 'Code' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Expired' })).toHaveAttribute('aria-sort', 'none')

    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(rowCodes()).toEqual(['CCC', 'BBB', 'AAA'])
    expect(screen.getByRole('columnheader', { name: 'Code' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('keeps a null interest rate last in BOTH sort directions', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'P1', interestRate: 2 }),
      mk({ id: '2', code: 'P2', interestRate: null }),
      mk({ id: '3', code: 'P3', interestRate: 5 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('P1')

    await user.click(screen.getByRole('button', { name: 'Interest Rate' }))
    expect(rowCodes()).toEqual(['P1', 'P3', 'P2'])

    await user.click(screen.getByRole('button', { name: 'Interest Rate' }))
    expect(rowCodes()).toEqual(['P3', 'P1', 'P2'])
  })

  it('sorts Status by lifecycle order (not alphabetical) and reverses exactly on the second click', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'S1', status: 'Expire' }),
      mk({ id: '2', code: 'S2', status: 'Unknown' }),
      mk({ id: '3', code: 'S3', status: 'Pre-order' }),
      mk({ id: '4', code: 'S4', status: 'Active' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('S1')

    await user.click(screen.getByRole('button', { name: 'Status' }))
    expect(rowCodes()).toEqual(['S3', 'S4', 'S1', 'S2'])

    await user.click(screen.getByRole('button', { name: 'Status' }))
    expect(rowCodes()).toEqual(['S2', 'S1', 'S4', 'S3'])
  })

  // ── Natural-type sort for the remaining columns (DEF-003) ─────────────────

  it('sorts Issuer as a string (localeCompare), ascending on first click', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'I-B', issuer: 'Banco Central' }),
      mk({ id: '2', code: 'I-A', issuer: 'Apex Capital' }),
      mk({ id: '3', code: 'I-C', issuer: 'Cathay Trust' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('I-B')

    await user.click(screen.getByRole('button', { name: 'Issuer' }))
    expect(rowCodes()).toEqual(['I-A', 'I-B', 'I-C'])
    expect(screen.getByRole('columnheader', { name: 'Issuer' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts Start date chronologically (date order), ascending on first click', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'D-B', startDate: '2025-06-01' }),
      mk({ id: '2', code: 'D-A', startDate: '2024-01-15' }),
      mk({ id: '3', code: 'D-C', startDate: '2026-12-31' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('D-B')

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(rowCodes()).toEqual(['D-A', 'D-B', 'D-C'])
    expect(screen.getByRole('columnheader', { name: 'Start' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts Amount numerically (not lexically) and reverses on the second click', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'A-2', amount: 100 }),
      mk({ id: '2', code: 'A-1', amount: 9 }),
      mk({ id: '3', code: 'A-3', amount: 1000 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('A-2')

    // Numeric order is 9 < 100 < 1000; a string sort would give "100","1000","9".
    await user.click(screen.getByRole('button', { name: 'Amount' }))
    expect(rowCodes()).toEqual(['A-1', 'A-2', 'A-3'])
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Amount' }))
    expect(rowCodes()).toEqual(['A-3', 'A-2', 'A-1'])
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts Years numerically (not lexically) and reverses on the second click', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'Y-2', years: 10 }),
      mk({ id: '2', code: 'Y-1', years: 2 }),
      mk({ id: '3', code: 'Y-3', years: 100 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('Y-2')

    await user.click(screen.getByRole('button', { name: 'Years' }))
    expect(rowCodes()).toEqual(['Y-1', 'Y-2', 'Y-3'])
    expect(screen.getByRole('columnheader', { name: 'Years' })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Years' }))
    expect(rowCodes()).toEqual(['Y-3', 'Y-2', 'Y-1'])
    expect(screen.getByRole('columnheader', { name: 'Years' })).toHaveAttribute('aria-sort', 'descending')
  })

  // ── Nulls sort LAST in BOTH directions for the remaining fields (DEF-004) ──

  it('keeps a null issuer last in BOTH sort directions', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'N1', issuer: 'Alpha' }),
      mk({ id: '2', code: 'N2', issuer: null }),
      mk({ id: '3', code: 'N3', issuer: 'Zeta' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('N1')

    await user.click(screen.getByRole('button', { name: 'Issuer' }))
    expect(rowCodes()).toEqual(['N1', 'N3', 'N2'])

    await user.click(screen.getByRole('button', { name: 'Issuer' }))
    expect(rowCodes()).toEqual(['N3', 'N1', 'N2'])
  })

  it('keeps a null start date last in BOTH sort directions', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'N1', startDate: '2024-01-01' }),
      mk({ id: '2', code: 'N2', startDate: null }),
      mk({ id: '3', code: 'N3', startDate: '2026-01-01' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('N1')

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(rowCodes()).toEqual(['N1', 'N3', 'N2'])

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(rowCodes()).toEqual(['N3', 'N1', 'N2'])
  })

  it('keeps a null years span last in BOTH sort directions', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'N1', years: 3 }),
      mk({ id: '2', code: 'N2', years: null }),
      mk({ id: '3', code: 'N3', years: 9 }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('N1')

    await user.click(screen.getByRole('button', { name: 'Years' }))
    expect(rowCodes()).toEqual(['N1', 'N3', 'N2'])

    await user.click(screen.getByRole('button', { name: 'Years' }))
    expect(rowCodes()).toEqual(['N3', 'N1', 'N2'])
  })

  it('keeps a null expiry last when Expired is sorted DESCENDING', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([
      mk({ id: '1', code: 'E1', expiredDate: '2029-01-01' }),
      mk({ id: '2', code: 'E2', expiredDate: null }),
      mk({ id: '3', code: 'E3', expiredDate: '2031-01-01' }),
    ])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('E1')

    // Expired is the default ascending sort; the first click flips it to descending.
    await user.click(screen.getByRole('button', { name: 'Expired' }))
    expect(screen.getByRole('columnheader', { name: 'Expired' })).toHaveAttribute('aria-sort', 'descending')
    expect(rowCodes()).toEqual(['E3', 'E1', 'E2'])
  })

  // ── Actions column is not sortable (DEF-005) ──────────────────────────────

  it('does not make the Actions column sortable (no aria-sort, no button)', async () => {
    mocked.listBonds.mockResolvedValue([BOND])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('TH-GOV-2030')

    const actions = screen.getByRole('columnheader', { name: 'Actions' })
    expect(actions).not.toHaveAttribute('aria-sort')
    expect(within(actions).queryByRole('button')).toBeNull()
  })

  // ── Form: interest rate field ─────────────────────────────────────────────

  it('creates a bond with interestRate: null when the field is left empty', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([])
    mocked.createBond.mockResolvedValueOnce(mk({ id: 'new', code: 'NB' }))

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('No bonds yet.')

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    await user.type(screen.getByLabelText(/^Code$/i), 'NB')
    await user.type(screen.getByLabelText(/Amount/i), '1000')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createBond).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ code: 'NB', amount: 1000, interestRate: null }),
      )
    })
  })

  it('rejects an out-of-range interest rate inline and does not call createBond', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([])

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('No bonds yet.')

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    await user.type(screen.getByLabelText(/^Code$/i), 'NB')
    await user.type(screen.getByLabelText(/Amount/i), '1000')
    // Set an over-max value directly: `user.type` drops keystrokes that
    // overshoot the input's `max`, so "150" would never land as a whole.
    fireEvent.change(screen.getByLabelText(/Interest rate/i), { target: { value: '150' } })
    // Submit via the form event, not a click on the submit button: with an
    // out-of-range value the browser's native constraint validation (`max=100`)
    // aborts a click-submit before any handler runs. Dispatching `submit`
    // exercises the component's own JS guard, which is what we're asserting.
    fireEvent.submit(screen.getByRole('button', { name: 'Add' }).closest('form') as HTMLFormElement)

    expect(await screen.findByText(/Interest rate must be a number between 0 and 100/i)).toBeInTheDocument()
    expect(mocked.createBond).not.toHaveBeenCalled()
  })

  it('passes a valid interest rate through to createBond', async () => {
    const user = userEvent.setup()
    mocked.listBonds.mockResolvedValue([])
    mocked.createBond.mockResolvedValueOnce(mk({ id: 'new', code: 'NB', interestRate: 3.25 }))

    render(<BondsSection itemId="item-1" />)
    await screen.findByText('No bonds yet.')

    await user.click(screen.getByRole('button', { name: /Add Bond/i }))
    await user.type(screen.getByLabelText(/^Code$/i), 'NB')
    await user.type(screen.getByLabelText(/Amount/i), '1000')
    await user.type(screen.getByLabelText(/Interest rate/i), '3.25')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocked.createBond).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ code: 'NB', amount: 1000, interestRate: 3.25 }),
      )
    })
  })
})
