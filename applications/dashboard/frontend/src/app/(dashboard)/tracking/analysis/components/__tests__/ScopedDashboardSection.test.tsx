import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { buildScopedGrid } from '@/lib/tracking-analysis'
import { ScopedDashboardSection } from '../ScopedDashboardSection'
import { makeGrid, makeViewState } from '../../__tests__/fixtures'
import type { ViewState } from '../../types'

function renderAt(vsPatch: Partial<ViewState>) {
  const viewState = makeViewState(vsPatch)
  const scoped = buildScopedGrid(makeGrid(), viewState)
  const onChange = vi.fn()
  const onDrillItem = vi.fn()
  render(
    <ScopedDashboardSection scoped={scoped} viewState={viewState} subCaption="cap" onChange={onChange} onDrillItem={onDrillItem} />,
  )
  return { onChange, onDrillItem }
}

describe('ScopedDashboardSection — per drill depth', () => {
  it('depth 0 collapsed by default — the toggle button reports collapsed and calls back', async () => {
    const { onChange } = renderAt({ drill: { lens: 'grandTotal' } })
    const header = screen.getByRole('button', { name: /scoped dashboard/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Drill into a category/i)).not.toBeInTheDocument()
    await userEvent.click(header)
    expect(onChange).toHaveBeenCalledWith({ scopedDashboardCollapsed: false })
  })

  it('depth 0 expanded — hint + 3-row lens strip', () => {
    renderAt({ drill: { lens: 'grandTotal' }, scopedDashboardCollapsed: false })
    expect(screen.getByText(/Drill into a category, sub-category, or item/i)).toBeInTheDocument()
    expect(screen.getByText('Grand Total')).toBeInTheDocument()
    expect(screen.getByText('Property')).toBeInTheDocument()
    expect(screen.getByText('Non-Property')).toBeInTheDocument()
  })

  it('depth 1 — scope total, sub-category subtotals and split rows (one grid per year)', () => {
    renderAt({ drill: { lens: 'grandTotal', categoryId: 'c1' } })
    // fixture spans 2 years → one grid (hence one row set) per year
    expect(screen.getAllByText('Total: Assets')).toHaveLength(2)
    expect(screen.getAllByText('Property portion')).toHaveLength(2)
    expect(screen.getAllByText('Non-Property portion')).toHaveLength(2)
    expect(screen.getAllByText('Bank').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Realty').length).toBeGreaterThan(0)
  })

  it('depth 1 — Property lens with no Property items surfaces the recovery action', async () => {
    const { onChange } = renderAt({ lens: 'property', drill: { lens: 'property', categoryId: 'c2' } })
    expect(screen.getByText(/No Property items in this scope/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /switch to grand total/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lens: 'grandTotal' }))
  })

  it('depth 2 — scope total + flat item rows', () => {
    renderAt({ drill: { lens: 'grandTotal', categoryId: 'c1', subCategoryId: 's1' } })
    expect(screen.getAllByText('Total: Bank')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Checking' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Savings' }).length).toBeGreaterThan(0)
  })

  it('depth 3 — single item balance row + scope-facts strip + note', () => {
    renderAt({ drill: { lens: 'grandTotal', categoryId: 'c1', subCategoryId: 's1', itemId: 'i1' } })
    expect(screen.getByText(/single item; its balance is shown directly/i)).toBeInTheDocument()
    expect(screen.getByText('Populated periods')).toBeInTheDocument()
    expect(screen.getByText('Peak')).toBeInTheDocument()
  })

  it('depth 3 — exclusive leaf shows the excluded banner and still renders facts', () => {
    renderAt({ drill: { lens: 'grandTotal', categoryId: 'c2', subCategoryId: 's3', itemId: 'i5' } })
    expect(screen.getByText(/This item is exclusive/i)).toBeInTheDocument()
    expect(screen.getByText('Net change')).toBeInTheDocument()
  })

  it('an item row click drills the whole view to that item (SD-OQ-6)', async () => {
    const { onDrillItem } = renderAt({ drill: { lens: 'grandTotal', categoryId: 'c1', subCategoryId: 's1' } })
    await userEvent.click(screen.getAllByRole('button', { name: 'Checking' })[0])
    expect(onDrillItem).toHaveBeenCalledWith('i1')
  })
})
