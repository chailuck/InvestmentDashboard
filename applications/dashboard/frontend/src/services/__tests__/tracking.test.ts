import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  trackingService,
  TRACKING_ITEM_TYPES,
  type TrackingSet, type Category, type SubCategory, type TrackingItem,
  type Entry, type RunningTotal, type DashboardBalanceGridOut, type TrackingSetExport,
  type OriginalInvestmentRollup,
} from '@/services/tracking'
import { apiClient, extractApiError } from '@/services/api'

// ---------------------------------------------------------------------------
// Mock the API client so no real HTTP requests are made
// ---------------------------------------------------------------------------

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    // extractApiError is a pure function — keep the real implementation so we
    // can verify it against realistic axios-error shapes below.
    extractApiError: actual.extractApiError,
  }
})

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)
const mockedPut = vi.mocked(apiClient.put)
const mockedDelete = vi.mocked(apiClient.delete)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// TRACKING_ITEM_TYPES
// ---------------------------------------------------------------------------

describe('TRACKING_ITEM_TYPES', () => {
  it('contains exactly the 6 required enum values', () => {
    expect(TRACKING_ITEM_TYPES).toEqual([
      'Bank account', 'Property', 'Investment Account', 'TaxSaving', 'Materials', 'Insurance',
    ])
  })
})

// ---------------------------------------------------------------------------
// Tracking Sets
// ---------------------------------------------------------------------------

describe('trackingService — Tracking Sets', () => {
  it('listSets calls GET /tracking/sets', async () => {
    const sets: TrackingSet[] = [
      { id: 's1', name: 'My Set', description: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]
    mockedGet.mockResolvedValueOnce({ data: sets })

    const result = await trackingService.listSets()

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets')
    expect(result).toEqual(sets)
  })

  it('createSet calls POST /tracking/sets with name and description', async () => {
    const created: TrackingSet = { id: 's2', name: 'New Set', description: 'desc', createdAt: '', updatedAt: '' }
    mockedPost.mockResolvedValueOnce({ data: created })

    const result = await trackingService.createSet({ name: 'New Set', description: 'desc' })

    expect(mockedPost).toHaveBeenCalledWith('/tracking/sets', { name: 'New Set', description: 'desc' })
    expect(result).toEqual(created)
  })

  it('updateSet calls PUT /tracking/sets/{id}', async () => {
    mockedPut.mockResolvedValueOnce({ data: {} })
    await trackingService.updateSet('s1', { name: 'Renamed' })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/sets/s1', { name: 'Renamed' })
  })

  it('deleteSet calls DELETE /tracking/sets/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await trackingService.deleteSet('s1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/sets/s1')
  })

  it('propagates errors from the API client (network failure)', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))
    await expect(trackingService.listSets()).rejects.toThrow('Network error')
  })
})

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

