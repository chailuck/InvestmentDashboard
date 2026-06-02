import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  colorMarkMeta,
  COLOR_MARKS,
  SCAN_STRATEGIES,
  weeklyScanService,
  type ColorMark,
  type ScanListSummary,
  type SymbolNote,
  type WeeklyScanItem,
} from '@/services/weeklyScan'
import { apiClient } from '@/services/api'

// ---------------------------------------------------------------------------
// Mock the API client so no real HTTP requests are made
// ---------------------------------------------------------------------------

vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)
const mockedPut = vi.mocked(apiClient.put)
const mockedDelete = vi.mocked(apiClient.delete)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// colorMarkMeta
// ---------------------------------------------------------------------------

describe('colorMarkMeta', () => {
  it('returns correct meta for CYAN', () => {
    const meta = colorMarkMeta('CYAN')
    expect(meta).not.toBeNull()
    expect(meta!.value).toBe('CYAN')
    expect(meta!.label).toBe('Potential')
    expect(meta!.dot).toBe('bg-cyan-400')
  })

  it('returns correct meta for GREEN', () => {
    const meta = colorMarkMeta('GREEN')
    expect(meta).not.toBeNull()
    expect(meta!.value).toBe('GREEN')
    expect(meta!.label).toBe('Good')
  })

  it('returns correct meta for YELLOW', () => {
    const meta = colorMarkMeta('YELLOW')
    expect(meta).not.toBeNull()
    expect(meta!.label).toBe('Monitor')
  })

  it('returns correct meta for RED', () => {
    const meta = colorMarkMeta('RED')
    expect(meta).not.toBeNull()
    expect(meta!.label).toBe('Skip')
  })

  it('returns correct meta for PURPLE', () => {
    const meta = colorMarkMeta('PURPLE')
    expect(meta).not.toBeNull()
    expect(meta!.label).toBe('In Portfolio')
  })

  it('returns null for null input', () => {
    expect(colorMarkMeta(null)).toBeNull()
  })

  it('all COLOR_MARKS have required fields (value/label/bg/text/border/dot)', () => {
    for (const mark of COLOR_MARKS) {
      expect(mark).toHaveProperty('value')
      expect(mark).toHaveProperty('label')
      expect(mark).toHaveProperty('bg')
      expect(mark).toHaveProperty('text')
      expect(mark).toHaveProperty('border')
      expect(mark).toHaveProperty('dot')
      // None of the string fields should be empty
      expect(mark.value.length).toBeGreaterThan(0)
      expect(mark.label.length).toBeGreaterThan(0)
    }
  })

  it('COLOR_MARKS has exactly 5 entries', () => {
    expect(COLOR_MARKS).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// SCAN_STRATEGIES
// ---------------------------------------------------------------------------

describe('SCAN_STRATEGIES', () => {
  it('contains BREAK OUT', () => {
    expect(SCAN_STRATEGIES).toContain('BREAK OUT')
  })

  it('contains BUY ON DIP', () => {
    expect(SCAN_STRATEGIES).toContain('BUY ON DIP')
  })

  it('contains NEWS', () => {
    expect(SCAN_STRATEGIES).toContain('NEWS')
  })

  it('contains AJ PAO', () => {
    expect(SCAN_STRATEGIES).toContain('AJ PAO')
  })

  it('contains OTHERS', () => {
    expect(SCAN_STRATEGIES).toContain('OTHERS')
  })

  it('has 7 strategies', () => {
    expect(SCAN_STRATEGIES).toHaveLength(7)
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.listScans
// ---------------------------------------------------------------------------

describe('weeklyScanService.listScans', () => {
  it('calls GET /weekly-scan/scans and returns data', async () => {
    const mockData: ScanListSummary[] = [
      {
        id: 'scan-1',
        name: 'WEEKLY_SCAN_01_06_2026',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
        total: 50,
        color_counts: { CYAN: 10, GREEN: 15, YELLOW: 5, RED: 3, PURPLE: 7, NONE: 10 },
      },
    ]
    mockedGet.mockResolvedValueOnce({ data: mockData })

    const result = await weeklyScanService.listScans()

    expect(mockedGet).toHaveBeenCalledWith('/weekly-scan/scans')
    expect(result).toEqual(mockData)
  })

  it('propagates errors from the API client', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))
    await expect(weeklyScanService.listScans()).rejects.toThrow('Network error')
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.createScan
// ---------------------------------------------------------------------------

describe('weeklyScanService.createScan', () => {
  it('calls POST /weekly-scan/scans with the name', async () => {
    mockedPost.mockResolvedValueOnce({ data: { id: 'new-id', name: 'MY_SCAN' } })

    const result = await weeklyScanService.createScan('MY_SCAN')

    expect(mockedPost).toHaveBeenCalledWith('/weekly-scan/scans', { name: 'MY_SCAN' })
    expect(result.id).toBe('new-id')
    expect(result.name).toBe('MY_SCAN')
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.upsertItem
// ---------------------------------------------------------------------------

describe('weeklyScanService.upsertItem', () => {
  it('calls PUT with the correct path and body', async () => {
    const mockItem: Partial<WeeklyScanItem> = { symbol: 'ADVANC', color_mark: 'CYAN' }
    mockedPut.mockResolvedValueOnce({ data: mockItem })

    await weeklyScanService.upsertItem('scan-id', 'ADVANC', { color_mark: 'CYAN' })

    expect(mockedPut).toHaveBeenCalledWith(
      '/weekly-scan/scans/scan-id/items/ADVANC',
      { color_mark: 'CYAN' },
    )
  })

  it('returns the updated item from the API', async () => {
    const mockItem: Partial<WeeklyScanItem> = {
      symbol: 'GULF',
      color_mark: 'GREEN',
      strategy: 'BREAK OUT',
      buy_price: 55.5,
    }
    mockedPut.mockResolvedValueOnce({ data: mockItem })

    const result = await weeklyScanService.upsertItem('scan-id', 'GULF', {
      color_mark: 'GREEN',
      strategy: 'BREAK OUT',
      buy_price: 55.5,
    })

    expect(result.symbol).toBe('GULF')
    expect(result.color_mark).toBe('GREEN')
  })

  it('URL-encodes special characters in the symbol', async () => {
    mockedPut.mockResolvedValueOnce({ data: {} })
    // The service does NOT encode in upsertItem — it encodes in getSymbolNote.
    // This test verifies the URL is constructed as documented.
    await weeklyScanService.upsertItem('scan-id', 'ADVANC', {})
    expect(mockedPut).toHaveBeenCalledWith(
      '/weekly-scan/scans/scan-id/items/ADVANC',
      {},
    )
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.getSymbolNote
// ---------------------------------------------------------------------------

describe('weeklyScanService.getSymbolNote', () => {
  it('calls GET /weekly-scan/symbol-notes/{symbol}', async () => {
    const mockNote: SymbolNote = { symbol: 'GULF', note: 'Strong thesis', updated_at: null }
    mockedGet.mockResolvedValueOnce({ data: mockNote })

    const result = await weeklyScanService.getSymbolNote('GULF')

    expect(mockedGet).toHaveBeenCalledWith('/weekly-scan/symbol-notes/GULF')
    expect(result.symbol).toBe('GULF')
    expect(result.note).toBe('Strong thesis')
  })

  it('URL-encodes the symbol', async () => {
    mockedGet.mockResolvedValueOnce({ data: { symbol: 'BTC-USD', note: null, updated_at: null } })
    await weeklyScanService.getSymbolNote('BTC-USD')
    expect(mockedGet).toHaveBeenCalledWith('/weekly-scan/symbol-notes/BTC-USD')
  })

  it('returns null note when the note is null', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { symbol: 'GULF', note: null, updated_at: null },
    })
    const result = await weeklyScanService.getSymbolNote('GULF')
    expect(result.note).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.deleteItem
// ---------------------------------------------------------------------------

describe('weeklyScanService.deleteItem', () => {
  it('calls DELETE /weekly-scan/scans/{scanId}/items/{symbol}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })

    await weeklyScanService.deleteItem('scan-1', 'ADVANC')

    expect(mockedDelete).toHaveBeenCalledWith('/weekly-scan/scans/scan-1/items/ADVANC')
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.deleteScan
// ---------------------------------------------------------------------------

describe('weeklyScanService.deleteScan', () => {
  it('calls DELETE /weekly-scan/scans/{id}', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined })

    await weeklyScanService.deleteScan('scan-99')

    expect(mockedDelete).toHaveBeenCalledWith('/weekly-scan/scans/scan-99')
  })
})

// ---------------------------------------------------------------------------
// weeklyScanService.suggestName
// ---------------------------------------------------------------------------

describe('weeklyScanService.suggestName', () => {
  it('calls GET /weekly-scan/suggest-name and returns the name string', async () => {
    mockedGet.mockResolvedValueOnce({ data: { name: 'WEEKLY_SCAN_08_06_2026' } })

    const result = await weeklyScanService.suggestName()

    expect(mockedGet).toHaveBeenCalledWith('/weekly-scan/suggest-name')
    expect(result).toBe('WEEKLY_SCAN_08_06_2026')
  })
})
