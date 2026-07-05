import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { PortfolioChartWidget } from '@/components/dashboard/PortfolioChartWidget'
import type { WidgetConfig } from '@/types'

// ---------------------------------------------------------------------------
// Mock the portfolio tracker service
// ---------------------------------------------------------------------------

const mockGetPerformance = vi.fn()

vi.mock('@/services/portfolioTracker', () => ({
  portfolioTrackerService: {
    getPerformance: (...args: unknown[]) => mockGetPerformance(...args),
  },
}))

// ---------------------------------------------------------------------------
// Local override of next/dynamic
// ---------------------------------------------------------------------------
// The global setup.ts mock for next/dynamic renders a generic placeholder
// (data-testid="dynamic-component") and never invokes the real importFn, so
// the shared echarts-for-react mock's data-testid="echarts" / data-option
// JSON never actually reaches the DOM for components that load ReactECharts
// via `dynamic(() => import('echarts-for-react'))` — which is exactly how
// PortfolioChartWidget (and its sibling widgets) load the chart. Overriding
// next/dynamic locally in this file lets assertions inspect real chart data
// (xAxis/series) instead of only the loading/empty-state text.
vi.mock('next/dynamic', () => ({
  default: () => {
    return ({ option, style }: { option: unknown; style?: React.CSSProperties }) =>
      React.createElement('div', {
        'data-testid': 'echarts',
        'data-option': JSON.stringify(option),
        style,
      })
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: WidgetConfig = {
  id: 'portfolio-chart',
  type: 'portfolio_chart',
  title: 'Performance',
  x: 0,
  y: 0,
  w: 6,
  h: 5,
}

const dailyData = [{ date: '2026-07-01', label: 'Jul 1', dailyPnl: 100, cumulativePnl: 100 }]
const weeklyData = [{ date: '2026-06-01', label: 'Wk 22', dailyPnl: 500, cumulativePnl: 500 }]
const monthlyData = [{ date: '2026-05-01', label: 'May', dailyPnl: 2000, cumulativePnl: 2000 }]

function dataForPeriod(period: string) {
  if (period === 'daily') return dailyData
  if (period === 'weekly') return weeklyData
  if (period === 'monthly') return monthlyData
  return []
}

function getChartOption() {
  const el = screen.getByTestId('echarts')
  return JSON.parse(el.getAttribute('data-option') ?? '{}')
}

const PERIOD_KEY = 'perf-widget-period'
const GRANULARITY_KEY = 'perf-widget-granularity'

describe('PortfolioChartWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGetPerformance.mockImplementation(({ period }: { period: string }) =>
      Promise.resolve(dataForPeriod(period)),
    )
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('renders all period and granularity buttons', () => {
    render(<PortfolioChartWidget config={mockConfig} />)

    for (const p of ['1W', '1M', '3M', '6M', '1Y', 'YTD']) {
      expect(screen.getByRole('button', { name: p })).toBeInTheDocument()
    }
    for (const g of ['D', 'W', 'M']) {
      expect(screen.getByRole('button', { name: g })).toBeInTheDocument()
    }
  })

  it('defaults to 3M range with derived weekly granularity and renders that data', async () => {
    render(<PortfolioChartWidget config={mockConfig} />)

    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'W' })).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => {
      expect(mockGetPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'weekly' }),
      )
    })
    await waitFor(() => {
      expect(getChartOption().xAxis.data).toEqual(['Wk 22'])
    })
  })

  it('changing the range resets granularity to the derived default and persists both keys', async () => {
    const user = userEvent.setup()
    render(<PortfolioChartWidget config={mockConfig} />)
    await waitFor(() => expect(mockGetPerformance).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: '1Y' }))

    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'W' })).toHaveAttribute('aria-pressed', 'false')

    expect(localStorage.getItem(PERIOD_KEY)).toBe('1Y')
    expect(localStorage.getItem(GRANULARITY_KEY)).toBe('monthly')

    await waitFor(() => {
      expect(getChartOption().xAxis.data).toEqual(['May'])
    })
  })

  it('changing granularity independently keeps the range/from_date unchanged', async () => {
    const user = userEvent.setup()
    render(<PortfolioChartWidget config={mockConfig} />)
    await waitFor(() => expect(mockGetPerformance).toHaveBeenCalled())

    // Establish a known range first (6M -> derived weekly)
    await user.click(screen.getByRole('button', { name: '6M' }))
    expect(localStorage.getItem(PERIOD_KEY)).toBe('6M')
    mockGetPerformance.mockClear()

    // Now change granularity only
    await user.click(screen.getByRole('button', { name: 'D' }))

    expect(screen.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'D' })).toHaveAttribute('aria-pressed', 'true')
    // Range/from_date localStorage key is untouched by the granularity-only change
    expect(localStorage.getItem(PERIOD_KEY)).toBe('6M')
    expect(localStorage.getItem(GRANULARITY_KEY)).toBe('daily')

    await waitFor(() => {
      expect(mockGetPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'daily' }),
      )
    })
    // from_date passed for the '6M' range must be identical across the granularity-only refetch
    const call = mockGetPerformance.mock.calls.at(-1)![0]
    expect(call.period).toBe('daily')
  })

  it('restores both period and granularity from localStorage on mount', async () => {
    localStorage.setItem(PERIOD_KEY, '1Y')
    localStorage.setItem(GRANULARITY_KEY, 'daily') // deliberately NOT the derived default for 1Y

    render(<PortfolioChartWidget config={mockConfig} />)

    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'D' })).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => {
      expect(mockGetPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'daily' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('falls back safely when localStorage period value is corrupted (no crash)', async () => {
    localStorage.setItem(PERIOD_KEY, 'not-a-real-period')
    localStorage.setItem(GRANULARITY_KEY, 'weekly')

    render(<PortfolioChartWidget config={mockConfig} />)

    // Falls back to the component default (3M) rather than the garbage value
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'W' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(mockGetPerformance).toHaveBeenCalled())
  })

  it('falls back safely when localStorage granularity value is corrupted (no crash)', async () => {
    localStorage.setItem(PERIOD_KEY, '1W')
    localStorage.setItem(GRANULARITY_KEY, 'yearly') // not a valid Granularity

    render(<PortfolioChartWidget config={mockConfig} />)

    expect(screen.getByRole('button', { name: '1W' })).toHaveAttribute('aria-pressed', 'true')
    // Falls back to the derived default for 1W, which is 'daily'
    expect(screen.getByRole('button', { name: 'D' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      expect(mockGetPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'daily' }),
      )
    })
  })

  it('shows the empty-state message for a sparse combo (1W range + Monthly granularity) without crashing', async () => {
    mockGetPerformance.mockResolvedValue([])
    const user = userEvent.setup()
    render(<PortfolioChartWidget config={mockConfig} />)
    await waitFor(() => expect(mockGetPerformance).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: '1W' }))
    await user.click(screen.getByRole('button', { name: 'M' }))

    await waitFor(() => {
      expect(screen.getByText('No realized P&L data for this period.')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('echarts')).not.toBeInTheDocument()
  })

  it('shows the empty-state message when the portfolio has zero performance data overall', async () => {
    mockGetPerformance.mockResolvedValue([])
    render(<PortfolioChartWidget config={mockConfig} />)

    await waitFor(() => {
      expect(screen.getByText('No realized P&L data for this period.')).toBeInTheDocument()
    })
  })

  it('shows the loading skeleton while the request is in flight', async () => {
    let resolveFn: (v: unknown) => void = () => {}
    mockGetPerformance.mockImplementation(
      () => new Promise((resolve) => { resolveFn = resolve }),
    )

    const { container } = render(<PortfolioChartWidget config={mockConfig} />)

    expect(container.querySelector('.skeleton')).toBeInTheDocument()
    expect(screen.queryByText('No realized P&L data for this period.')).not.toBeInTheDocument()

    resolveFn(weeklyData)
    await waitFor(() => expect(container.querySelector('.skeleton')).not.toBeInTheDocument())
  })

  // -------------------------------------------------------------------------
  // Boundary: rapid consecutive granularity clicks (query-key race)
  // -------------------------------------------------------------------------

  it('renders data for the last-selected granularity even if an earlier request resolves later (no stale-request race)', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    mockGetPerformance.mockImplementation(
      ({ period }: { period: string }) =>
        new Promise((resolve) => {
          pending[period] = resolve
        }),
    )

    const user = userEvent.setup()
    render(<PortfolioChartWidget config={mockConfig} />)
    // Initial mount fetch for the derived default (weekly)
    await waitFor(() => expect(pending.weekly).toBeDefined())

    // Rapidly click Daily then Monthly before either request resolves
    await user.click(screen.getByRole('button', { name: 'D' }))
    await user.click(screen.getByRole('button', { name: 'M' }))

    await waitFor(() => {
      expect(pending.daily).toBeDefined()
      expect(pending.monthly).toBeDefined()
    })

    // Resolve OUT OF ORDER relative to click order: monthly (the active/last-selected
    // one) arrives first, then the stale daily response arrives late.
    pending.monthly(monthlyData)
    await waitFor(() => {
      expect(getChartOption().xAxis.data).toEqual(['May'])
    })

    pending.daily(dailyData)
    // Give the late/stale response a chance to flush; it must NOT override the
    // currently active 'monthly' granularity's rendered data.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true')
    expect(getChartOption().xAxis.data).toEqual(['May'])

    // Clean up the still-pending initial 'weekly' request
    pending.weekly?.(weeklyData)
  })
})
