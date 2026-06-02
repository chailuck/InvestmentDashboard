import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { MarketPulseWidget } from '@/components/dashboard/MarketPulseWidget'
import type { WidgetConfig } from '@/types'

// ---------------------------------------------------------------------------
// Mock the portfolio tracker service
// ---------------------------------------------------------------------------

vi.mock('@/services/portfolioTracker', () => ({
  portfolioTrackerService: {
    getSetIndices: vi.fn().mockResolvedValue([
      { name: 'SET50',  value: 1234.5,  change: 10.2,  changePct: 0.83  },
      { name: 'SET100', value: 2100.0,  change: -5.0,  changePct: -0.24 },
      { name: 'MAI',    value: 450.75,  change: 1.25,  changePct: 0.28  },
    ]),
    getGlobalIndices: vi.fn().mockResolvedValue([
      { name: 'S&P 500', value: 5300, change: 20,   changePct: 0.38  },
      { name: 'NASDAQ',  value: 18900, change: -50,  changePct: -0.26 },
    ]),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: WidgetConfig = {
  id: 'market-pulse',
  type: 'market_pulse',
  title: 'Market Pulse',
  x: 0,
  y: 14,
  w: 12,
  h: 2,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarketPulseWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all SET index names', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('SET50')).toBeInTheDocument()
    })
    expect(screen.getByText('SET100')).toBeInTheDocument()
    expect(screen.getByText('MAI')).toBeInTheDocument()
  })

  it('renders global index names', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('S&P 500')).toBeInTheDocument()
    })
    expect(screen.getByText('NASDAQ')).toBeInTheDocument()
  })

  it('renders positive change in gain styling', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      // SET50 has +0.83% — the pill should carry bg-gain/15 text-gain classes
      const pctEl = screen.getByText('+0.83%')
      expect(pctEl.className).toContain('text-gain')
    })
  })

  it('renders negative change in loss styling', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      // SET100 has -0.24%
      const pctEl = screen.getByText('-0.24%')
      expect(pctEl.className).toContain('text-loss')
    })
  })

  it('renders formatted index values with 2 decimal places', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      // SET50 value = 1234.5 → formatted as 1,234.50
      expect(screen.getByText('1,234.50')).toBeInTheDocument()
    })
  })

  it('renders the section header "Market Indices"', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      expect(
        screen.getByText((content) => content.toLowerCase().includes('market indices')),
      ).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('MarketPulseWidget — null changePct', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getSetIndices,
    ).mockResolvedValue([
      { name: 'SET', value: null, change: null, changePct: null },
    ])
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getGlobalIndices,
    ).mockResolvedValue([])
  })

  it('displays "—" when changePct is null', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      // Both value and pct are null → both show "—"
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('MarketPulseWidget — empty data', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getSetIndices,
    ).mockResolvedValue([])
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getGlobalIndices,
    ).mockResolvedValue([])
  })

  it('shows "No SET data" message when setIndices is empty', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('No SET data')).toBeInTheDocument()
    })
  })

  it('shows "No global data" message when globalIndices is empty', async () => {
    render(<MarketPulseWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('No global data')).toBeInTheDocument()
    })
  })
})