describe('trackingService — Categories', () => {
  it('listCategories calls GET /tracking/sets/{setId}/categories', async () => {
    const categories: Category[] = [
      { id: 'c1', trackingSetId: 's1', name: 'Assets', description: null, order: 0, createdAt: '', updatedAt: '' },
    ]
    mockedGet.mockResolvedValueOnce({ data: categories })

    const result = await trackingService.listCategories('s1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets/s1/categories')
    expect(result).toEqual(categories)
  })

  it('createCategory calls POST /tracking/sets/{setId}/categories', async () => {
    mockedPost.mockResolvedValueOnce({ data: {} })
    await trackingService.createCategory('s1', { name: 'Assets', description: null })
    expect(mockedPost).toHaveBeenCalledWith('/tracking/sets/s1/categories', { name: 'Assets', description: null })
  })

  it('updateCategory calls PUT /tracking/categories/{id}', async () => {
    mockedPut.mockResolvedValueOnce({ data: {} })
    await trackingService.updateCategory('c1', { name: 'Renamed' })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/categories/c1', { name: 'Renamed' })
  })

  it('deleteCategory calls DELETE /tracking/categories/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await trackingService.deleteCategory('c1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/categories/c1')
  })

  it('reorderCategories calls PUT /tracking/sets/{setId}/categories/reorder with { items: [{id, order}] }', async () => {
    mockedPut.mockResolvedValueOnce({ data: undefined })
    await trackingService.reorderCategories('s1', ['c2', 'c1'])
    expect(mockedPut).toHaveBeenCalledWith('/tracking/sets/s1/categories/reorder', {
      items: [{ id: 'c2', order: 1 }, { id: 'c1', order: 2 }],
    })
    expect(mockedPost).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Sub-categories
// ---------------------------------------------------------------------------

describe('trackingService — Sub-categories', () => {
  it('listSubCategories calls GET /tracking/categories/{categoryId}/sub-categories', async () => {
    const subs: SubCategory[] = [
      { id: 'sc1', categoryId: 'c1', name: 'Current Assets', description: null, order: 0, createdAt: '', updatedAt: '' },
    ]
    mockedGet.mockResolvedValueOnce({ data: subs })

    const result = await trackingService.listSubCategories('c1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/categories/c1/sub-categories')
    expect(result).toEqual(subs)
  })

  it('createSubCategory calls POST /tracking/categories/{categoryId}/sub-categories', async () => {
    mockedPost.mockResolvedValueOnce({ data: {} })
    await trackingService.createSubCategory('c1', { name: 'Property' })
    expect(mockedPost).toHaveBeenCalledWith('/tracking/categories/c1/sub-categories', { name: 'Property' })
  })

  it('updateSubCategory calls PUT /tracking/sub-categories/{id}', async () => {
    mockedPut.mockResolvedValueOnce({ data: {} })
    await trackingService.updateSubCategory('sc1', { name: 'Renamed' })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/sub-categories/sc1', { name: 'Renamed' })
  })

  it('deleteSubCategory calls DELETE /tracking/sub-categories/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await trackingService.deleteSubCategory('sc1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/sub-categories/sc1')
  })

  it('reorderSubCategories calls PUT /tracking/categories/{categoryId}/sub-categories/reorder with { items: [{id, order}] }', async () => {
    mockedPut.mockResolvedValueOnce({ data: undefined })
    await trackingService.reorderSubCategories('c1', ['sc2', 'sc1'])
    expect(mockedPut).toHaveBeenCalledWith('/tracking/categories/c1/sub-categories/reorder', {
      items: [{ id: 'sc2', order: 1 }, { id: 'sc1', order: 2 }],
    })
    expect(mockedPost).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tracking Items
// ---------------------------------------------------------------------------

describe('trackingService — Tracking Items', () => {
  const ITEM: TrackingItem = {
    id: 'i1', subCategoryId: 'sc1', name: 'Kasikorn Savings', type: 'Bank account',
    initialInvestmentTracking: true, exclusive: false, order: 0,
    description: null, accountName: 'xxx-1', remark: null, createdAt: '', updatedAt: '',
  }

  it('listItems calls GET /tracking/sub-categories/{subCategoryId}/items', async () => {
    mockedGet.mockResolvedValueOnce({ data: [ITEM] })
    const result = await trackingService.listItems('sc1')
    expect(mockedGet).toHaveBeenCalledWith('/tracking/sub-categories/sc1/items')
    expect(result).toEqual([ITEM])
  })

  it('getItem calls GET /tracking/items/{id}', async () => {
    mockedGet.mockResolvedValueOnce({ data: ITEM })
    const result = await trackingService.getItem('i1')
    expect(mockedGet).toHaveBeenCalledWith('/tracking/items/i1')
    expect(result).toEqual(ITEM)
  })

  it('createItem calls POST /tracking/sub-categories/{subCategoryId}/items with full input', async () => {
    mockedPost.mockResolvedValueOnce({ data: ITEM })
    const input = {
      name: 'Kasikorn Savings', type: 'Bank account' as const,
      initialInvestmentTracking: false, exclusive: false,
    }
    await trackingService.createItem('sc1', input)
    expect(mockedPost).toHaveBeenCalledWith('/tracking/sub-categories/sc1/items', input)
  })

  it('updateItem calls PUT /tracking/items/{id} and accepts partial input', async () => {
    mockedPut.mockResolvedValueOnce({ data: ITEM })
    await trackingService.updateItem('i1', { name: 'Renamed' })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/items/i1', { name: 'Renamed' })
  })

  it('deleteItem calls DELETE /tracking/items/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await trackingService.deleteItem('i1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/items/i1')
  })

  it('reorderItems calls PUT /tracking/sub-categories/{subCategoryId}/items/reorder with { items: [{id, order}] }', async () => {
    mockedPut.mockResolvedValueOnce({ data: undefined })
    await trackingService.reorderItems('sc1', ['i2', 'i1'])
    expect(mockedPut).toHaveBeenCalledWith('/tracking/sub-categories/sc1/items/reorder', {
      items: [{ id: 'i2', order: 1 }, { id: 'i1', order: 2 }],
    })
    expect(mockedPost).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Ledger entries
// ---------------------------------------------------------------------------

describe('trackingService — Ledger entries', () => {
  const ENTRY: Entry = { id: 'e1', trackingItemId: 'i1', amount: 1000, entryDate: '2026-01-01', note: null, createdAt: '', updatedAt: '' }

  it('listEntries calls GET /tracking/items/{itemId}/entries', async () => {
    mockedGet.mockResolvedValueOnce({ data: [ENTRY] })
    const result = await trackingService.listEntries('i1')
    expect(mockedGet).toHaveBeenCalledWith('/tracking/items/i1/entries')
    expect(result).toEqual([ENTRY])
  })

  it('createEntry calls POST /tracking/items/{itemId}/entries with amount and entryDate', async () => {
    mockedPost.mockResolvedValueOnce({ data: ENTRY })
    await trackingService.createEntry('i1', { amount: 1000, entryDate: '2026-01-01' })
    expect(mockedPost).toHaveBeenCalledWith('/tracking/items/i1/entries', { amount: 1000, entryDate: '2026-01-01' })
  })

  it('createEntry forwards an optional note (UTF-8 / Thai) verbatim in the request body', async () => {
    mockedPost.mockResolvedValueOnce({ data: { ...ENTRY, note: 'เงินโบนัส' } })
    await trackingService.createEntry('i1', { amount: 1000, entryDate: '2026-01-01', note: 'เงินโบนัส' })
    expect(mockedPost).toHaveBeenCalledWith('/tracking/items/i1/entries', {
      amount: 1000, entryDate: '2026-01-01', note: 'เงินโบนัส',
    })
  })

  it('updateEntry calls PUT /tracking/entries/{id}', async () => {
    mockedPut.mockResolvedValueOnce({ data: ENTRY })
    await trackingService.updateEntry('e1', { amount: -500, entryDate: '2026-02-01' })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/entries/e1', { amount: -500, entryDate: '2026-02-01' })
  })

  it('updateEntry forwards an explicit null note (clear-the-note intent) in the request body', async () => {
    mockedPut.mockResolvedValueOnce({ data: ENTRY })
    await trackingService.updateEntry('e1', { amount: -500, entryDate: '2026-02-01', note: null })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/entries/e1', {
      amount: -500, entryDate: '2026-02-01', note: null,
    })
  })

  it('deleteEntry calls DELETE /tracking/entries/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await trackingService.deleteEntry('e1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/entries/e1')
  })

  it('getRunningTotal calls GET /tracking/items/{itemId}/running-total', async () => {
    const runningTotal: RunningTotal = {
      itemId: 'i1', currentTotal: 500,
      entries: [
        { ...ENTRY, runningTotal: 1000 },
        { id: 'e2', trackingItemId: 'i1', amount: -500, entryDate: '2026-02-01', note: 'partial sell', createdAt: '', updatedAt: '', runningTotal: 500 },
      ],
      profitVsOriginal: {
        netOriginalInvestment: 500, currentValue: 620,
        currentValueSlot: { year: 2026, quarter: 2 },
        profit: 120, profitPercent: 24, isCovered: true,
      },
    }
    mockedGet.mockResolvedValueOnce({ data: runningTotal })

    const result = await trackingService.getRunningTotal('i1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/items/i1/running-total')
    expect(result).toEqual(runningTotal)
  })

  it('getRunningTotal coerces backend Decimal-as-string money fields to numbers', async () => {
    // The tracking backend serializes every Pydantic Decimal as a JSON STRING
    // ("0", "1200.4000", …). Consumer UI calls .toFixed()/arithmetic on these,
    // so the service must coerce them or the ledger page throws on first render
    // ("n.toFixed is not a function").
    mockedGet.mockResolvedValueOnce({
      data: {
        itemId: 'i1',
        currentTotal: '0',
        entries: [
          { id: 'e1', trackingItemId: 'i1', amount: '1000.0000', entryDate: '2026-01-01', note: null, createdAt: '', updatedAt: '', runningTotal: '1000.0000' },
        ],
        profitVsOriginal: {
          netOriginalInvestment: '1000.0000', currentValue: '1250.5000',
          currentValueSlot: { year: 2026, quarter: 2 },
          profit: '250.5000', profitPercent: '25.0500', isCovered: true,
        },
      },
    })

    const r = await trackingService.getRunningTotal('i1')

    expect(r.currentTotal).toBe(0)
    expect(typeof r.currentTotal).toBe('number')
    expect(r.entries[0].amount).toBe(1000)
    expect(r.entries[0].runningTotal).toBe(1000)
    expect(r.profitVsOriginal.netOriginalInvestment).toBe(1000)
    expect(r.profitVsOriginal.currentValue).toBe(1250.5)
    expect(r.profitVsOriginal.profit).toBe(250.5)
    expect(r.profitVsOriginal.profitPercent).toBe(25.05)
    expect(() => r.profitVsOriginal.profitPercent?.toFixed(2)).not.toThrow()
  })

  it('getRunningTotal keeps null profitVsOriginal fields null (never a fabricated 0)', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        itemId: 'i1', currentTotal: '0', entries: [],
        profitVsOriginal: {
          netOriginalInvestment: null, currentValue: null, currentValueSlot: null,
          profit: null, profitPercent: null, isCovered: false,
        },
      },
    })
    const r = await trackingService.getRunningTotal('i1')
    expect(r.profitVsOriginal.netOriginalInvestment).toBeNull()
    expect(r.profitVsOriginal.profit).toBeNull()
    expect(r.profitVsOriginal.profitPercent).toBeNull()
    expect(r.currentTotal).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe('trackingService — Dashboard', () => {
  it('getBalanceGrid calls GET /tracking/sets/{setId}/dashboard/balance-grid and returns the typed grid', async () => {
    const grid: DashboardBalanceGridOut = {
      trackingSetId: 's1',
      years: [{ year: 2026, quarters: [1, 2, 3, 4] }],
      categories: [],
      grandTotal: [
        { year: 2026, quarter: 1, balance: 1000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2026, quarter: 2, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
        { year: 2026, quarter: 3, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
        { year: 2026, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
      ],
      propertyBreakdown: {
        propertyTotal: [
          { year: 2026, quarter: 1, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
          { year: 2026, quarter: 2, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
          { year: 2026, quarter: 3, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
          { year: 2026, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
        ],
        nonPropertyTotal: [
          { year: 2026, quarter: 1, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
          { year: 2026, quarter: 2, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
          { year: 2026, quarter: 3, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
          { year: 2026, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
        ],
      },
    }
    mockedGet.mockResolvedValueOnce({ data: grid })

    const result = await trackingService.getBalanceGrid('s1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets/s1/dashboard/balance-grid')
    expect(result).toEqual(grid)
  })

  it('propagates errors from the API client for getBalanceGrid', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))
    await expect(trackingService.getBalanceGrid('s1')).rejects.toThrow('Network error')
  })

  it('getOriginalInvestmentRollup calls GET /tracking/sets/{setId}/dashboard/original-investment and returns the typed rollup', async () => {
    const rollup: OriginalInvestmentRollup = {
      trackingSetId: 's1',
      generatedAt: '2026-08-30T07:30:00+00:00',
      coverage: { shownCount: 1, totalCount: 2, excludedItemNames: ['Condo Bangkok'] },
      items: [
        {
          itemId: 'it1', itemName: 'ARK Growth', categoryName: 'Investments', subCategoryName: 'US Equity',
          netOriginalInvestment: 100000, currentValue: 132000,
          currentValueSlot: { year: 2026, quarter: 2 },
          profit: 32000, profitPercent: 32, isCovered: true,
        },
        {
          itemId: 'it2', itemName: 'Condo Bangkok', categoryName: 'Property', subCategoryName: 'Real estate',
          netOriginalInvestment: null, currentValue: 5200000,
          currentValueSlot: { year: 2026, quarter: 1 },
          profit: null, profitPercent: null, isCovered: false,
        },
      ],
      totals: { netOriginalInvestment: 100000, currentValue: 132000, profit: 32000, profitPercent: 32 },
    }
    mockedGet.mockResolvedValueOnce({ data: rollup })

    const result = await trackingService.getOriginalInvestmentRollup('s1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets/s1/dashboard/original-investment')
    expect(result).toEqual(rollup)
  })

  it('getOriginalInvestmentRollup coerces Decimal-as-string fields and preserves nulls', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        trackingSetId: 's1', generatedAt: '2026-08-31T00:00:00+00:00',
        coverage: { shownCount: 1, totalCount: 2, excludedItemNames: ['Condo'] },
        items: [
          {
            itemId: 'it1', itemName: 'ARK', categoryName: 'Inv', subCategoryName: 'US',
            netOriginalInvestment: '100000.0000', currentValue: '132000.0000',
            currentValueSlot: { year: 2026, quarter: 2 },
            profit: '32000.0000', profitPercent: '32.0000', isCovered: true,
          },
          {
            itemId: 'it2', itemName: 'Condo', categoryName: 'Prop', subCategoryName: 'RE',
            netOriginalInvestment: null, currentValue: '5200000.0000',
            currentValueSlot: { year: 2026, quarter: 1 },
            profit: null, profitPercent: null, isCovered: false,
          },
        ],
        totals: { netOriginalInvestment: '100000.0000', currentValue: '132000.0000', profit: '32000.0000', profitPercent: '32.0000' },
      },
    })

    const r = await trackingService.getOriginalInvestmentRollup('s1')

    expect(r.items[0].netOriginalInvestment).toBe(100000)
    expect(r.items[0].currentValue).toBe(132000)
    expect(r.items[0].profitPercent).toBe(32)
    expect(() => r.items[0].profitPercent?.toFixed(2)).not.toThrow()
    expect(r.items[1].netOriginalInvestment).toBeNull()
    expect(r.items[1].profit).toBeNull()
    expect(r.items[1].profitPercent).toBeNull()
    expect(r.totals.profit).toBe(32000)
    expect(r.totals.profitPercent).toBe(32)
  })

  it('propagates errors from the API client for getOriginalInvestmentRollup', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))
    await expect(trackingService.getOriginalInvestmentRollup('s1')).rejects.toThrow('Network error')
  })
})

// ---------------------------------------------------------------------------
// Full backup export (Email Dashboard feature)
// ---------------------------------------------------------------------------

describe('trackingService — Export', () => {
  it('getExport calls GET /tracking/sets/{setId}/export and returns the typed export envelope', async () => {
    const exportData: TrackingSetExport = {
      exportVersion: 1,
      exportedAt: '2026-08-24T00:00:00Z',
      trackingSet: { id: 's1', name: 'My Set', description: null, createdAt: '', updatedAt: '' },
      categories: [{ id: 'c1' }],
      subCategories: [],
      trackingItems: [],
      updateTrackingLists: [],
      updateTrackingListBalances: [],
      initialInvestmentEntries: [],
    }
    mockedGet.mockResolvedValueOnce({ data: exportData })

    const result = await trackingService.getExport('s1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets/s1/export')
    expect(result).toEqual(exportData)
  })

  it('propagates a 404 for a missing/not-owned tracking set', async () => {
    const err = { isAxiosError: true, response: { status: 404, data: { detail: 'Tracking set not found' } } }
    mockedGet.mockRejectedValueOnce(err)
    await expect(trackingService.getExport('missing')).rejects.toEqual(err)
  })
})

// ---------------------------------------------------------------------------
// Error shape — backend returns { detail: "..." } per FastAPI convention
// ---------------------------------------------------------------------------

describe('trackingService — error shape (extractApiError)', () => {
  it('surfaces the backend "detail" message for a 404', () => {
    const err = { isAxiosError: true, response: { status: 404, data: { detail: 'Tracking set not found' } } }
    expect(extractApiError(err)).toBe('Tracking set not found')
  })

  it('surfaces the backend "detail" message for a 409 conflict', () => {
    const err = { isAxiosError: true, response: { status: 409, data: { detail: 'Category name already exists in this set' } } }
    expect(extractApiError(err)).toBe('Category name already exists in this set')
  })

  it('surfaces the backend "detail" message for a 400 validation error', () => {
    const err = { isAxiosError: true, response: { status: 400, data: { detail: 'Amount must be non-zero' } } }
    expect(extractApiError(err)).toBe('Amount must be non-zero')
  })

  it('surfaces the backend "detail" message for a 503', () => {
    const err = { isAxiosError: true, response: { status: 503, data: { detail: 'Tracking service unavailable' } } }
    expect(extractApiError(err)).toBe('Tracking service unavailable')
  })

  it('falls back to a generic message for non-axios errors', () => {
    expect(extractApiError(new Error('boom'))).toBe('An unexpected error occurred')
  })
})
