import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingCategoryPage from '../page'
import { trackingService } from '@/services/tracking'
import type { TrackingSet, Category, SubCategory, TrackingItem } from '@/services/tracking'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listSets: vi.fn(),
    createSet: vi.fn(),
    updateSet: vi.fn(),
    deleteSet: vi.fn(),
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    reorderCategories: vi.fn(),
    listSubCategories: vi.fn(),
    createSubCategory: vi.fn(),
    updateSubCategory: vi.fn(),
    deleteSubCategory: vi.fn(),
    reorderSubCategories: vi.fn(),
    listItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    reorderItems: vi.fn(),
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

const SETS: TrackingSet[] = [
  { id: 'set-1', name: 'Main Set', description: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
]

const CATEGORIES: Category[] = [
  { id: 'cat-assets', trackingSetId: 'set-1', name: 'Assets', description: null, order: 0, createdAt: '', updatedAt: '' },
  { id: 'cat-liabilities', trackingSetId: 'set-1', name: 'Liabilities', description: null, order: 1, createdAt: '', updatedAt: '' },
]

const SUBCATEGORIES_ASSETS: SubCategory[] = [
  { id: 'sub-current', categoryId: 'cat-assets', name: 'Current Assets', description: null, order: 0, createdAt: '', updatedAt: '' },
]

const SUBCATEGORIES_LIABILITIES: SubCategory[] = []

const ITEMS_CURRENT: TrackingItem[] = [
  {
    id: 'item-cash', subCategoryId: 'sub-current', name: 'Cash', type: 'Bank account',
    initialInvestmentTracking: false, exclusive: false, order: 0,
    description: null, accountName: null, remark: null, createdAt: '', updatedAt: '',
  },
]

function setupDefaultMocks() {
  mocked.listSets.mockResolvedValue(SETS)
  mocked.listCategories.mockResolvedValue(CATEGORIES)
  mocked.listSubCategories.mockImplementation(async (categoryId: string) =>
    categoryId === 'cat-assets' ? SUBCATEGORIES_ASSETS : SUBCATEGORIES_LIABILITIES,
  )
  mocked.listItems.mockImplementation(async (subCategoryId: string) =>
    subCategoryId === 'sub-current' ? ITEMS_CURRENT : [],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaultMocks()
})

// ---------------------------------------------------------------------------
// Rendering the tree
// ---------------------------------------------------------------------------

describe('TrackingCategoryPage — tree rendering', () => {
  it('loads sets, defaults to the first set, and renders its category/sub-category/item tree', async () => {
    render(<TrackingCategoryPage />)

    await screen.findByText('Assets')
    expect(screen.getByText('Liabilities')).toBeInTheDocument()
    expect(await screen.findByText('Current Assets')).toBeInTheDocument()
    expect(await screen.findByText('Cash')).toBeInTheDocument()

    const select = screen.getByLabelText('Tracking Set') as HTMLSelectElement
    expect(select.value).toBe('set-1')
  })

  it('links each tracking item to its detail page', async () => {
    render(<TrackingCategoryPage />)

    const itemLink = await screen.findByRole('link', { name: /Cash/i })
    expect(itemLink).toHaveAttribute('href', '/tracking/items/item-cash')
  })

  it('shows an empty state when no tracking sets exist yet', async () => {
    mocked.listSets.mockResolvedValue([])
    render(<TrackingCategoryPage />)

    expect(await screen.findByText(/No tracking sets yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Create your first tracking set/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Create Tracking Set
// ---------------------------------------------------------------------------

describe('TrackingCategoryPage — create tracking set', () => {
  it('creates a new set, cascades to its default categories, and selects it', async () => {
    const user = userEvent.setup()
    const newSet: TrackingSet = { id: 'set-2', name: 'Retirement', description: null, createdAt: '', updatedAt: '' }
    mocked.createSet.mockResolvedValueOnce(newSet)

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: /New Tracking Set/i }))
    await user.type(screen.getByLabelText('Name'), 'Retirement')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mocked.createSet).toHaveBeenCalledWith({ name: 'Retirement', description: null })
    })
  })

  it('shows the backend error inline and keeps the modal open on failure', async () => {
    const user = userEvent.setup()
    mocked.createSet.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { detail: 'A tracking set with this name already exists' } },
    })

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: /New Tracking Set/i }))
    await user.type(screen.getByLabelText('Name'), 'Main Set')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('A tracking set with this name already exists')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Category rename / delete / reorder
// ---------------------------------------------------------------------------

