import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { PortfolioSummaryWidget } from '@/components/dashboard/PortfolioSummaryWidget'
import type { WidgetConfig } from '@/types'

// ---------------------------------------------------------------------------
// Mock the portfolio tracker service
// ---------------------------------------------------------------------------

vi.mock('@/services/portfolioTracker', () => ({
  portfolioTrackerService: {
    getPositions: vi.fn().mockResolvedValue({
      positions: [
        {
          id: 1,
          symbol: 'ADVANC',
          direction: 'long',
          entryDate: '2026-01-01',
          exitDate: null,
          entryPrice: 200,
          currentPrice: 250,
          exitPrice: null,
          positionSize: 100,
          netPnl: 5000,
          pnlPct: 25,
          sl: null,
          tp: null,
          status: 'active',
        },
        {
          id: 2,
          symbol: 'GULF',
          direction: 'long',
          entryDate: '2026-02-01',
          exitDate: null,
          entryPrice: 50,
          currentPrice: 45,
          exitPrice: null,
          positionSize: 200,
          netPnl: -1000,
          pnlPct: -10,
          sl: null,
          tp: null,
          status: 'active',
        },
      ],
      total: 2,
      totalNetPnl: 4000,
    }),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: WidgetConfig = {
  id: 'portfolio-summary',
  type: 'portfolio_summary',
  title: 'Portfolio Summary',
  x: 0,
  y: 0,
  w: 12,
  h: 3,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PortfolioSummaryWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading skeletons initially before data resolves', () => {
    // Don't await — capture the initial render synchronously
    render(<PortfolioSummaryWidget config={mockConfig} />)
    // The skeleton divs are rendered while isLoading=true
    const skeletons = document.querySelectorAll('.skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders 4 metric cards after data loads', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      // Each metric card has a label; look for the known labels
      expect(screen.getByText('Open P&L')).toBeInTheDocument()
    })

    expect(screen.getByText('Open Positions')).toBeInTheDocument()
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.getByText('Avg P&L / Trade')).toBeInTheDocument()
  })

  it('shows correct win/loss breakdown (1W / 1L)', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('1W / 1L')).toBeInTheDocument()
    })
  })

  it('shows the correct total position count (2)', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      // "2" is rendered as the Open Positions value
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('shows win rate of 50%', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('50%')).toBeInTheDocument()
    })
  })

  it('shows 2 trades in the win rate sub-label', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('2 trades')).toBeInTheDocument()
    })
  })

  it('shows positive total P&L formatted with K suffix', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      // totalNetPnl = 4000 → +4.0K ฿
      expect(screen.getByText('+4.0K ฿')).toBeInTheDocument()
    })
  })

  it('renders P&L value inside an element with gain color class', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      const pnlEl = screen.getByText('+4.0K ฿')
      expect(pnlEl.className).toContain('text-gain')
    })
  })

  it('shows a return percentage sub-label', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      // totalCost = 200*100 + 50*200 = 30000; return = 4000/30000*100 = 13.33%
      const returnLabel = screen.getByText(/\d+\.\d+% return/)
      expect(returnLabel).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Edge case: zero positions
// ---------------------------------------------------------------------------

describe('PortfolioSummaryWidget — empty state', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getPositions,
    ).mockResolvedValue({ positions: [], total: 0, totalNetPnl: 0 })
  })

  it('shows "no trades" when there are no positions', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('no trades')).toBeInTheDocument()
    })
  })

  it('shows "—" for avg P&L when there are no positions', async () => {
    render(<PortfolioSummaryWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })
})
