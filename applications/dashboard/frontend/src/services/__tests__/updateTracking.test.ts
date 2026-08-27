import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  updateTrackingService,
  type UpdateTrackingList, type UpdateTrackingListDetail, type UpdateTrackingListBalance,
} from '@/services/updateTracking'
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
// Update Tracking Lists — CRUD
// ---------------------------------------------------------------------------

describe('updateTrackingService — Update Tracking Lists', () => {
  const LIST: UpdateTrackingList = {
    id: 'ul-1', trackingSetId: 'set-1', transactionDate: '2026-06-30', quarter: 2, year: 2026,
    createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T00:00:00Z',
  }

  it('listUpdateLists calls GET /tracking/sets/{setId}/update-lists', async () => {
    mockedGet.mockResolvedValueOnce({ data: [LIST] })

    const result = await updateTrackingService.listUpdateLists('set-1')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/sets/set-1/update-lists')
    expect(result).toEqual([LIST])
  })

  it('createUpdateList calls POST /tracking/sets/{setId}/update-lists with transactionDate, quarter, and year', async () => {
    mockedPost.mockResolvedValueOnce({ data: LIST })

    const result = await updateTrackingService.createUpdateList('set-1', {
      transactionDate: '2026-06-30', quarter: 2, year: 2026,
    })

    expect(mockedPost).toHaveBeenCalledWith('/tracking/sets/set-1/update-lists', {
      transactionDate: '2026-06-30', quarter: 2, year: 2026,
    })
    expect(result).toEqual(LIST)
  })

  it('getUpdateList calls GET /tracking/update-lists/{id}', async () => {
    mockedGet.mockResolvedValueOnce({ data: LIST })
    const result = await updateTrackingService.getUpdateList('ul-1')
    expect(mockedGet).toHaveBeenCalledWith('/tracking/update-lists/ul-1')
    expect(result).toEqual(LIST)
  })

  it('updateUpdateList calls PUT /tracking/update-lists/{id} with a partial payload', async () => {
    mockedPut.mockResolvedValueOnce({ data: { ...LIST, quarter: 3 } })
    await updateTrackingService.updateUpdateList('ul-1', { quarter: 3 })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/update-lists/ul-1', { quarter: 3 })
  })

  it('updateUpdateList supports clearing quarter and year independently (null)', async () => {
    mockedPut.mockResolvedValueOnce({ data: { ...LIST, quarter: null, year: null } })
    await updateTrackingService.updateUpdateList('ul-1', { quarter: null, year: null })
    expect(mockedPut).toHaveBeenCalledWith('/tracking/update-lists/ul-1', { quarter: null, year: null })
  })

  it('deleteUpdateList calls DELETE /tracking/update-lists/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })
    await updateTrackingService.deleteUpdateList('ul-1')
    expect(mockedDelete).toHaveBeenCalledWith('/tracking/update-lists/ul-1')
  })

  it('propagates errors from the API client (network failure)', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))
    await expect(updateTrackingService.listUpdateLists('set-1')).rejects.toThrow('Network error')
  })
})

// ---------------------------------------------------------------------------
// Detail + balances
// ---------------------------------------------------------------------------

describe('updateTrackingService — detail and balances', () => {
  const DETAIL: UpdateTrackingListDetail = {
    list: {
      id: 'ul-2', trackingSetId: 'set-1', transactionDate: '2026-06-30', quarter: null, year: null,
      createdAt: '', updatedAt: '',
    },
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
                balance: 500, previousBalance: null, deltaAmount: null, deltaPercent: null,
                hasPreviousData: false,
              },
            ],
          },
        ],
      },
    ],
  }

  it('getUpdateListDetail calls GET /tracking/update-lists/{id}/detail and returns the full hierarchy', async () => {
    mockedGet.mockResolvedValueOnce({ data: DETAIL })

    const result = await updateTrackingService.getUpdateListDetail('ul-2')

    expect(mockedGet).toHaveBeenCalledWith('/tracking/update-lists/ul-2/detail')
    expect(result).toEqual(DETAIL)
    expect(result.previousListId).toBe('ul-1')
    expect(result.categories[0].subCategories[0].items[1].hasPreviousData).toBe(false)
  })

  it('upsertBalances calls PUT /tracking/update-lists/{id}/balances with a { balances } wrapper', async () => {
    const saved: UpdateTrackingListBalance[] = [
      { id: 'b-1', updateTrackingListId: 'ul-2', trackingItemId: 'item-1', balance: 1200, createdAt: '', updatedAt: '' },
    ]
    mockedPut.mockResolvedValueOnce({ data: saved })

    const result = await updateTrackingService.upsertBalances('ul-2', [{ trackingItemId: 'item-1', balance: 1200 }])

    expect(mockedPut).toHaveBeenCalledWith('/tracking/update-lists/ul-2/balances', {
      balances: [{ trackingItemId: 'item-1', balance: 1200 }],
    })
    expect(result).toEqual(saved)
  })

  it('upsertBalances supports a null balance (clearing a value)', async () => {
    mockedPut.mockResolvedValueOnce({ data: [] })
    await updateTrackingService.upsertBalances('ul-2', [{ trackingItemId: 'item-2', balance: null }])
    expect(mockedPut).toHaveBeenCalledWith('/tracking/update-lists/ul-2/balances', {
      balances: [{ trackingItemId: 'item-2', balance: null }],
    })
  })

  it('surfaces the backend 400 detail when an item does not belong to the tracking set', async () => {
    const err = {
      isAxiosError: true,
      response: { status: 400, data: { detail: 'One or more tracking items do not belong to this update list\'s tracking set' } },
    }
    mockedPut.mockRejectedValueOnce(err)

    await expect(
      updateTrackingService.upsertBalances('ul-2', [{ trackingItemId: 'not-mine', balance: 1 }]),
    ).rejects.toEqual(err)
    expect(extractApiError(err)).toBe('One or more tracking items do not belong to this update list\'s tracking set')
  })
})
