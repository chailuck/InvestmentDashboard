import { describe, it, expect } from 'vitest'
import type {
  BalanceCell,
  DashboardBalanceGridOut,
  DashboardCategoryRow,
} from '@/services/tracking'
import type { ViewState } from '@/app/(dashboard)/tracking/analysis/types'
import {
  allowedGroupBy,
  annualisedChange,
  applyGranularity,
  asOfYearlySeries,
  buildScopedGrid,
  buildStatRow,
  cellIndex,
  computeComposition,
  computeSeriesDeltas,
  defaultGroupBy,
  defaultViewState,
  deriveChartModel,
  drillDepth,
  lensIncludes,
  periodsAsc,
  queryToViewState,
  readCellSeries,
  resolveComparison,
  rollupBalances,
  rollupOther,
  trimEmptyEnds,
  viewStateToQuery,
  yearlyRowView,
  CATEGORICAL_PALETTE,
  type RawBucket,
} from '../tracking-analysis'

// ── Fixture helpers ────────────────────────────────────────────────────────

type Q = 1 | 2 | 3 | 4
const QUARTERS: Q[] = [1, 2, 3, 4]

/**
 * Builds a positionally-aligned `BalanceCell[]` (DESCENDING years × Q1..4)
 * from an ASCENDING value list, deriving deltas with the server engine's
 * rules. Used for structural fixtures (delta PARITY itself is locked below by
 * a separate hand-authored literal fixture).
 */
function makeCells(yearsDesc: number[], ascValues: (number | null)[]): BalanceCell[] {
  const ascYears = [...yearsDesc].reverse()
  const ascPP = ascYears.flatMap(y => QUARTERS.map(q => ({ year: y, quarter: q })))
  let last: number | null = null
  const asc = ascPP.map((pp, i) => {
    const v = ascValues[i] ?? null
    if (v === null) {
      return { ...pp, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false }
    }
    const hadPrev = last !== null
    let dA: number | null = null
    let dP: number | null = null
    if (last !== null) {
      dA = v - last
      dP = last === 0 ? null : (dA / last) * 100
    }
    last = v
    return { ...pp, balance: v, deltaAmount: dA, deltaPercent: dP, hasData: true, hasPreviousData: hadPrev }
  })
  const out: BalanceCell[] = []
  for (const y of yearsDesc) for (const q of QUARTERS) {
    out.push(asc.find(c => c.year === y && c.quarter === q) as BalanceCell)
  }
  return out
}

function sumAsc(...lists: (number | null)[][]): (number | null)[] {
  const len = lists[0].length
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    let total: number | null = null
    for (const l of lists) {
      const v = l[i]
      if (v !== null && v !== undefined) total = total === null ? v : total + v
    }
    out.push(total)
  }
  return out
}

// Rich structural fixture — years desc [2024, 2023]; ascending = 2023 Q1-4, 2024 Q1-4.
const A_CHECK = [null, null, null, 100, 110, 120, null, null]
const A_SAVE = [null, null, null, 200, 200, 250, null, null]
const A_HOUSE = [null, null, null, 1000, 1000, 1100, null, null]
const A_GOLD = [null, null, null, 50, null, 60, null, null]
const A_SIDEBET = [null, null, null, 9999, 8000, 7000, null, null]

const A_S1 = sumAsc(A_CHECK, A_SAVE)
const A_S2 = sumAsc(A_HOUSE)
const A_S3 = sumAsc(A_GOLD)
const A_C1 = sumAsc(A_S1, A_S2)
const A_C2 = sumAsc(A_S3)
const A_GT = sumAsc(A_C1, A_C2)
const A_PROP = sumAsc(A_HOUSE)
const A_NONPROP = sumAsc(A_CHECK, A_SAVE, A_GOLD)