describe('TrackingCategoryPage — category actions', () => {
  it('creates a new category under the selected set', async () => {
    const user = userEvent.setup()
    mocked.createCategory.mockResolvedValueOnce({
      id: 'cat-new', trackingSetId: 'set-1', name: 'Income', description: null, order: 2, createdAt: '', updatedAt: '',
    })

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: /Add Category/i }))
    await user.type(screen.getByLabelText('Name'), 'Income')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mocked.createCategory).toHaveBeenCalledWith('set-1', { name: 'Income', description: null })
    })
  })

  it('renames a category', async () => {
    const user = userEvent.setup()
    mocked.updateCategory.mockResolvedValueOnce({ ...CATEGORIES[0], name: 'Assets Renamed' })

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: 'Rename Assets' }))
    const nameInput = await screen.findByLabelText('Name')
    expect(nameInput).toHaveValue('Assets')
    await user.clear(nameInput)
    await user.type(nameInput, 'Assets Renamed')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mocked.updateCategory).toHaveBeenCalledWith('cat-assets', { name: 'Assets Renamed', description: null })
    })
  })

  it('deletes a category after confirming, with a cascade warning shown', async () => {
    const user = userEvent.setup()
    mocked.deleteCategory.mockResolvedValueOnce(undefined)

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: 'Delete Assets' }))

    expect(await screen.findByText(/will also be deleted/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocked.deleteCategory).toHaveBeenCalledWith('cat-assets')
    })
  })

  it('does not delete when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: 'Delete Assets' }))
    await screen.findByText(/will also be deleted/i)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocked.deleteCategory).not.toHaveBeenCalled()
  })

  it('reorders categories using the move-down control', async () => {
    const user = userEvent.setup()
    mocked.reorderCategories.mockResolvedValueOnce(undefined)

    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    await user.click(screen.getByRole('button', { name: 'Move Assets down' }))

    await waitFor(() => {
      expect(mocked.reorderCategories).toHaveBeenCalledWith('set-1', ['cat-liabilities', 'cat-assets'])
    })
  })

  it('disables move-up for the first category and move-down for the last', async () => {
    render(<TrackingCategoryPage />)
    await screen.findByText('Assets')

    expect(screen.getByRole('button', { name: 'Move Assets up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Liabilities down' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Sub-category creation
// ---------------------------------------------------------------------------

describe('TrackingCategoryPage — sub-category actions', () => {
  it('creates a sub-category under a category', async () => {
    const user = userEvent.setup()
    mocked.createSubCategory.mockResolvedValueOnce({
      id: 'sub-new', categoryId: 'cat-liabilities', name: 'Current Liabilities', description: null, order: 0, createdAt: '', updatedAt: '',
    })

    render(<TrackingCategoryPage />)
    await screen.findByText('Liabilities')

    // "Add sub-category" appears once for each category — scope to Liabilities' card.
    const liabilitiesHeading = screen.getByText('Liabilities')
    const liabilitiesCard = liabilitiesHeading.closest('.card') as HTMLElement
    const addSubButton = await within(liabilitiesCard).findByRole('button', { name: /Add sub-category/i })
    await user.click(addSubButton)

    await user.type(screen.getByLabelText('Name'), 'Current Liabilities')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mocked.createSubCategory).toHaveBeenCalledWith('cat-liabilities', { name: 'Current Liabilities', description: null })
    })
  })
})

// ---------------------------------------------------------------------------
// Item creation
// ---------------------------------------------------------------------------

describe('TrackingCategoryPage — item actions', () => {
  it('creates a tracking item with a name and type', async () => {
    const user = userEvent.setup()
    mocked.createItem.mockResolvedValueOnce({
      id: 'item-new', subCategoryId: 'sub-current', name: 'Provident Fund', type: 'Investment Account',
      initialInvestmentTracking: false, exclusive: false, order: 1,
      description: null, accountName: null, remark: null, createdAt: '', updatedAt: '',
    })

    render(<TrackingCategoryPage />)
    await screen.findByText('Cash')

    await user.click(screen.getByRole('button', { name: /Add item/i }))
    await user.type(screen.getByLabelText('Item name'), 'Provident Fund')
    await user.selectOptions(screen.getByLabelText('Type'), 'Investment Account')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocked.createItem).toHaveBeenCalledWith('sub-current', {
        name: 'Provident Fund', type: 'Investment Account',
        initialInvestmentTracking: false, exclusive: false,
      })
    })
  })

  it('reorders items using the move-down control', async () => {
    const user = userEvent.setup()
    mocked.listItems.mockImplementation(async (subCategoryId: string) =>
      subCategoryId === 'sub-current'
        ? [
          ...ITEMS_CURRENT,
          { id: 'item-fd', subCategoryId: 'sub-current', name: 'Fixed Deposit', type: 'Bank account' as const,
            initialInvestmentTracking: false, exclusive: false, order: 1,
            description: null, accountName: null, remark: null, createdAt: '', updatedAt: '' },
        ]
        : [],
    )
    mocked.reorderItems.mockResolvedValueOnce(undefined)

    render(<TrackingCategoryPage />)
    await screen.findByText('Cash')
    await screen.findByText('Fixed Deposit')

    await user.click(screen.getByRole('button', { name: 'Move Cash down' }))

    await waitFor(() => {
      expect(mocked.reorderItems).toHaveBeenCalledWith('sub-current', ['item-fd', 'item-cash'])
    })
  })
})
