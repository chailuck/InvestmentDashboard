import { describe, it, expect } from 'vitest'
import { buildDashboardEmailHtml, type VisibilitySnapshot } from '../tracking-export-html'
import type {
  BalanceCell, DashboardBalanceGridOut, OriginalInvestmentRollup,
} from '@/services/tracking'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Builds a 4-entry BalanceCell array (one per quarter) for a given year, defaulting every quarter to "no data" unless overridden. */
function cells(year: number, overrides: Partial<Record<1 | 2 | 3 | 4, Partial<BalanceCell>>> = {}): BalanceCell[] {
  return [1, 2, 3, 4].map(q => ({
    year, quarter: q, balance: null, deltaAmount: null, deltaPercent: null,
    hasData: false, hasPreviousData: false,
    ...(overrides[q as 1 | 2 | 3 | 4] ?? {}),
  }))
}

const EMPTY_VISIBILITY: VisibilitySnapshot = {
  collapsedYears: new Set(),
  collapsedCategories: new Set(),
  collapsedSubCategories: new Set(),
}

/** Two years (2025, 2026 — descending, matching the real API's documented order), one category > one sub-category > two items, plus grand total / property breakdown. Q1 2026 has full data including a delta; every other quarter across both years is deliberately blank so "no data" (—) rendering is also exercised. */
function makeGrid(): DashboardBalanceGridOut {
  return {
    trackingSetId: 'set-1',
    years: [
      { year: 2026, quarters: [1, 2, 3, 4] },
      { year: 2025, quarters: [1, 2, 3, 4] },
    ],
    categories: [
      {
        id: 'cat-1',
        name: 'Assets',
        orderIndex: 0,
        subtotal: [
          ...cells(2026, { 1: { balance: 5000, hasData: true, hasPreviousData: true, deltaAmount: 500, deltaPercent: 11.11 } }),
          ...cells(2025),
        ],
        subCategories: [
          {
            id: 'sub-1',
            name: 'Bank <Accounts>',
            orderIndex: 0,
            subtotal: [
              ...cells(2026, { 1: { balance: 5000, hasData: true, hasPreviousData: true, deltaAmount: 500, deltaPercent: 11.11 } }),
              ...cells(2025),
            ],
            items: [
              {
                id: 'item-1',
                name: 'Kasikorn "Savings"',
                type: 'Bank account',
                orderIndex: 0,
                exclusive: false,
                cells: [
                  ...cells(2026, { 1: { balance: 3000, hasData: true, hasPreviousData: true, deltaAmount: 200, deltaPercent: 7.14 } }),
                  ...cells(2025),
                ],
              },
              {
                id: 'item-2',
                name: 'Excluded Item',
                type: 'Bank account',
                orderIndex: 1,
                exclusive: true,
                cells: [
                  ...cells(2026, { 1: { balance: 2000, hasData: true, hasPreviousData: true, deltaAmount: 300, deltaPercent: 17.65 } }),
                  ...cells(2025),
                ],
              },
            ],
          },
        ],
      },
    ],
    grandTotal: [
      ...cells(2026, { 1: { balance: 5000, hasData: true, hasPreviousData: true, deltaAmount: 500, deltaPercent: 11.11 } }),
      ...cells(2025),
    ],
    propertyBreakdown: {
      propertyTotal: [...cells(2026), ...cells(2025)],
      nonPropertyTotal: [
        ...cells(2026, { 1: { balance: 5000, hasData: true, hasPreviousData: true, deltaAmount: 500, deltaPercent: 11.11 } }),
        ...cells(2025),
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// Structural sanity (no unclosed tags) — a lightweight tag-balance check,
// not a full HTML parser.
// ---------------------------------------------------------------------------

/** Counts opening vs. closing tags for a handful of element types the builder emits, ignoring self-closing/void tags. Good enough to catch a missing </td>/</tr>/</table> without pulling in an HTML parser dependency. */
function assertBalancedTags(html: string, tag: string) {
  const openCount = (html.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g')) ?? []).length
  const closeCount = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
  expect(openCount).toBe(closeCount)
}

describe('buildDashboardEmailHtml — structural sanity', () => {
  it('produces balanced table/tr/td/th tags and no <style> or class attributes', () => {
    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY)
    for (const tag of ['div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2']) {
      assertBalancedTags(html, tag)
    }
    expect(html).not.toMatch(/<style/i)
    expect(html).not.toMatch(/class="/)
  })

  it('returns a "no data" message and no table when the grid has zero years', () => {
    const empty: DashboardBalanceGridOut = {
      trackingSetId: 'set-1', years: [], categories: [],
      grandTotal: [], propertyBreakdown: { propertyTotal: [], nonPropertyTotal: [] },
    }
    const html = buildDashboardEmailHtml(empty, EMPTY_VISIBILITY)
    expect(html).toMatch(/no quarterly data/i)
    expect(html).not.toContain('<table')
  })
})

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

describe('buildDashboardEmailHtml — collapse/expand visibility', () => {
  it('includes every category/sub-category/item row and formatted numbers when nothing is collapsed', () => {
    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY)
    expect(html).toContain('Assets')
    expect(html).toContain('Kasikorn &quot;Savings&quot;')
    expect(html).toContain('Excluded Item')
    expect(html).toContain('Excl.')
    // Thousand-comma formatted balance and signed delta with percent.
    expect(html).toContain('5,000.00')
    expect(html).toContain('+500.00 (+11.11%)')
    // Both years present.
    expect(html).toContain('>2026<')
    expect(html).toContain('>2025<')
  })

  it('omits ALL rows for a collapsed year — not just visually, genuinely absent from the HTML', () => {
    const visibility: VisibilitySnapshot = {
      ...EMPTY_VISIBILITY,
      collapsedYears: new Set([2026]),
    }
    const html = buildDashboardEmailHtml(makeGrid(), visibility)

    // The collapsed year's own data must be gone entirely.
    expect(html).not.toContain('5,000.00')
    expect(html).not.toContain('+500.00 (+11.11%)')
    // A short notice takes its place instead of a table.
    expect(html).toMatch(/2026.*collapsed/)
    // The still-visible year (2025) keeps its own table and category rows.
    expect(html).toContain('>2025<')
    expect(html).toContain('Assets')
    expect(html).toContain('Kasikorn')
  })

  it('keeps a collapsed category\'s own subtotal row visible but omits its sub-categories and items', () => {
    const visibility: VisibilitySnapshot = {
      ...EMPTY_VISIBILITY,
      collapsedCategories: new Set(['cat-1']),
    }
    const html = buildDashboardEmailHtml(makeGrid(), visibility)

    // Category subtotal row itself still renders (with its own 5,000.00 balance).
    expect(html).toContain('Assets')
    expect(html).toContain('5,000.00')
    // But its sub-category and item rows are gone.
    expect(html).not.toContain('Bank &lt;Accounts&gt;')
    expect(html).not.toContain('Kasikorn')
    expect(html).not.toContain('Excluded Item')
  })

  it('keeps a collapsed sub-category\'s own subtotal row visible but omits its items', () => {
    const visibility: VisibilitySnapshot = {
      ...EMPTY_VISIBILITY,
      collapsedSubCategories: new Set(['sub-1']),
    }
    const html = buildDashboardEmailHtml(makeGrid(), visibility)

    // Category and sub-category subtotal rows still render.
    expect(html).toContain('Assets')
    expect(html).toContain('Bank &lt;Accounts&gt;')
    // Item rows are gone.
    expect(html).not.toContain('Kasikorn')
    expect(html).not.toContain('Excluded Item')
  })

  it('always renders Grand Total / Property Total / Non-Property Total for a visible year regardless of category/sub-category collapse state', () => {
    const visibility: VisibilitySnapshot = {
      ...EMPTY_VISIBILITY,
      collapsedCategories: new Set(['cat-1']),
      collapsedSubCategories: new Set(['sub-1']),
    }
    const html = buildDashboardEmailHtml(makeGrid(), visibility)
    expect(html).toContain('Grand Total')
    expect(html).toContain('Property Total')
    expect(html).toContain('Non-Property Total')
  })
})

// ---------------------------------------------------------------------------
// Number formatting and "no data" cells
// ---------------------------------------------------------------------------

describe('buildDashboardEmailHtml — cell formatting', () => {
  it('renders an em-dash for cells with hasData:false and never fabricates a zero', () => {
    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY)
    // Q2/Q3/Q4 2026 and every quarter of 2025 are all hasData:false.
    expect(html).toContain('&mdash;')
  })

  it('renders a negative balance with a leading "-" and no fabricated "+"', () => {
    const grid = makeGrid()
    grid.grandTotal[0] = { ...grid.grandTotal[0], balance: -1234.5 }
    const html = buildDashboardEmailHtml(grid, EMPTY_VISIBILITY)
    expect(html).toContain('-1,234.50')
  })

  it('HTML-escapes item/category/sub-category names to prevent injection into the emailed HTML', () => {
    const grid = makeGrid()
    grid.categories[0].name = '<img src=x onerror=alert(1)>'
    const html = buildDashboardEmailHtml(grid, EMPTY_VISIBILITY)
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

// ---------------------------------------------------------------------------
// Optional "Original Investment vs Profit" section (3rd `rollup` argument)
// ---------------------------------------------------------------------------

/** A rollup with one covered row, one not-covered row, plus a covered-only totals block and one excluded name. */
function makeRollup(): OriginalInvestmentRollup {
  return {
    trackingSetId: 'set-1',
    generatedAt: '2026-08-30T07:30:00+00:00',
    coverage: { shownCount: 1, totalCount: 3, excludedItemNames: ['Condo Bangkok'] },
    items: [
      {
        itemId: 'it-1', itemName: 'ARK Growth', categoryName: 'Investments', subCategoryName: 'US Equity',
        netOriginalInvestment: 100000, currentValue: 132000,
        currentValueSlot: { year: 2026, quarter: 2 },
        profit: 32000, profitPercent: 32, isCovered: true,
      },
      {
        itemId: 'it-2', itemName: 'Condo Bangkok', categoryName: 'Property', subCategoryName: 'Real estate',
        netOriginalInvestment: null, currentValue: 5200000,
        currentValueSlot: { year: 2026, quarter: 1 },
        profit: null, profitPercent: null, isCovered: false,
      },
    ],
    totals: { netOriginalInvestment: 100000, currentValue: 132000, profit: 32000, profitPercent: 32 },
  }
}

describe('buildDashboardEmailHtml — optional original-investment rollup section', () => {
  it('is byte-identical to the no-rollup output when the 3rd arg is omitted, null, or an empty-items rollup', () => {
    const grid = makeGrid()
    const baseline = buildDashboardEmailHtml(grid, EMPTY_VISIBILITY)

    expect(buildDashboardEmailHtml(grid, EMPTY_VISIBILITY, undefined)).toBe(baseline)
    expect(buildDashboardEmailHtml(grid, EMPTY_VISIBILITY, null)).toBe(baseline)

    const emptyRollup: OriginalInvestmentRollup = {
      ...makeRollup(),
      items: [],
      coverage: { shownCount: 0, totalCount: 0, excludedItemNames: [] },
      totals: { netOriginalInvestment: null, currentValue: null, profit: null, profitPercent: null },
    }
    expect(buildDashboardEmailHtml(grid, EMPTY_VISIBILITY, emptyRollup)).toBe(baseline)
  })

  it('appends a profit section (heading + one row per item + coverage footnote) when a non-empty rollup is passed', () => {
    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY, makeRollup())

    expect(html).toContain('Original Investment vs Profit')
    expect(html).toContain('ARK Growth')
    expect(html).toContain('Condo Bangkok')
    // Covered row: real figures via formatNumber / toFixed.
    expect(html).toContain('100,000.00')
    expect(html).toContain('132,000.00')
    expect(html).toContain('32,000.00')
    expect(html).toContain('32.00%')
    // Covered-only totals row.
    expect(html).toContain('Total (covered items)')
    // Coverage footnote with the excluded name.
    expect(html).toContain('Profit vs original shown for 1 of 3 tracked items.')
    expect(html).toContain('Not shown: Condo Bangkok.')
  })

  it('renders an em dash (never a fabricated 0 / 0%) in every numeric cell of a not-covered row', () => {
    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY, makeRollup())

    // Isolate the Condo Bangkok <tr> and assert its 4 numeric cells are all em dashes.
    const rowMatch = html.match(/<tr>(?:(?!<\/tr>).)*Condo Bangkok(?:(?!<\/tr>).)*<\/tr>/s)
    expect(rowMatch).not.toBeNull()
    const row = rowMatch![0]
    expect((row.match(/&mdash;/g) ?? []).length).toBe(4)
    expect(row).not.toContain('0.00')
    expect(row).not.toContain('0%')
    // The not-covered row still carries its name / category / sub-category.
    expect(row).toContain('Property')
    expect(row).toContain('Real estate')
  })

  it('passes a Thai itemName through escapeHtml unchanged (not broken) and escapes an itemName containing <script>', () => {
    const rollup = makeRollup()
    rollup.items[0].itemName = 'กองทุนหุ้นสหรัฐ'
    rollup.items[1].itemName = '<script>alert(1)</script>'
    rollup.coverage.excludedItemNames = ['<script>alert(2)</script>']

    const html = buildDashboardEmailHtml(makeGrid(), EMPTY_VISIBILITY, rollup)

    // Thai text is passed through verbatim (escapeHtml leaves it untouched).
    expect(html).toContain('กองทุนหุ้นสหรัฐ')
    // <script> is neutralised in both the table cell and the footnote.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })
})