function richGrid(): DashboardBalanceGridOut {
  const yearsDesc = [2024, 2023]
  const cat1: DashboardCategoryRow = {
    id: 'c1', name: 'Assets', orderIndex: 0,
    subtotal: makeCells(yearsDesc, A_C1),
    subCategories: [
      {
        id: 's1', name: 'Bank', orderIndex: 0, subtotal: makeCells(yearsDesc, A_S1),
        items: [
          { id: 'i1', name: 'Checking', type: 'Bank account', orderIndex: 0, exclusive: false, cells: makeCells(yearsDesc, A_CHECK) },
          { id: 'i2', name: 'Savings', type: 'Bank account', orderIndex: 1, exclusive: false, cells: makeCells(yearsDesc, A_SAVE) },
        ],
      },
      {
        id: 's2', name: 'Realty', orderIndex: 1, subtotal: makeCells(yearsDesc, A_S2),
        items: [
          { id: 'i3', name: 'House', type: 'Property', orderIndex: 0, exclusive: false, cells: makeCells(yearsDesc, A_HOUSE) },
        ],
      },
    ],
  }
  const cat2: DashboardCategoryRow = {
    id: 'c2', name: 'Misc', orderIndex: 1,
    subtotal: makeCells(yearsDesc, A_C2),
    subCategories: [
      {
        id: 's3', name: 'Other', orderIndex: 0, subtotal: makeCells(yearsDesc, A_S3),
        items: [
          { id: 'i4', name: 'Gold', type: 'Materials', orderIndex: 0, exclusive: false, cells: makeCells(yearsDesc, A_GOLD) },
          { id: 'i5', name: 'SideBet', type: 'Investment Account', orderIndex: 1, exclusive: true, cells: makeCells(yearsDesc, A_SIDEBET) },
        ],
      },
    ],
  }
  return {
    trackingSetId: 'set-1',
    years: yearsDesc.map(y => ({ year: y, quarters: [1, 2, 3, 4] })),
    categories: [cat1, cat2],
    grandTotal: makeCells(yearsDesc, A_GT),
    propertyBreakdown: {
      propertyTotal: makeCells(yearsDesc, A_PROP),
      nonPropertyTotal: makeCells(yearsDesc, A_NONPROP),
    },
  }
}

function vs(partial: Partial<ViewState> = {}): ViewState {
  return { ...defaultViewState('set-1'), ...partial }
}

// ── periodsAsc / cellIndex ─────────────────────────────────────────────────

describe('periodsAsc / cellIndex', () => {
  it('reverses descending years and cross-joins with quarters', () => {
    const g = richGrid()
    const axis = periodsAsc(g)
    expect(axis).toHaveLength(8)
    expect(axis[0]).toMatchObject({ year: 2023, quarter: 1, index: 0 })
    expect(axis[7]).toMatchObject({ year: 2024, quarter: 4, index: 7 })
  })
  it('maps (year, quarter) to the descending-aligned flat index', () => {
    const g = richGrid()
    expect(cellIndex(g, 2024, 1)).toBe(0)
    expect(cellIndex(g, 2024, 4)).toBe(3)
    expect(cellIndex(g, 2023, 1)).toBe(4)
    expect(cellIndex(g, 1999, 1)).toBe(-1)
  })
})

// ── computeSeriesDeltas — semantics ───────────────────────────────────────

describe('computeSeriesDeltas', () => {
  it('first populated slot has null deltas (never 0)', () => {
    const d = computeSeriesDeltas([null, 500, 600])
    expect(d.deltaAmount[0]).toBeNull()
    expect(d.deltaAmount[1]).toBeNull()
    expect(d.deltaPercent[1]).toBeNull()
    expect(d.hasPreviousData[1]).toBe(false)
    expect(d.deltaAmount[2]).toBe(100)
    expect(d.deltaPercent[2]).toBeCloseTo(20)
  })
  it('a blank slot does not advance last_seen (delta looks back across the gap)', () => {
    const d = computeSeriesDeltas([100, null, 200])
    expect(d.deltaAmount[2]).toBe(100)
    expect(d.deltaPercent[2]).toBeCloseTo(100)
    expect(d.deltaAmount[1]).toBeNull()
  })
  it('deltaPercent is null ONLY when the prior value is exactly 0', () => {
    const d = computeSeriesDeltas([0, 100])
    expect(d.deltaAmount[1]).toBe(100)
    expect(d.deltaPercent[1]).toBeNull()
  })
  it('a genuine 0 change is a 0 delta, not null (not a first point)', () => {
    const d = computeSeriesDeltas([100, 100])
    expect(d.deltaAmount[1]).toBe(0)
    expect(d.deltaPercent[1]).toBe(0)
  })
})

