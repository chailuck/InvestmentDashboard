import type { BalanceCell, DashboardBalanceGridOut, DashboardCategoryRow } from '@/services/tracking'
import { defaultViewState } from '@/lib/tracking-analysis'
import type { ViewState } from '../types'

type Q = 1 | 2 | 3 | 4
const QUARTERS: Q[] = [1, 2, 3, 4]

/** ASCENDING value list → positionally-aligned (DESC years × Q1..4) BalanceCell[]. */
export function makeCells(yearsDesc: number[], ascValues: (number | null)[]): BalanceCell[] {
  const ascYears = [...yearsDesc].reverse()
  const ascPP = ascYears.flatMap(y => QUARTERS.map(q => ({ year: y, quarter: q })))
  let last: number | null = null
  const asc = ascPP.map((pp, i) => {
    const v = ascValues[i] ?? null
    if (v === null) return { ...pp, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false }
    const hadPrev = last !== null
    let dA: number | null = null
    let dP: number | null = null
    if (last !== null) { dA = v - last; dP = last === 0 ? null : (dA / last) * 100 }
    last = v
    return { ...pp, balance: v, deltaAmount: dA, deltaPercent: dP, hasData: true, hasPreviousData: hadPrev }
  })
  const out: BalanceCell[] = []
  for (const y of yearsDesc) for (const q of QUARTERS) out.push(asc.find(c => c.year === y && c.quarter === q) as BalanceCell)
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

/** Rich structural grid — years desc [2024, 2023]. Mirrors the lib test fixture. */
export function makeGrid(): DashboardBalanceGridOut {
  const yearsDesc = [2024, 2023]
  const cat1: DashboardCategoryRow = {
    id: 'c1', name: 'Assets', orderIndex: 0, subtotal: makeCells(yearsDesc, A_C1),
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
        items: [{ id: 'i3', name: 'House', type: 'Property', orderIndex: 0, exclusive: false, cells: makeCells(yearsDesc, A_HOUSE) }],
      },
    ],
  }
  const cat2: DashboardCategoryRow = {
    id: 'c2', name: 'Misc', orderIndex: 1, subtotal: makeCells(yearsDesc, A_C2),
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
      propertyTotal: makeCells(yearsDesc, sumAsc(A_HOUSE)),
      nonPropertyTotal: makeCells(yearsDesc, sumAsc(A_CHECK, A_SAVE, A_GOLD)),
    },
  }
}

export function makeViewState(partial: Partial<ViewState> = {}): ViewState {
  return { ...defaultViewState('set-1'), ...partial }
}
