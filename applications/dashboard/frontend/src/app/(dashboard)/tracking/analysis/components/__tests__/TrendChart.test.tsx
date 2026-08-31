import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { deriveChartModel } from '@/lib/tracking-analysis'
import { TrendChart } from '../TrendChart'
import { makeGrid, makeViewState } from '../../__tests__/fixtures'

function model() {
  return deriveChartModel(makeGrid(), makeViewState())
}

describe('TrendChart', () => {
  it('renders an accessible chart with a legend for every bucket plus the total overlay', () => {
    const m = model()
    render(<TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={vi.fn()} />)
    expect(screen.getByRole('img', { name: /trend of balance over/i })).toBeInTheDocument()
    const legend = screen.getByRole('group', { name: /trend legend/i })
    expect(within(legend).getByText('Assets')).toBeInTheDocument()
    expect(within(legend).getByText('Misc')).toBeInTheDocument()
    expect(within(legend).getByText('Lens total')).toBeInTheDocument()
  })

  it('offers a table view with a value for every period (no value is hover-gated)', async () => {
    const m = model()
    render(<TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Period')).toBeInTheDocument()
    // 2023 Q4 row present (first populated period of the trimmed window)
    expect(within(table).getByText('Q4 2023')).toBeInTheDocument()
  })

  it('legend click toggles a series visibility', async () => {
    const m = model()
    render(<TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={vi.fn()} />)
    const legend = screen.getByRole('group', { name: /trend legend/i })
    const assetsBtn = within(legend).getByRole('button', { name: 'Assets' })
    expect(assetsBtn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(assetsBtn)
    expect(assetsBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('drill affordance calls onDrill with the bucket id', async () => {
    const m = model()
    const onDrill = vi.fn()
    render(<TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={onDrill} />)
    const drillRow = screen.getByText('Drill into:').parentElement as HTMLElement
    await userEvent.click(within(drillRow).getByRole('button', { name: 'Assets' }))
    expect(onDrill).toHaveBeenCalledWith('c1')
  })

  it('arrow keys move a period cursor and announce it via aria-live', async () => {
    const m = model()
    const { container } = render(
      <TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={vi.fn()} />,
    )
    const svg = screen.getByRole('img', { name: /trend of balance/i })
    svg.focus()
    await userEvent.keyboard('{ArrowRight}')
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toMatch(/Q[1-4] 20\d\d:/)
  })
})
