'use client'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { WeeklyPlanTable } from '../WeeklyPlanTable'
import type { PurchaseItem, PortfolioItem } from '@/services/actionPlan'
import type { WeekDay } from '@/lib/weekDates'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a WeekDay for a given ISO date string. */
function makeWeekDay(
  isoDate: string,
  label: string,
  opts: { isToday?: boolean } = {},
): WeekDay {
  const date = new Date(isoDate + 'T00:00:00')
  return {
    date,
    label,
    dateLabel: label,
    isoDate,
    isToday: opts.isToday ?? false,
  }
}

/**
 * A fixed "current week" with Wednesday 2026-06-17 as today.
 * Mon=past, Tue=past, Wed=today, Thu=future, Fri=future
 * (this matches what the component sees when run with a real clock on that day)
 */
const WEEK_DAYS_WITH_TODAY: WeekDay[] = [
  makeWeekDay('2026-06-15', 'Mon'),            // past
  makeWeekDay('2026-06-16', 'Tue'),            // past
  makeWeekDay('2026-06-17', 'Wed', { isToday: true }), // today
  makeWeekDay('2026-06-18', 'Thu'),            // future — date > today midnight
  makeWeekDay('2026-06-19', 'Fri'),            // future
]

/** A week entirely in the past (all 5 days should show prices). */
const WEEK_DAYS_PAST: WeekDay[] = [
  makeWeekDay('2026-06-08', 'Mon'),
  makeWeekDay('2026-06-09', 'Tue'),
  makeWeekDay('2026-06-10', 'Wed'),
  makeWeekDay('2026-06-11', 'Thu'),
  makeWeekDay('2026-06-12', 'Fri'),
]

/** A week entirely in the future (all 5 cells should be blank). */
const WEEK_DAYS_FUTURE: WeekDay[] = [
  makeWeekDay('2026-06-22', 'Mon'),
  makeWeekDay('2026-06-23', 'Tue'),
  makeWeekDay('2026-06-24', 'Wed'),
  makeWeekDay('2026-06-25', 'Thu'),
  makeWeekDay('2026-06-26', 'Fri'),
]

const PURCHASE_ITEM: PurchaseItem = {
  id: 'item-1',
  sort_order: 0,
  stock: 'BH',
  current_price: 124.00,
  size: 100,
  buy_price: 120.00,
  tp: 140.00,
  sl: 110.00,
  strategy: 'BREAK OUT',
  reason: null,
  triggered: false,
}

const PORTFOLIO_ITEM: PortfolioItem = {
  id: 'item-2',
  sort_order: 0,
  symbol: 'KBANK',
  current_price: 142.00,
  size: 200,
  entry_price: 138.00,
  tp: 160.00,
  sl: 130.00,
  order_size: null,
}

/**
 * Build a priceMap with known historical prices for BH on Mon and Tue
 * of the current week.
 */
function makePriceMap(): Map<string, Map<string, number>> {
  const bhMap = new Map<string, number>([
    ['2026-06-15', 121.50],  // Mon historical close
    ['2026-06-16', 122.75],  // Tue historical close
  ])
  const kbankMap = new Map<string, number>([
    ['2026-06-15', 140.00],
    ['2026-06-16', 141.50],
  ])
  return new Map([
    ['BH', bhMap],
    ['KBANK', kbankMap],
  ])
}

const EMPTY_PRICE_MAP = new Map<string, Map<string, number>>()

// ---------------------------------------------------------------------------
// Suite: Future days render blank (TC-FE-01, AC-1.3 / AC-1.5)
// ---------------------------------------------------------------------------

