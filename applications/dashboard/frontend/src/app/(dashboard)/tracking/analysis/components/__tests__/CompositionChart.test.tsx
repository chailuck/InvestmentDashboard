import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { deriveChartModel } from '@/lib/tracking-analysis'
import { CompositionChart } from '../CompositionChart'
import { makeGrid, makeViewState } from '../../__tests__/fixtures'

function model() {
  return deriveChartModel(makeGrid(), makeViewState())
}

describe('CompositionChart', () => {
  it('renders a band per bucket with an accessible label', () => {
    const m = model()
    const { container } = render(
      <CompositionChart axis={m.axis} buckets={m.buckets} composition={m.composition} onDrill={vi.fn()} />,
    )
    expect(screen.getByRole('img', { name: /composition over time by 2 buckets/i })).toBeInTheDocument()
    expect(container.querySelector('[data-testid="composition-band-c1"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="composition-band-c2"]')).toBeInTheDocument()
  })

  it('toggles between 100% share and absolute', async () => {
    const m = model()
    render(<CompositionChart axis={m.axis} buckets={m.buckets} composition={m.composition} onDrill={vi.fn()} />)
    const abs = screen.getByRole('button', { name: 'Absolute' })
    await userEvent.click(abs)
    expect(abs).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers a table view of shares', async () => {
    const m = model()
    render(<CompositionChart axis={m.axis} buckets={m.buckets} composition={m.composition} onDrill={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Assets')).toBeInTheDocument()
    expect(within(table).getByText('Q4 2023')).toBeInTheDocument()
  })

  it('band click drills into that bucket', async () => {
    const m = model()
    const onDrill = vi.fn()
    const { container } = render(
      <CompositionChart axis={m.axis} buckets={m.buckets} composition={m.composition} onDrill={onDrill} />,
    )
    await userEvent.click(container.querySelector('[data-testid="composition-band-c1"]') as Element)
    expect(onDrill).toHaveBeenCalledWith('c1')
  })
})
