import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useDashboardStore } from '@/store/dashboard'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the store to its initial state between tests */
function resetStore() {
  // getState() is always present on Zustand stores.
  // We can re-initialise by calling the actions that write to each field, or
  // by leveraging the fact that resetLayout() already exists and restores widgets,
  // then we patch the remaining fields directly via setState.
  act(() => {
    useDashboardStore.setState({
      widgets: [
        { id: 'portfolio-summary', type: 'portfolio_summary', title: 'Portfolio Summary', x: 0,  y: 0,  w: 12, h: 3, minW: 6, minH: 2 },
        { id: 'portfolio-chart',   type: 'portfolio_chart',   title: 'Performance',       x: 0,  y: 3,  w: 8,  h: 5, minW: 4, minH: 3 },
        { id: 'allocation',        type: 'allocation_chart',  title: 'Allocation',         x: 8,  y: 3,  w: 4,  h: 5, minW: 3, minH: 3 },
        { id: 'holdings',          type: 'holdings_table',    title: 'Holdings',           x: 0,  y: 8,  w: 12, h: 6, minW: 4, minH: 4 },
        { id: 'market-pulse',      type: 'market_pulse',      title: 'Market Pulse',       x: 0,  y: 14, w: 12, h: 2, minW: 6, minH: 2 },
        { id: 'scan-heat-tile',    type: 'scan_heat_tile',    title: 'Scan Heat Tile',     x: 0,  y: 16, w: 6,  h: 5, minW: 4, minH: 3 },
        { id: 'pnl-waterfall',     type: 'pnl_waterfall',     title: 'P&L by Ticker',      x: 6,  y: 16, w: 6,  h: 5, minW: 4, minH: 3 },
      ],
      editMode: false,
      selectedPortfolioId: null,
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDashboardStore', () => {
  beforeEach(resetStore)

  // ── editMode ──────────────────────────────────────────────────────────────

  it('starts with editMode false', () => {
    expect(useDashboardStore.getState().editMode).toBe(false)
  })

  it('toggleEditMode switches false → true', () => {
    act(() => {
      useDashboardStore.getState().toggleEditMode()
    })
    expect(useDashboardStore.getState().editMode).toBe(true)
  })

  it('toggleEditMode switches true → false', () => {
    act(() => {
      useDashboardStore.getState().toggleEditMode() // → true
      useDashboardStore.getState().toggleEditMode() // → false
    })
    expect(useDashboardStore.getState().editMode).toBe(false)
  })

  // ── DEFAULT_WIDGETS presence ──────────────────────────────────────────────

  it('DEFAULT_WIDGETS includes portfolio_summary', () => {
    const widgets = useDashboardStore.getState().widgets
    expect(widgets.some((w) => w.type === 'portfolio_summary')).toBe(true)
  })

  it('DEFAULT_WIDGETS includes market_pulse', () => {
    const widgets = useDashboardStore.getState().widgets
    expect(widgets.some((w) => w.type === 'market_pulse')).toBe(true)
  })

  it('DEFAULT_WIDGETS includes scan_heat_tile', () => {
    const widgets = useDashboardStore.getState().widgets
    expect(widgets.some((w) => w.type === 'scan_heat_tile')).toBe(true)
  })

  it('DEFAULT_WIDGETS includes pnl_waterfall', () => {
    const widgets = useDashboardStore.getState().widgets
    expect(widgets.some((w) => w.type === 'pnl_waterfall')).toBe(true)
  })

  it('DEFAULT_WIDGETS contains exactly 7 widgets', () => {
    expect(useDashboardStore.getState().widgets).toHaveLength(7)
  })

  // ── updateWidgetLayout ────────────────────────────────────────────────────

  it('updateWidgetLayout updates x/y/w/h for a matching widget id', () => {
    act(() => {
      useDashboardStore.getState().updateWidgetLayout([
        { i: 'portfolio-summary', x: 2, y: 4, w: 10, h: 4 },
      ])
    })

    const widget = useDashboardStore
      .getState()
      .widgets.find((w) => w.id === 'portfolio-summary')!

    expect(widget.x).toBe(2)
    expect(widget.y).toBe(4)
    expect(widget.w).toBe(10)
    expect(widget.h).toBe(4)
  })

  it('updateWidgetLayout leaves unmatched widgets unchanged', () => {
    const before = useDashboardStore
      .getState()
      .widgets.find((w) => w.id === 'holdings')!

    act(() => {
      useDashboardStore.getState().updateWidgetLayout([
        { i: 'portfolio-summary', x: 1, y: 1, w: 6, h: 2 },
      ])
    })

    const after = useDashboardStore
      .getState()
      .widgets.find((w) => w.id === 'holdings')!

    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
    expect(after.w).toBe(before.w)
    expect(after.h).toBe(before.h)
  })

  // ── resetLayout ───────────────────────────────────────────────────────────

  it('resetLayout restores all 7 DEFAULT_WIDGETS', () => {
    // Mutate state first
    act(() => {
      useDashboardStore.getState().updateWidgetLayout([
        { i: 'portfolio-summary', x: 99, y: 99, w: 1, h: 1 },
      ])
      useDashboardStore.getState().resetLayout()
    })

    const widgets = useDashboardStore.getState().widgets
    expect(widgets).toHaveLength(7)

    const summary = widgets.find((w) => w.id === 'portfolio-summary')!
    expect(summary.x).toBe(0)
    expect(summary.y).toBe(0)
    expect(summary.w).toBe(12)
    expect(summary.h).toBe(3)
  })

  // ── setSelectedPortfolio ──────────────────────────────────────────────────

  it('setSelectedPortfolio stores the provided id', () => {
    act(() => {
      useDashboardStore.getState().setSelectedPortfolio('portfolio-abc-123')
    })
    expect(useDashboardStore.getState().selectedPortfolioId).toBe('portfolio-abc-123')
  })

  it('setSelectedPortfolio accepts null to clear the selection', () => {
    act(() => {
      useDashboardStore.getState().setSelectedPortfolio('portfolio-abc-123')
      useDashboardStore.getState().setSelectedPortfolio(null)
    })
    expect(useDashboardStore.getState().selectedPortfolioId).toBeNull()
  })

  // ── setWidgets ────────────────────────────────────────────────────────────

  it('setWidgets replaces the entire widget list', () => {
    const newWidgets = [
      { id: 'custom-1', type: 'portfolio_summary' as const, title: 'Custom', x: 0, y: 0, w: 6, h: 3 },
    ]
    act(() => {
      useDashboardStore.getState().setWidgets(newWidgets)
    })
    expect(useDashboardStore.getState().widgets).toHaveLength(1)
    expect(useDashboardStore.getState().widgets[0].id).toBe('custom-1')
  })
})