// ── GOLDEN-FIXTURE PARITY TEST (TS replica vs server engine) ───────────────

/**
 * Hand-authored `grandTotal` with the deltas the Python `compute_series_deltas`
 * would produce, encoded as LITERALS (first→null, blank slot skipped without
 * advancing last_seen, %-null only when the prior value is exactly 0). The
 * test asserts the TS replica reproduces every populated slot byte-for-byte.
 */
function parityGrid(): DashboardBalanceGridOut {
  const yearsDesc = [2025, 2024, 2023]
  // DESCENDING flat order: 2025 Q1-4, 2024 Q1-4, 2023 Q1-4
  const gt: BalanceCell[] = [
    { year: 2025, quarter: 1, balance: 200, deltaAmount: 100, deltaPercent: 100, hasData: true, hasPreviousData: true },
    { year: 2025, quarter: 2, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
    { year: 2025, quarter: 3, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
    { year: 2025, quarter: 4, balance: 50, deltaAmount: -150, deltaPercent: -75, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 1, balance: 0, deltaAmount: -1500, deltaPercent: -100, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 2, balance: 100, deltaAmount: 100, deltaPercent: null, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 100, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
    { year: 2023, quarter: 1, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
    { year: 2023, quarter: 2, balance: 1000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2023, quarter: 3, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
    { year: 2023, quarter: 4, balance: 1500, deltaAmount: 500, deltaPercent: 50, hasData: true, hasPreviousData: true },
  ]
  const blanks = Array.from({ length: 12 }, (): BalanceCell => ({
    year: 0, quarter: 0, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false,
  }))
  return {
    trackingSetId: 'set-1',
    years: yearsDesc.map(y => ({ year: y, quarters: [1, 2, 3, 4] })),
    categories: [{
      id: 'c1', name: 'All', orderIndex: 0, subtotal: gt,
      subCategories: [{
        id: 's1', name: 'All', orderIndex: 0, subtotal: gt,
        items: [{ id: 'i1', name: 'All', type: 'Bank account', orderIndex: 0, exclusive: false, cells: gt }],
      }],
    }],
    grandTotal: gt,
    propertyBreakdown: { propertyTotal: blanks, nonPropertyTotal: gt },
  }
}

describe('PARITY — TS computeSeriesDeltas === server BalanceCell deltas (Grand Total lens)', () => {
  it('matches deltaAmount / deltaPercent for every populated slot', () => {
    const g = parityGrid()
    const s = readCellSeries(g, g.grandTotal)
    const d = computeSeriesDeltas(s.balance)
    const axis = periodsAsc(g)

    let populated = 0
    for (let i = 0; i < axis.length; i++) {
      if (s.balance[i] === null) continue
      populated++
      const server = g.grandTotal[cellIndex(g, axis[i].year, axis[i].quarter)]
      // deltaAmount
      if (server.deltaAmount === null) expect(d.deltaAmount[i]).toBeNull()
      else expect(d.deltaAmount[i]).toBeCloseTo(server.deltaAmount as number, 9)
      // deltaPercent
      if (server.deltaPercent === null) expect(d.deltaPercent[i]).toBeNull()
      else expect(d.deltaPercent[i]).toBeCloseTo(server.deltaPercent as number, 9)
      // has_previous_data
      expect(d.hasPreviousData[i]).toBe(server.hasPreviousData)
    }
    expect(populated).toBe(7)
  })

  it('reproduces the four tricky cases explicitly', () => {
    const g = parityGrid()
    const d = computeSeriesDeltas(readCellSeries(g, g.grandTotal).balance)
    // ascending indices: 0..11 = 2023Q1..2025Q4
    expect(d.deltaAmount[1]).toBeNull() // first populated (2023 Q2)
    expect(d.deltaPercent[5]).toBeNull() // 2024 Q2 — prior was exactly 0
    expect(d.deltaAmount[6]).toBe(0) // 2024 Q3 — genuine zero change
    expect(d.deltaAmount[8]).toBe(100) // 2025 Q1 — diffed across blank 2024 Q4
  })
})

// ── rollupBalances ────────────────────────────────────────────────────────

describe('rollupBalances', () => {
  it('sums the populated contributors per period ("at least one populated")', () => {
    const out = rollupBalances([[10, null, 5], [20, 30, null]], 3)
    expect(out).toEqual([30, 30, 5])
  })
  it('leaves a period null when no contributor has data', () => {
    const out = rollupBalances([[null, null], [null, 7]], 2)
    expect(out).toEqual([null, 7])
  })
})

// ── lensIncludes ─────────────────────────────────────────────────────────

describe('lensIncludes', () => {
  it('excludes exclusive items from every lens', () => {
    expect(lensIncludes('grandTotal', { type: 'Property', exclusive: true })).toBe(false)
  })
  it('property lens keeps only type Property', () => {
    expect(lensIncludes('property', { type: 'Property', exclusive: false })).toBe(true)
    expect(lensIncludes('property', { type: 'Bank account', exclusive: false })).toBe(false)
  })
  it('nonProperty lens keeps the other five types', () => {
    expect(lensIncludes('nonProperty', { type: 'Property', exclusive: false })).toBe(false)
    expect(lensIncludes('nonProperty', { type: 'Insurance', exclusive: false })).toBe(true)
  })
})

// ── asOfYearlySeries ─────────────────────────────────────────────────────

describe('asOfYearlySeries', () => {
  const axis = periodsAsc(richGrid())

  it('picks the latest populated quarter of each year', () => {
    // ascending: 2023 Q1-4, 2024 Q1-4 ; populate 2023 Q2 & Q4, 2024 Q1
    const balances = [null, 111, null, 222, 333, null, null, null]
    const y = asOfYearlySeries(balances, axis)
    expect(y).toEqual([
      { year: 2023, index: 0, value: 222, asOfQuarter: 4 },
      { year: 2024, index: 1, value: 333, asOfQuarter: 1 },
    ])
  })
  it('null value / null as-of for a fully blank year', () => {
    const y = asOfYearlySeries([null, null, null, 10, null, null, null, null], axis)
    expect(y[1]).toEqual({ year: 2024, index: 1, value: null, asOfQuarter: null })
  })
  it('yearly delta skips a blank year and honours the prior-exactly-0 rule', () => {
    // 3 years: 2022, 2023, 2024
    const g3 = richGrid()
    g3.years = [2024, 2023, 2022].map(yy => ({ year: yy, quarters: [1, 2, 3, 4] }))
    const axis3 = periodsAsc(g3)
    // ascending 12 slots: 2022 Q4 = 0, 2023 all blank, 2024 Q2 = 40
    const balances = [null, null, null, 0, null, null, null, null, null, 40, null, null]
    const y = asOfYearlySeries(balances, axis3)
    expect(y.map(p => p.value)).toEqual([0, null, 40])
    const view = yearlyRowView(
      { key: 'k', kind: 'item', label: 'x', indent: 0, balance: balances, deltaAmount: [], deltaPercent: [], hasData: [], hasPreviousData: [] },
      axis3,
    )
    expect(view.deltaAmount[2]).toBe(40) // 40 - 0, skipping blank 2023
    expect(view.deltaPercent[2]).toBeNull() // prior as-of was exactly 0
  })
})

// ── computeComposition ───────────────────────────────────────────────────

describe('computeComposition', () => {
  it('shares sum to exactly 100 with the residual on the last band', () => {
    const res = computeComposition([[1], [1], [1]], [3])
    const col = res.sharePercent.map(b => b[0] as number)
    expect(col.reduce((a, v) => a + v, 0)).toBeCloseTo(100, 6)
    // 33.3 + 33.3 + 33.4 (residual)
    expect(col[2]).toBeCloseTo(33.4, 6)
  })
  it('blank period (total null or <= 0) → all null', () => {
    const res = computeComposition([[5], [5]], [0])
    expect(res.sharePercent[0][0]).toBeNull()
    expect(res.sharePercent[1][0]).toBeNull()
  })
  it('a null bucket contributes 0 in a valid period', () => {
    const res = computeComposition([[null], [10]], [10])
    expect(res.sharePercent[0][0]).toBe(0)
    expect(res.sharePercent[1][0]).toBeCloseTo(100)
    expect(res.absolute[0][0]).toBeNull()
  })
})

// ── trimEmptyEnds + trim-parity with the dashboard chart ──────────────────

describe('trimEmptyEnds', () => {
  it('drops leading/trailing empties and keeps interior gaps', () => {
    const empty = [true, false, true, false, true]
    const w = trimEmptyEnds(5, i => empty[i])
    expect(w).toEqual({ start: 1, end: 3 })
  })
  it('all-empty → start > end', () => {
    const w = trimEmptyEnds(3, () => true)
    expect(w.start).toBeGreaterThan(w.end)
  })
})

describe('trim parity with the dashboard chart', () => {
  it('the analysis trimmed window matches the dashboard chartQuarters slice for identical data', () => {
    const g = richGrid()
    // Dashboard rule: leading = first idx where ANY category subtotal OR grandTotal hasData;
    // trailing = last such. Ascending order.
    const ascYears = [...g.years].reverse()
    const flat = ascYears.flatMap(yc => yc.quarters.map((q, i) => ({
      cellIdx: g.years.indexOf(yc) * 4 + i,
    })))
    const hasDataAt = (cellIdx: number) =>
      g.categories.some(c => c.subtotal[cellIdx]?.hasData) || g.grandTotal[cellIdx]?.hasData
    const first = flat.findIndex(q => hasDataAt(q.cellIdx))
    let lastIdx = -1
    for (let i = flat.length - 1; i >= 0; i--) if (hasDataAt(flat[i].cellIdx)) { lastIdx = i; break }
    const dashboardWindow = { start: first, end: lastIdx }

    const model = deriveChartModel(g, vs({ lens: 'grandTotal', groupBy: 'category' }))
    // analysis axis is re-indexed from 0; recover the window via first/last labels
    const axisLabels = periodsAsc(g).map(p => `Q${p.quarter} ${p.year}`)
    const analysisStart = axisLabels.indexOf(model.axis[0].label)
    const analysisEnd = axisLabels.indexOf(model.axis[model.axis.length - 1].label)
    expect({ start: analysisStart, end: analysisEnd }).toEqual(dashboardWindow)
  })
})

// ── rollupOther ─────────────────────────────────────────────────────────

describe('rollupOther', () => {
  const mk = (id: string, order: number, peak: number): RawBucket => ({
    id, label: id, kind: 'category', drillId: id, orderIndex: order, balance: [peak, peak / 2],
  })
  it('≤ 8 buckets are returned unchanged but sorted by orderIndex', () => {
    const out = rollupOther([mk('b', 2, 5), mk('a', 1, 9)])
    expect(out.map(b => b.id)).toEqual(['a', 'b'])
  })
  it('> 8 buckets fold the smallest into a muted "Other (n)"', () => {
    const many = Array.from({ length: 11 }, (_, i) => mk(`b${i}`, i, 100 - i))
    const out = rollupOther(many)
    expect(out).toHaveLength(8)
    const other = out[out.length - 1]
    expect(other.id).toBe('__other__')
    expect(other.label).toBe('Other (4)')
    expect(other.drillId).toBeNull()
  })
})

// ── deriveChartModel ────────────────────────────────────────────────────

describe('deriveChartModel', () => {
  it('depth 0 / Grand Total / by category — buckets, palette colours, aggregate = grandTotal', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs())
    expect(m.empty).toBeNull()
    expect(m.buckets.map(b => b.label)).toEqual(['Assets', 'Misc'])
    expect(m.buckets[0].color).toBe(CATEGORICAL_PALETTE[0])
    expect(m.buckets[1].color).toBe(CATEGORICAL_PALETTE[1])
    // aggregate last populated == grandTotal 2024 Q2 == 1530
    expect(m.aggregate.balance[m.aggregate.balance.length - 1]).toBe(1530)
  })

  it('property lens — only House qualifies; aggregate = propertyTotal', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs({ lens: 'property', drill: { lens: 'property' } }))
    // "Misc" has no Property item → dropped
    expect(m.buckets.map(b => b.label)).toEqual(['Assets'])
    expect(m.aggregate.balance[m.aggregate.balance.length - 1]).toBe(1100)
  })

  it('groupBy = itemType buckets the current node descendants by type', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs({ groupBy: 'itemType' }))
    expect(m.buckets.map(b => b.label).sort()).toEqual(['Bank account', 'Materials', 'Property'])
  })

  it('depth 3 leaf — single series; leafExcluded true when the item is exclusive', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs({ drill: { lens: 'grandTotal', categoryId: 'c2', subCategoryId: 's3', itemId: 'i5' } }))
    expect(m.buckets).toHaveLength(1)
    expect(m.leafExcluded).toBe(true)
  })

  it('empty reasons', () => {
    const empty = { ...richGrid(), years: [] as DashboardBalanceGridOut['years'] }
    expect(deriveChartModel(empty, vs()).empty).toBe('noQuarterlyData')
    // property lens drilled into the Bank sub-category → no Property items there
    const g = richGrid()
    const m = deriveChartModel(g, vs({ lens: 'property', drill: { lens: 'property', categoryId: 'c1', subCategoryId: 's1' } }))
    expect(m.empty).toBe('noQualifyingItems')
  })

  it('yearly granularity collapses to as-of-year-end values', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs({ granularity: 'yearly' }))
    expect(m.axis.map(a => a.label)).toEqual(['2023', '2024'])
    expect(m.axis[0].asOfQuarter).toBe(4)
    // 2024 as-of = Q2 = grand total 1530
    expect(m.aggregate.balance[1]).toBe(1530)
  })
})

