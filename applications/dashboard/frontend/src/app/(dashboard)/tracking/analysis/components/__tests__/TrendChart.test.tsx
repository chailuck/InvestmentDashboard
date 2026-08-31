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

  it('balance tooltip renders the period-over-period delta on its own line (not concatenated onto the value)', async () => {
    const m = model()
    render(<TrendChart axis={m.axis} series={m.buckets} aggregate={m.aggregate} measure="balance" onDrill={vi.fn()} />)
    const svg = screen.getByRole('img', { name: /trend of balance/i })
    svg.focus()
    // Walk the cursor to the last (fully populated) period so the aggregate row
    // has a real prior-period delta; this renders <ChartTooltip>.
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')

    // Each tooltip row is a translated <g>; within a row the right-anchored
    // <text> nodes are the main value line and the new "sub" delta line.
    const rowGroups = Array.from(svg.querySelectorAll('g[transform]')).filter(
      g => g.querySelectorAll('text[text-anchor="end"]').length > 0,
    )
    expect(rowGroups.length).toBeGreaterThan(0)

    const endTexts = Array.from(rowGroups[0].querySelectorAll('text[text-anchor="end"]'))
    // Two DISTINCT elements: the balance value and its own delta sub-line.
    expect(endTexts).toHaveLength(2)
    const [valueText, subText] = endTexts
    expect(valueText).not.toBe(subText)

    // Main line is a bare fmtBalance string — no whitespace, no "(" percent,
    // no "%"; a regression that re-concatenates value + delta would break this.
    const value = valueText.textContent ?? ''
    expect(value).toMatch(/฿[\d,]/)
    expect(value).not.toMatch(/\s/)
    expect(value).not.toContain('(')
    expect(value).not.toContain('%')

    // Sub line carries the period-over-period delta by itself.
    const sub = subText.textContent ?? ''
    expect(sub).toMatch(/([+-]฿[\d,]|No prior data)/)
    expect(sub === 'No prior data' || sub.includes('%') || sub.includes('฿0')).toBe(true)

    // Distinct effective y: main at the row baseline, sub ~12px below it.
    const translateY = (el: Element) => {
      const t = el.parentElement?.getAttribute('transform') ?? ''
      const mm = /translate\([^,]+,\s*(-?[\d.]+)\s*\)/.exec(t)
      return mm ? parseFloat(mm[1]) : 0
    }
    const effY = (el: Element) => translateY(el) + parseFloat(el.getAttribute('y') ?? '0')
    expect(effY(subText)).toBeGreaterThan(effY(valueText))
    expect(effY(subText) - effY(valueText)).toBeGreaterThanOrEqual(10)
  })
})
