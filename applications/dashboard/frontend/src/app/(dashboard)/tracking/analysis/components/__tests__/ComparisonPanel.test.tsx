import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { ComparisonPanel, type ComparisonPanelModel } from '../ComparisonPanel'

const OK: ComparisonPanelModel = {
  ok: true,
  note: null,
  headerLabel: 'QOQ · by category · Q1 2025 → Q2 2025',
  periodALabel: 'Q1 2025',
  periodBLabel: 'Q2 2025',
  rows: [
    { name: 'Assets', valueA: 100, valueB: 130, delta: 30, deltaPercent: 30 },
    { name: 'Misc', valueA: 40, valueB: 20, delta: -20, deltaPercent: -50 },
  ],
  total: { name: 'Grand Total total', valueA: 140, valueB: 150, delta: 10, deltaPercent: 7.14 },
}

describe('ComparisonPanel', () => {
  it('renders paired values, per-bucket deltas and a bold lens-total row', () => {
    render(<ComparisonPanel model={OK} />)
    expect(screen.getByText(/QOQ · by category/)).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Assets')).toBeInTheDocument()
    const totalRow = within(table).getByText('Grand Total total').closest('tr') as HTMLElement
    expect(totalRow).toHaveTextContent('+฿10.00')
    expect(totalRow.className).toContain('font-semibold')
  })

  it('shows the resolution note instead of a table when not resolvable', () => {
    render(
      <ComparisonPanel
        model={{ ...OK, ok: false, note: 'Insufficient data for a year-over-year comparison.', rows: [], total: { name: '', valueA: null, valueB: null, delta: null, deltaPercent: null } }}
      />,
    )
    expect(screen.getByText(/insufficient data/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
