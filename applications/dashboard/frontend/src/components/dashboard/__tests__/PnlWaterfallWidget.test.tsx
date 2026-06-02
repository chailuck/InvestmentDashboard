import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { PnlWaterfallWidget } from '@/components/dashboard/PnlWaterfallWidget'
import type { WidgetConfig } from '@/types'

// ---------------------------------------------------------------------------
// Mock the portfolio tracker service
// ---------------------------------------------------------------------------

vi.mock('@/services/portfolioTracker', () => ({
  portfolioTrackerService: {
    getPerformanceByStock: vi.fn().mockResolvedValue([
      {
        symbol: 'ADVANC',
        net: 15000,
        investment: 200000,
        currentValue: 215000,
        pnlPct: 7.5,
        wins: 3,
        losses: 1,
        total: 4,
        winRate: 75,
      },
      {
        symbol: 'GULF',
        net: -3000,
        investment: 50000,
        currentValue: 47000,
        pnlPct: -6.0,
        wins: 1,
        losses: 2,
        total: 3,
        winRate: 33.33,
      },
      {
        symbol: 'PTT',
        net: 8000,
        investment: 100000,
        currentValue: 108000,
        pnlPct: 8.0,
        wins: 4,
        losses: 0,
        total: 4,
        winRate: 100,
      },
    ]),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: WidgetConfig = {
  id: 'pnl-waterfall',
  type: 'pnl_waterfall',
  title: 'P&L by Ticker',
  x: 6,
  y: 16,
  w: 6,
  h: 5,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PnlWaterfallWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an ECharts chart element after data loads', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByTestId('echarts')).toBeInTheDocument()
    })
  })

  it('renders time range toggle buttons: All, 3M, 1M', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    // Buttons render synchronously (not gated on data)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3M' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument()
  })

  it('"All" button is active by default', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    const allBtn = screen.getByRole('button', { name: 'All' })
    // Active button carries brand styling class
    expect(allBtn.className).toContain('text-brand-400')
  })

  it('changes active range button to "3M" when clicked', async () => {
    const user = userEvent.setup()
    render(<PnlWaterfallWidget config={mockConfig} />)

    const btn3M = screen.getByRole('button', { name: '3M' })
    await user.click(btn3M)

    expect(btn3M.className).toContain('text-brand-400')
    // "All" should no longer have the active class
    const allBtn = screen.getByRole('button', { name: 'All' })
    expect(allBtn.className).not.toContain('text-brand-400')
  })

  it('changes active range button to "1M" when clicked', async () => {
    const user = userEvent.setup()
    render(<PnlWaterfallWidget config={mockConfig} />)

    await user.click(screen.getByRole('button', { name: '1M' }))
    expect(screen.getByRole('button', { name: '1M' }).className).toContain('text-brand-400')
  })

  it('chart yAxis data is sorted descending by net P&L (ADVANC first)', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    await waitFor(() => {
      const chartEl = screen.getByTestId('echarts')
      const option = JSON.parse(chartEl.getAttribute('data-option') ?? '{}')

      // yAxis.data should be [ADVANC(15000), PTT(8000), GULF(-3000)] — desc by net
      const yData: string[] = option.yAxis?.data ?? []
      expect(yData[0]).toBe('ADVANC')
      expect(yData[1]).toBe('PTT')
      expect(yData[2]).toBe('GULF')
    })
  })

  it('chart series bar values include positive and negative entries', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    await waitFor(() => {
      const chartEl = screen.getByTestId('echarts')
      const option = JSON.parse(chartEl.getAttribute('data-option') ?? '{}')
      const seriesData: Array<{ value: number }> = option.series?.[0]?.data ?? []

      const values = seriesData.map((d) => d.value)
      expect(values.some((v) => v > 0)).toBe(true)   // ADVANC / PTT
      expect(values.some((v) => v < 0)).toBe(true)   // GULF
    })
  })
})

// ---------------------------------------------------------------------------
// Edge case: empty data
// ---------------------------------------------------------------------------

describe('PnlWaterfallWidget — no data', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getPerformanceByStock,
    ).mockResolvedValue([])
  })

  it('shows empty-state message when no P&L data', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText(/No P&L data for this period/i)).toBeInTheDocument()
    })
  })

  it('does not render an ECharts element when data is empty', async () => {
    render(<PnlWaterfallWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.queryByTestId('echarts')).not.toBeInTheDocument()
    })
  })
})
