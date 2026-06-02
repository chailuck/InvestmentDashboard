import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { AllocationChartWidget } from '@/components/dashboard/AllocationChartWidget'
import type { WidgetConfig } from '@/types'

// ---------------------------------------------------------------------------
// Mock the portfolio tracker service
// ---------------------------------------------------------------------------

const mockPositions = [
  {
    id: 1,
    symbol: 'ADVANC',
    direction: 'long',
    entryDate: '2026-01-01',
    exitDate: null,
    entryPrice: 200,
    currentPrice: 250,
    exitPrice: null,
    positionSize: 100,   // value = 250 * 100 = 25,000
    netPnl: 5000,
    pnlPct: 25,
    sl: null,
    tp: null,
    status: 'active' as const,
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
    positionSize: 200,   // value = 45 * 200 = 9,000
    netPnl: -1000,
    pnlPct: -10,
    sl: null,
    tp: null,
    status: 'active' as const,
  },
]

vi.mock('@/services/portfolioTracker', () => ({
  portfolioTrackerService: {
    getPositions: vi.fn().mockResolvedValue({
      positions: mockPositions,
      total: 2,
      totalNetPnl: 4000,
    }),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: WidgetConfig = {
  id: 'allocation',
  type: 'allocation_chart',
  title: 'Allocation',
  x: 8,
  y: 3,
  w: 4,
  h: 5,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AllocationChartWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an ECharts donut chart when positions exist', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByTestId('echarts')).toBeInTheDocument()
    })
  })

  it('shows the "Total Position Value" label', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('Total Position Value')).toBeInTheDocument()
    })
  })

  it('shows the formatted total value (25,000 + 9,000 = 34,000)', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      // 34,000 formatted with th-TH locale: "34,000 ฿"
      const valueEl = screen.getByText(/34,000/)
      expect(valueEl).toBeInTheDocument()
    })
  })

  it('chart series data includes ADVANC and GULF', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      const chartEl = screen.getByTestId('echarts')
      const option = JSON.parse(chartEl.getAttribute('data-option') ?? '{}')
      const seriesData: Array<{ name: string }> = option.series?.[0]?.data ?? []
      const names = seriesData.map((d) => d.name)

      expect(names).toContain('ADVANC')
      expect(names).toContain('GULF')
    })
  })

  it('ADVANC has larger allocation share than GULF', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      const chartEl = screen.getByTestId('echarts')
      const option = JSON.parse(chartEl.getAttribute('data-option') ?? '{}')
      const seriesData: Array<{ name: string; value: number }> = option.series?.[0]?.data ?? []

      const advanc = seriesData.find((d) => d.name === 'ADVANC')
      const gulf = seriesData.find((d) => d.name === 'GULF')

      expect(advanc).toBeDefined()
      expect(gulf).toBeDefined()
      // ADVANC value = 25,000 / 34,000 ≈ 73.53%; GULF ≈ 26.47%
      expect(advanc!.value).toBeGreaterThan(gulf!.value)
    })
  })

  it('chart is a pie type', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      const option = JSON.parse(
        screen.getByTestId('echarts').getAttribute('data-option') ?? '{}',
      )
      expect(option.series?.[0]?.type).toBe('pie')
    })
  })
})

// ---------------------------------------------------------------------------
// Edge case: no positions
// ---------------------------------------------------------------------------

describe('AllocationChartWidget — empty state', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getPositions,
    ).mockResolvedValue({ positions: [], total: 0, totalNetPnl: 0 })
  })

  it('shows "No open positions" empty-state message', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('No open positions')).toBeInTheDocument()
    })
  })

  it('does not render an ECharts element when positions list is empty', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.queryByTestId('echarts')).not.toBeInTheDocument()
    })
  })

  it('shows helper text about the chart appearing with active positions', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(
        screen.getByText(/Allocation chart appears when you have active positions/i),
      ).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Edge case: positions with zero current price (prevent division by zero)
// ---------------------------------------------------------------------------

describe('AllocationChartWidget — zero-value positions', () => {
  beforeEach(() => {
    vi.mocked(
      (await import('@/services/portfolioTracker')).portfolioTrackerService.getPositions,
    ).mockResolvedValue({
      positions: [
        {
          id: 1,
          symbol: 'ZERO',
          direction: 'long',
          entryDate: null,
          exitDate: null,
          entryPrice: 0,
          currentPrice: 0,
          exitPrice: null,
          positionSize: 100,
          netPnl: 0,
          pnlPct: 0,
          sl: null,
          tp: null,
          status: 'active',
        },
      ],
      total: 1,
      totalNetPnl: 0,
    })
  })

  it('shows empty state when all positions have zero value', async () => {
    render(<AllocationChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('No open positions')).toBeInTheDocument()
    })
  })
})
