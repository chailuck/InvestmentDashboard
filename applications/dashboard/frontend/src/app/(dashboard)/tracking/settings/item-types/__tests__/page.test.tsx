import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { render } from '@/test/test-utils'
import ItemTypesSettingsPage from '../page'
import { trackingService, type ItemType } from '@/services/tracking'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listItemTypes: vi.fn(),
    createItemType: vi.fn(),
    updateItemType: vi.fn(),
    reorderItemTypes: vi.fn(),
    archiveItemType: vi.fn(),
    unarchiveItemType: vi.fn(),
    deleteItemType: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

let mockUser: { role: string } | null = { role: 'admin' }
vi.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: mockUser }),
}))

const mocked = vi.mocked(trackingService)

const TYPES: ItemType[] = [
  { id: 'it-bank', slug: 'bank_account', label: 'Bank account', sortOrder: 0, isSystem: true, isArchived: false, capabilities: [], itemCount: 3 },
  { id: 'it-prop', slug: 'property', label: 'Property', sortOrder: 1, isSystem: true, isArchived: false, capabilities: ['counts_as_property'], itemCount: 12 },
  { id: 'it-bond', slug: 'bond', label: 'BOND', sortOrder: 2, isSystem: true, isArchived: false, capabilities: ['bond_register'], itemCount: 1 },
  { id: 'it-crypto', slug: 'crypto', label: 'Crypto', sortOrder: 3, isSystem: false, isArchived: false, capabilities: [], itemCount: 0 },
  { id: 'it-nft', slug: 'nft', label: 'NFT', sortOrder: 4, isSystem: false, isArchived: false, capabilities: [], itemCount: 5 },
  { id: 'it-old', slug: 'old_fund', label: 'Old Fund', sortOrder: 5, isSystem: false, isArchived: true, capabilities: [], itemCount: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { role: 'admin' }
  mocked.listItemTypes.mockResolvedValue(TYPES.map(t => ({ ...t })))
  mocked.updateItemType.mockResolvedValue(TYPES[0])
  mocked.createItemType.mockResolvedValue(TYPES[3])
  mocked.reorderItemTypes.mockResolvedValue(undefined)
  mocked.archiveItemType.mockResolvedValue({ ...TYPES[3], isArchived: true })
  mocked.deleteItemType.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// RoleGuard
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — access control', () => {
  it('blocks non-admins with the RoleGuard fallback', async () => {
    mockUser = { role: 'analyst' }
    render(<ItemTypesSettingsPage />)
    expect(await screen.findByText('Access denied')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Item Types' })).not.toBeInTheDocument()
  })

  it('renders the table for an admin', async () => {
    render(<ItemTypesSettingsPage />)
    expect(await screen.findByRole('heading', { name: 'Item Types' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// List rendering — system vs custom, archived toggle
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — list', () => {
  it('renders system rows with a System badge and custom rows without one; archived hidden by default', async () => {
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    const bankRow = screen.getByTestId('item-type-row-bank_account')
    expect(within(bankRow).getByText('System')).toBeInTheDocument()

    const cryptoRow = screen.getByTestId('item-type-row-crypto')
    expect(within(cryptoRow).queryByText('System')).not.toBeInTheDocument()

    // archived type hidden until the toggle is on
    expect(screen.queryByTestId('item-type-row-old_fund')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Show archived'))
    expect(await screen.findByTestId('item-type-row-old_fund')).toBeInTheDocument()
  })

  it('disables the counts-as-property checkbox on system rows and enables it on custom rows', async () => {
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    expect(screen.getByLabelText('Counts as property — Bank account')).toBeDisabled()
    expect(screen.getByLabelText('Counts as property — Crypto')).toBeEnabled()
    // bond_register is shown as a read-only badge, never a checkbox
    const bondRow = screen.getByTestId('item-type-row-bond')
    expect(within(bondRow).getByText('Bond register')).toBeInTheDocument()
    expect(within(bondRow).queryByLabelText(/bond register/i)).not.toBeInTheDocument()
  })

  it('disables Delete for system rows and for in-use custom rows, with an explaining tooltip', async () => {
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    expect(screen.getByRole('button', { name: 'Delete Bank account' })).toBeDisabled()
    const nftDelete = screen.getByRole('button', { name: 'Delete NFT' })
    expect(nftDelete).toBeDisabled()
    expect(nftDelete).toHaveAttribute('title', expect.stringMatching(/Used by 5 items/))
    // zero-item custom type — deletable
    expect(screen.getByRole('button', { name: 'Delete Crypto' })).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — add custom type', () => {
  it('live-validates a duplicate label and blocks submit', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    await user.click(screen.getByRole('button', { name: /Add custom type/i }))
    await user.type(screen.getByLabelText('Label'), 'property') // case-insensitive dup of "Property"
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add type' })).toBeDisabled()
    expect(mocked.createItemType).not.toHaveBeenCalled()
  })

  it('creates a type with the counts_as_property capability and invalidates caches', async () => {
    const user = userEvent.setup()
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    await user.click(screen.getByRole('button', { name: /Add custom type/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Label'), 'Vintage Cars')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Add type' }))

    await waitFor(() => {
      expect(mocked.createItemType).toHaveBeenCalledWith({
        label: 'Vintage Cars', capabilities: ['counts_as_property'],
      })
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tracking-item-types'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tracking-analysis-balance-grid'] })
    invalidateSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Rename (inline edit — works on system rows too)
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — rename', () => {
  it('inline-edits a system row label, Enter saves via updateItemType', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await user.click(await screen.findByRole('button', { name: 'Edit label for BOND' }))

    const input = screen.getByRole('textbox', { name: 'Rename BOND' })
    await user.clear(input)
    await user.type(input, 'Government Bond{Enter}')

    await waitFor(() => {
      expect(mocked.updateItemType).toHaveBeenCalledWith('it-bond', { label: 'Government Bond' })
    })
  })

  it('Escape cancels the inline edit without calling updateItemType', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await user.click(await screen.findByRole('button', { name: 'Edit label for Crypto' }))

    const input = screen.getByRole('textbox', { name: 'Rename Crypto' })
    await user.type(input, 'X{Escape}')
    expect(mocked.updateItemType).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit label for Crypto' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Reorder (keyboard up/down — full id list persisted)
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — reorder', () => {
  it('the up/down buttons are real buttons with aria-labels and persist the full ordered id set', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    // Move "Property" (index 1) up past "Bank account".
    await user.click(screen.getByRole('button', { name: 'Move Property up' }))

    await waitFor(() => {
      expect(mocked.reorderItemTypes).toHaveBeenCalledWith([
        'it-prop', 'it-bank', 'it-bond', 'it-crypto', 'it-nft', 'it-old',
      ])
    })
  })

  it('the first row cannot move up and the last cannot move down', async () => {
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })
    expect(screen.getByRole('button', { name: 'Move Bank account up' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Archive / Delete confirm dialogs
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — archive & delete', () => {
  it('archives a type through a confirm dialog that states existing totals are unaffected', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    await user.click(screen.getByRole('button', { name: 'Archive Property' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/used by 12 items/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/totals .* are unaffected/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(mocked.archiveItemType).toHaveBeenCalledWith('it-prop'))
  })

  it('deletes a zero-item custom type through a confirm dialog', async () => {
    const user = userEvent.setup()
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    await user.click(screen.getByRole('button', { name: 'Delete Crypto' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocked.deleteItemType).toHaveBeenCalledWith('it-crypto'))
  })

  it('surfaces the backend 409 when archiving the last active type', async () => {
    const user = userEvent.setup()
    mocked.archiveItemType.mockRejectedValueOnce({
      isAxiosError: true, response: { status: 409, data: { detail: 'At least one active type must remain' } },
    })
    render(<ItemTypesSettingsPage />)
    await screen.findByRole('button', { name: 'Edit label for Bank account' })

    await user.click(screen.getByRole('button', { name: 'Archive Bank account' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await within(dialog).findByText(/At least one active type must remain/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe('ItemTypesSettingsPage — states', () => {
  it('shows an inline retry on load error', async () => {
    mocked.listItemTypes.mockReset()
    mocked.listItemTypes.mockRejectedValue(new Error('boom'))
    render(<ItemTypesSettingsPage />)
    expect(await screen.findByText(/Failed to load item types/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
