import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { PurchasePlanWidget } from '@/components/layouts/Sidebar'
import { actionPlanService } from '@/services/actionPlan'
import type { ActionPlan, PlanSummary, PurchaseItem } from '@/services/actionPlan'

// ---------------------------------------------------------------------------
// Mock the action plan service
// ---------------------------------------------------------------------------

vi.mock('@/services/actionPlan', () => ({
  actionPlanService: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    getStockPrice: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<PurchaseItem>): PurchaseItem {
  return {
    sort_order: 0,
    stock: 'TEST',
    current_price: null,
    size: null,
    buy_price: null,
    tp: null,
    sl: null,
    strategy: null,
    reason: null,
    triggered: false,
    ...overrides,
  }
}

/** Wires the mocked service so the widget's two chained queries resolve to a
 *  single plan containing exactly `item`. */
function mockPlanWithItem(item: PurchaseItem) {
  const summary: PlanSummary = {
    id: 'plan-1',
    name: 'Test Purchase Plan',
    plan_type: 'purchase',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    symbols: item.stock,
  }
  const plan: ActionPlan = {
    id: 'plan-1',
    name: 'Test Purchase Plan',
    plan_type: 'purchase',
    notes: null,
    set_analysis: null,
    ai_recommend: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    purchase_items: [item],
    portfolio_items: [],
  }
  vi.mocked(actionPlanService.list).mockResolvedValue([summary])
  vi.mocked(actionPlanService.get).mockResolvedValue(plan)
}

// ---------------------------------------------------------------------------
// Tests — Line 2 (SL <- [star -> current] -> TP) assumed-value fallback
// ---------------------------------------------------------------------------

describe('PurchasePlanWidget — Line 2 SL/TP assumed-value fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('both tp and sl null, buy_price set: Line 2 renders with both sides assumed at +/-15%', async () => {
    // buy_price 100 -> assumed SL = 85.0 (100 * 0.85), assumed TP = 115.0 (100 * 1.15)
    mockPlanWithItem(makeItem({ stock: 'ABC', buy_price: 100, current_price: 105 }))
    render(<PurchasePlanWidget />)

    const slEl = await screen.findByText('~85.0')
    const tpEl = await screen.findByText('~115.0')

    expect(slEl).toHaveAttribute('title', 'Assumed: 15% below entry (no SL set)')
    expect(tpEl).toHaveAttribute('title', 'Assumed: 15% above entry (no TP set)')
    expect(slEl.className).toContain('text-loss/60')
    expect(tpEl.className).toContain('text-gain/60')
  })

  it('tp set, sl null: TP shown as real/unmarked, SL shown as assumed', async () => {
    mockPlanWithItem(makeItem({ stock: 'DEF', buy_price: 100, current_price: 105, tp: 120 }))
    render(<PurchasePlanWidget />)

    const tpEl = await screen.findByText('120.0')
    const slEl = await screen.findByText('~85.0')

    expect(tpEl).not.toHaveAttribute('title')
    expect(tpEl.className).not.toContain('/60')
    expect(tpEl.className).toContain('text-gain')
    expect(slEl).toHaveAttribute('title', 'Assumed: 15% below entry (no SL set)')
    expect(slEl.className).toContain('text-loss/60')
  })

  it('tp null, sl set: SL shown as real/unmarked, TP shown as assumed', async () => {
    mockPlanWithItem(makeItem({ stock: 'GHI', buy_price: 100, current_price: 105, sl: 90 }))
    render(<PurchasePlanWidget />)

    const slEl = await screen.findByText('90.0')
    const tpEl = await screen.findByText('~115.0')

    expect(slEl).not.toHaveAttribute('title')
    expect(slEl.className).not.toContain('/60')
    expect(slEl.className).toContain('text-loss')
    expect(tpEl).toHaveAttribute('title', 'Assumed: 15% above entry (no TP set)')
    expect(tpEl.className).toContain('text-gain/60')
  })

  it('both tp and sl set: both real/unmarked — regression guard, output unchanged from prior behavior', async () => {
    mockPlanWithItem(makeItem({ stock: 'JKL', buy_price: 100, current_price: 105, sl: 90, tp: 120 }))
    render(<PurchasePlanWidget />)

    const slEl = await screen.findByText('90.0')
    const tpEl = await screen.findByText('120.0')

    expect(slEl).not.toHaveAttribute('title')
    expect(tpEl).not.toHaveAttribute('title')
    expect(slEl.className).not.toContain('/60')
    expect(tpEl.className).not.toContain('/60')
    expect(screen.queryByText('~90.0')).not.toBeInTheDocument()
    expect(screen.queryByText('~120.0')).not.toBeInTheDocument()
  })

  it('buy_price null (tp/sl also null): Line 2 does not render — no basis to assume from', async () => {
    mockPlanWithItem(makeItem({ stock: 'MNO', buy_price: null, current_price: 105 }))
    render(<PurchasePlanWidget />)

    // Confirm the row itself rendered (Line 1) before asserting Line 2 absence.
    await screen.findByText('MNO')
    expect(screen.queryByText('←')).not.toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
    expect(screen.queryByText(/^~/)).not.toBeInTheDocument()
  })

  it('never persists assumed values: actionPlanService.update is not called as a side effect of rendering', async () => {
    mockPlanWithItem(makeItem({ stock: 'PQR', buy_price: 100, current_price: 105 }))
    render(<PurchasePlanWidget />)

    await screen.findByText('~85.0')
    await screen.findByText('~115.0')
    expect(actionPlanService.update).not.toHaveBeenCalled()
  })
})