// ── buildStatRow ────────────────────────────────────────────────────────

describe('buildStatRow', () => {
  it('scope-aware latest / range / populated counts', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs())
    const s = buildStatRow(m.axis, m.aggregate.balance)
    expect(s.latestValue).toBe(1530)
    expect(s.populatedCount).toBe(3)
    expect(s.totalPeriods).toBe(3)
    expect(s.rangeChangeAmount).toBe(1530 - 1350)
  })
  it('annualised is n/a below a one-year span', () => {
    const g = richGrid()
    const m = deriveChartModel(g, vs())
    expect(buildStatRow(m.axis, m.aggregate.balance).annualisedPercent).toBeNull()
  })
})

describe('annualisedChange', () => {
  it('null when the base is non-positive or the span is < 1 year', () => {
    expect(annualisedChange(0, 100, 3)).toBeNull()
    expect(annualisedChange(100, 200, 0.5)).toBeNull()
  })
  it('CAGR-style percentage for a valid span', () => {
    expect(annualisedChange(100, 400, 2)).toBeCloseTo(100) // doubles each year
  })
})

// ── buildScopedGrid ────────────────────────────────────────────────────

describe('buildScopedGrid', () => {
  it('depth 0 — does not render; 3-row lens strip', () => {
    const sg = buildScopedGrid(richGrid(), vs())
    expect(sg.render).toBe(false)
    expect(sg.lensStripRows.map(r => r.label)).toEqual(['Grand Total', 'Property', 'Non-Property'])
  })

  it('depth 1 / Grand Total — verbatim scope total, sub-category subtotals, split rows, exclusive block', () => {
    const sg = buildScopedGrid(richGrid(), vs({ drill: { lens: 'grandTotal', categoryId: 'c1' } }))
    const scopeTotal = sg.rows.find(r => r.kind === 'scopeTotal')!
    // rows use the FULL untrimmed axis; 2024 Q2 is ascending index 5.
    // verbatim category.subtotal → 2024 Q2 = 1470
    expect(scopeTotal.balance[5]).toBe(1470)
    expect(sg.rows.some(r => r.kind === 'splitProperty')).toBe(true)
    expect(sg.rows.some(r => r.kind === 'splitNonProperty')).toBe(true)
    expect(sg.rows.filter(r => r.kind === 'subCategorySubtotal').map(r => r.label)).toEqual(['Bank', 'Realty'])
    // no exclusive descendants under c1
    expect(sg.exclusiveRows).toHaveLength(0)
  })

  it('depth 1 / Property lens — DERIVED scope total, no split rows, non-qualifying subs hidden', () => {
    const sg = buildScopedGrid(richGrid(), vs({ lens: 'property', drill: { lens: 'property', categoryId: 'c1' } }))
    const scopeTotal = sg.rows.find(r => r.kind === 'scopeTotal')!
    // derived Σ of Property leaves (House only) → 2024 Q2 (asc index 5) = 1100
    expect(scopeTotal.balance[5]).toBe(1100)
    expect(sg.rows.some(r => r.kind === 'splitProperty')).toBe(false)
    expect(sg.rows.filter(r => r.kind === 'subCategorySubtotal').map(r => r.label)).toEqual(['Realty'])
  })

  it('depth 1 / Property lens on a category with no Property items → lensMismatchScope + exclusive block still built', () => {
    const sg = buildScopedGrid(richGrid(), vs({ lens: 'property', drill: { lens: 'property', categoryId: 'c2' } }))
    expect(sg.emptyState.kind).toBe('lensMismatchScope')
    if (sg.emptyState.kind === 'lensMismatchScope') expect(sg.emptyState.totalItems).toBe(1)
    expect(sg.rows).toHaveLength(0)
    expect(sg.exclusiveRows.map(r => r.label)).toEqual(['SideBet'])
  })

  it('depth 2 / Grand Total — split rows only for mixed types, else a note', () => {
    const mixed = buildScopedGrid(richGrid(), vs({ drill: { lens: 'grandTotal', categoryId: 'c2', subCategoryId: 's3' } }))
    // s3 has Materials only (SideBet is exclusive → not counted for the split test) → note, no split rows
    expect(mixed.splitNote).toContain('Materials')
    expect(mixed.rows.some(r => r.kind === 'splitProperty')).toBe(false)

    const bankSub = buildScopedGrid(richGrid(), vs({ drill: { lens: 'grandTotal', categoryId: 'c1', subCategoryId: 's1' } }))
    // Bank has 2 Bank-account items → single type → note
    expect(bankSub.splitNote).toContain('Bank account')
  })

  it('depth 3 exclusive leaf — exclusiveLeaf empty state, item row + scope facts', () => {
    const sg = buildScopedGrid(richGrid(), vs({ drill: { lens: 'grandTotal', categoryId: 'c2', subCategoryId: 's3', itemId: 'i5' } }))
    expect(sg.emptyState.kind).toBe('exclusiveLeaf')
    expect(sg.rows).toHaveLength(1)
    expect(sg.scopeFacts).not.toBeNull()
  })

  it('depth 3 lens mismatch — item fails the active lens', () => {
    const sg = buildScopedGrid(richGrid(), vs({ lens: 'property', drill: { lens: 'property', categoryId: 'c1', subCategoryId: 's1', itemId: 'i1' } }))
    expect(sg.emptyState.kind).toBe('lensMismatchItem')
    if (sg.emptyState.kind === 'lensMismatchItem') expect(sg.emptyState.itemType).toBe('Bank account')
    expect(sg.rows).toHaveLength(0)
  })

  it('depth 3 qualifying leaf — one balance row, scope facts, completeness', () => {
    const sg = buildScopedGrid(richGrid(), vs({ drill: { lens: 'grandTotal', categoryId: 'c1', subCategoryId: 's1', itemId: 'i1' } }))
    expect(sg.emptyState.kind).toBe('none')
    expect(sg.rows).toHaveLength(1)
    expect(sg.scopeFacts?.populatedCount).toBe(3)
    expect(sg.completeness.populated).toBe(3)
  })
})