describe('WeeklyPlanTable — future days render blank', () => {
  it('TC-FE-01a: cells for future days render no price content (purchase)', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // The TARGET label comes from PlanCellDisplay. It should appear for
    // Mon/Tue (past) and Wed (today) but NOT for Thu/Fri (future).
    // We count the number of "TARGET:" labels to verify 3 cells rendered, not 5.
    const targetLabels = screen.getAllByText(/TARGET:/i)
    expect(targetLabels.length).toBe(3) // Mon, Tue, Wed only
  })

  it('TC-FE-01b: all cells blank for a fully future week (AC-1.5)', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_FUTURE}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={false}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // No TARGET: labels at all — every cell is blank
    expect(screen.queryAllByText(/TARGET:/i)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Suite: Today cell uses item.current_price (TC-FE-02, AC-1.2)
// ---------------------------------------------------------------------------

describe('WeeklyPlanTable — today cell uses live item.current_price', () => {
  it('TC-FE-02: today column shows item.current_price (124.0) when isCurrentWeek=true', () => {
    // Mon and Tue get historical prices from priceMap; Wed (today) gets current_price=124.00
    const priceMap = makePriceMap()

    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={priceMap}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // Mon historical close: 121.5 → "121.5"
    // Tue historical close: 122.75 → "122.8" (toFixed(1))
    // Wed today: item.current_price=124.00 → "124.0"
    expect(screen.getByText('121.5')).toBeInTheDocument()
    expect(screen.getByText('122.8')).toBeInTheDocument()
    expect(screen.getByText('124.0')).toBeInTheDocument()
  })

  it('TC-FE-02b: today cell uses priceMap (not current_price) when isCurrentWeek=false', () => {
    // When viewing a historical week, even if a day has isToday=true (which
    // shouldn't happen for offset≠0, but the guard must hold), isCurrentWeek=false
    // must prevent current_price from being used.
    // We fake isToday=true on Mon of a historical week and verify priceMap wins.
    const pastWeekWithFakeToday: WeekDay[] = [
      makeWeekDay('2026-06-08', 'Mon', { isToday: true }), // erroneously marked today
      makeWeekDay('2026-06-09', 'Tue'),
      makeWeekDay('2026-06-10', 'Wed'),
      makeWeekDay('2026-06-11', 'Thu'),
      makeWeekDay('2026-06-12', 'Fri'),
    ]

    const priceMap = new Map<string, Map<string, number>>([
      ['BH', new Map([['2026-06-08', 119.00]])], // priceMap price for "Mon"
    ])

    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={pastWeekWithFakeToday}
        priceMap={priceMap}
        isCurrentWeek={false}  // <— key: not the current week
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // priceMap says 119.0 for that date — should show "119.0"
    // item.current_price=124.00 should NOT appear
    expect(screen.getByText('119.0')).toBeInTheDocument()
    expect(screen.queryByText('124.0')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Suite: Past cells use priceMap (TC-FE-03/04, AC-1.1 / AC-1.4)
// ---------------------------------------------------------------------------

describe('WeeklyPlanTable — past cells use priceMap', () => {
  it('TC-FE-03: past weekday cells show priceMap closing price', () => {
    const priceMap = makePriceMap()

    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={priceMap}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // Mon: 121.5, Tue: 122.75 → toFixed(1) = "122.8"
    expect(screen.getByText('121.5')).toBeInTheDocument()
    expect(screen.getByText('122.8')).toBeInTheDocument()
  })

  it('TC-FE-04: past cell with no priceMap entry shows "—" for CURR', () => {
    // priceMap is empty — past day cells get dayPrice=null, showing "—"
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // The CURR label is present (cells rendered for Mon/Tue/Wed) but shows "—"
    // There will be multiple "—" (one per past cell with no price).
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2) // at minimum Mon and Tue have no price
  })

  it('TC-FE-03b: all 5 days show prices for a fully past week (AC-1.4)', () => {
    // For a week entirely in the past, all 5 cells should render PlanCellDisplay
    const pastPriceMap = new Map<string, Map<string, number>>([
      ['BH', new Map([
        ['2026-06-08', 118.00],
        ['2026-06-09', 119.00],
        ['2026-06-10', 120.00],
        ['2026-06-11', 121.00],
        ['2026-06-12', 122.00],
      ])],
    ])

    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_PAST}
        priceMap={pastPriceMap}
        isCurrentWeek={false}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // All 5 TARGET: labels rendered (one per cell), none blank
    const targetLabels = screen.getAllByText(/TARGET:/i)
    expect(targetLabels.length).toBe(5)

    // All historical prices visible
    expect(screen.getByText('118.0')).toBeInTheDocument()
    expect(screen.getByText('119.0')).toBeInTheDocument()
    expect(screen.getByText('122.0')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Suite: Symbol in row header, absent from cell body (TC-FE-05 – TC-FE-09, AC-3.1/3.2/3.3)
// ---------------------------------------------------------------------------

describe('WeeklyPlanTable — symbol in row header, not cell body', () => {
  it('TC-FE-07: symbol "BH" appears as a button in the row header (purchase)', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // Symbol button in the <th> row header
    const btn = screen.getByRole('button', { name: /BH/i })
    expect(btn).toBeInTheDocument()
    // It should be inside a <th scope="row">
    expect(btn.closest('th')).toBeInTheDocument()
  })

  it('TC-FE-08: symbol "KBANK" appears as a button in the row header (portfolio)', () => {
    render(
      <WeeklyPlanTable
        variant="portfolio"
        items={[PORTFOLIO_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    const btn = screen.getByRole('button', { name: /KBANK/i })
    expect(btn).toBeInTheDocument()
    expect(btn.closest('th')).toBeInTheDocument()
  })

  it('TC-FE-09: clicking the symbol button fires onSymbolClick with correct symbol', async () => {
    const onSymbolClick = vi.fn()
    const user = userEvent.setup()

    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={onSymbolClick}
      />,
    )

    await user.click(screen.getByRole('button', { name: /BH/i }))
    expect(onSymbolClick).toHaveBeenCalledOnce()
    expect(onSymbolClick).toHaveBeenCalledWith('BH')
  })

  it('TC-FE-10: cell body still renders TARGET and CURR labels (AC-3.3)', () => {
    const priceMap = makePriceMap()
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[PURCHASE_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={priceMap}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // TARGET and CURR labels still present (from PlanCellDisplay)
    expect(screen.getAllByText(/TARGET:/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/CURR:/i).length).toBeGreaterThan(0)
    // buy_price=120.00 → "120.0" visible
    expect(screen.getAllByText('120.0').length).toBeGreaterThan(0)
  })

  it('TC-FE-11: portfolio cell still renders P&L % (AC-3.3)', () => {
    // entry=138.00, current=142.00 → pnl = (142-138)/138 * 100 = +2.9%
    const priceMap = new Map([['KBANK', new Map([['2026-06-17', 142.00]])]])

    render(
      <WeeklyPlanTable
        variant="portfolio"
        items={[PORTFOLIO_ITEM]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={priceMap}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )

    // Today's cell (Wed) has dayPrice=142.00 (from priceMap via today + isCurrentWeek path).
    // Actually: today + isCurrentWeek → uses item.current_price=142.00
    // P&L = (142-138)/138*100 = 2.899...% → "+2.9%"
    expect(screen.getAllByText(/\+2\.9%/i).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Suite: Loading and error states (regression)
// ---------------------------------------------------------------------------

describe('WeeklyPlanTable — loading and error states', () => {
  it('shows spinner when isLoading=true', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={true}
        isError={false}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )
    // Loader2 renders with animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })

  it('shows error message when isError=true', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={true}
        hasActivePlan={true}
        onSymbolClick={() => {}}
      />,
    )
    expect(screen.getByText(/Failed to load plan data/i)).toBeInTheDocument()
  })

  it('shows empty message when no plan exists', () => {
    render(
      <WeeklyPlanTable
        variant="purchase"
        items={[]}
        weekDays={WEEK_DAYS_WITH_TODAY}
        priceMap={EMPTY_PRICE_MAP}
        isCurrentWeek={true}
        isLoading={false}
        isError={false}
        hasActivePlan={false}
        onSymbolClick={() => {}}
      />,
    )
    expect(screen.getByText(/No active purchase plan found/i)).toBeInTheDocument()
  })
})
