import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { deriveChartModel } from '@/lib/tracking-analysis'
import { DeltaTrendChart } from '../DeltaTrendChart'
import { makeGrid, makeViewState } from '../../__tests__/fixtures'
import type { AnalysisSeries } from '../../types'

function aggregate() {
  return deriveChartModel(makeGrid(), makeViewState()).aggregate
}

describe('DeltaTrendChart', () => {
  it('renders diverging bars with an accessible label and a table view', async () => {
    render(<DeltaTrendChart axis={deriveChartModel(makeGrid(), makeViewState()).axis} node={aggregate()} deltaMode="bars" onDeltaModeChange={vi.fn()} />)
    expect(screen.getByRole('img', { name: /period-over-period/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Δ Amount')).toBeInTheDocument()
    // first populated period shows "No prior data" in the Δ column
    expect(within(table).getByText('No prior data')).toBeInTheDocument()
  })

  it('shows a guidance message with fewer than two populated periods', () => {
    const one: AnalysisSeries = {
      id: 'x', label: 'x', color: '#fff', kind: 'aggregate', drillId: null,
      balance: [null, 100, null], deltaAmount: [null, null, null], deltaPercent: [null, null, null],
    }
    const axis = deriveChartModel(makeGrid(), makeViewState()).axis.slice(0, 3)
    render(<DeltaTrendChart axis={axis} node={one} deltaMode="bars" onDeltaModeChange={vi.fn()} />)
    expect(screen.getByText(/at least two populated periods/i)).toBeInTheDocument()
  })

  it('form + unit toggles work', async () => {
    const onDeltaModeChange = vi.fn()
    render(<DeltaTrendChart axis={deriveChartModel(makeGrid(), makeViewState()).axis} node={aggregate()} deltaMode="bars" onDeltaModeChange={onDeltaModeChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Waterfall' }))
    expect(onDeltaModeChange).toHaveBeenCalledWith('waterfall')
    const pct = screen.getByRole('button', { name: 'Δ %' })
    await userEvent.click(pct)
    expect(pct).toHaveAttribute('aria-pressed', 'true')
  })
})