// ── depth / group-by helpers ────────────────────────────────────────────

describe('drill depth & group-by defaults', () => {
  it('drillDepth from a DrillPath', () => {
    expect(drillDepth({ lens: 'grandTotal' })).toBe(0)
    expect(drillDepth({ lens: 'grandTotal', categoryId: 'c' })).toBe(1)
    expect(drillDepth({ lens: 'grandTotal', categoryId: 'c', subCategoryId: 's' })).toBe(2)
    expect(drillDepth({ lens: 'grandTotal', categoryId: 'c', subCategoryId: 's', itemId: 'i' })).toBe(3)
  })
  it('default & allowed group-by per depth (§4.4 table)', () => {
    expect(defaultGroupBy(0)).toBe('category')
    expect(defaultGroupBy(1)).toBe('subCategory')
    expect(defaultGroupBy(2)).toBe('item')
    expect(allowedGroupBy(0)).toEqual(['category', 'itemType'])
    expect(allowedGroupBy(3)).toEqual([])
  })
})

// ── resolveComparison ──────────────────────────────────────────────────

describe('resolveComparison', () => {
  const g = richGrid()
  const model = deriveChartModel(g, vs())

  it('QoQ resolves to the last two populated periods', () => {
    const r = resolveComparison({ mode: 'qoq' }, model.axis, model.aggregate.balance)
    expect(r.ok).toBe(true)
    expect(r.periodB).toEqual({ kind: 'quarter', year: 2024, quarter: 2 })
    expect(r.periodA).toEqual({ kind: 'quarter', year: 2024, quarter: 1 })
  })

  it('YoY falls back to the nearest earlier populated period when the exact one is a gap', () => {
    const r = resolveComparison({ mode: 'yoy' }, model.axis, model.aggregate.balance)
    // B = 2024 Q2 ; exact 2023 Q2 is blank → fall back to 2023 Q4
    expect(r.ok).toBe(true)
    expect(r.fallbackUsed).toBe(true)
    expect(r.periodA).toEqual({ kind: 'quarter', year: 2023, quarter: 4 })
  })

  it('off / insufficient data', () => {
    expect(resolveComparison({ mode: 'off' }, model.axis, model.aggregate.balance).ok).toBe(false)
    const r = resolveComparison({ mode: 'qoq' }, model.axis.slice(0, 1), [100])
    expect(r.ok).toBe(false)
  })
})

// ── URL (de)serialisation ─────────────────────────────────────────────

describe('viewState ⇄ query string', () => {
  it('round-trips a non-default state', () => {
    const state = vs({
      lens: 'property',
      granularity: 'yearly',
      measure: 'deltaAmount',
      groupBy: 'itemType',
      drill: { lens: 'property', categoryId: 'c1' },
      deltaMode: 'waterfall',
      comparison: { mode: 'custom', periodA: { kind: 'quarter', year: 2024, quarter: 1 }, periodB: { kind: 'quarter', year: 2024, quarter: 2 } },
    })
    const qs = viewStateToQuery(state)
    const back = queryToViewState(qs, 'set-1')
    expect(back.lens).toBe('property')
    expect(back.granularity).toBe('yearly')
    expect(back.measure).toBe('deltaAmount')
    expect(back.groupBy).toBe('itemType')
    expect(back.drill.categoryId).toBe('c1')
    expect(back.deltaMode).toBe('waterfall')
    expect(back.comparison.mode).toBe('custom')
    expect(back.comparison.periodA).toEqual({ kind: 'quarter', year: 2024, quarter: 1 })
  })

  it('rejects/clamps bad params back to defaults', () => {
    const p = new URLSearchParams('lens=bogus&g=weekly&m=nope&groupBy=nonsense&delta=spin')
    const s = queryToViewState(p, 'set-1')
    expect(s.lens).toBe('grandTotal')
    expect(s.granularity).toBe('quarterly')
    expect(s.measure).toBe('balance')
    expect(s.groupBy).toBe('category')
    expect(s.deltaMode).toBe('bars')
  })

  it('forces groupBy to an allowed value for the hydrated depth', () => {
    // groupBy=category is illegal at depth 2 → coerced to the depth-2 default (item)
    const p = new URLSearchParams('cat=c1&sub=s1&groupBy=category')
    const s = queryToViewState(p, 'set-1')
    expect(drillDepth(s.drill)).toBe(2)
    expect(s.groupBy).toBe('item')
  })
})

describe('applyGranularity', () => {
  it('passes quarterly through and rolls yearly up', () => {
    const g = richGrid()
    const axis = periodsAsc(g)
    const q = applyGranularity('quarterly', axis, A_GT)
    expect(q.axis).toHaveLength(8)
    expect(q.yearly).toBeNull()
    const y = applyGranularity('yearly', axis, A_GT)
    expect(y.axis.map(a => a.label)).toEqual(['2023', '2024'])
    expect(y.yearly).not.toBeNull()
  })
})
