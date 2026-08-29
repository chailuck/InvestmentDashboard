import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import TrackingDashboardPage, { utf8ToBase64 } from '../page'
import { trackingService } from '@/services/tracking'
import type {
  TrackingSet, DashboardBalanceGridOut, BalanceCell, TrackingSetExport,
} from '@/services/tracking'
import { sendExportEmail } from '@/services/emailExport'
import toast from 'react-hot-toast'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// This page has no router/params dependency (unlike updates/[listId]/page.tsx)
// — it only reads a `useState` selection plus the two React Query hooks
// below — so `next/navigation` does not need to be mocked here.

vi.mock('@/services/tracking', () => ({
  trackingService: {
    listSets: vi.fn(),
    getBalanceGrid: vi.fn(),
    getExport: vi.fn(),
  },
}))

vi.mock('@/services/emailExport', () => ({
  sendExportEmail: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mocked = vi.mocked(trackingService)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SETS: TrackingSet[] = [
  { id: 'set-1', name: 'Main Set', description: null, createdAt: '', updatedAt: '' },
]

/** A fully-populated "normal" cell — used everywhere we don't care about the specific values. */
const filled = (balance: number): BalanceCell => ({
  year: 0, quarter: 0, balance, deltaAmount: 10, deltaPercent: 1, hasData: true, hasPreviousData: true,
})

/** 8 filled cells (2 years x 4 quarters), ascending balances — used for subtotal/total rows. */
const filledRow = (base: number): BalanceCell[] =>
  Array.from({ length: 8 }, (_, i) => filled(base + i * 10))

// `Kbank` cells are positionally aligned to [2024 Q1..Q4, 2026 Q1..Q4]:
//  - index 0 (2024 Q1): hasData:false, hasPreviousData:true -> exercises the
//    "blank quarter, but delta still resolvable" case (both cells show "—").
//  - index 4 (2026 Q1): hasPreviousData:false -> exercises "No prior data".
const KBANK_CELLS: BalanceCell[] = [
  { year: 2024, quarter: 1, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: true },
  { year: 2024, quarter: 2, balance: 1000, deltaAmount: 100, deltaPercent: 11.11, hasData: true, hasPreviousData: true },
  { year: 2024, quarter: 3, balance: 1100, deltaAmount: 100, deltaPercent: 10, hasData: true, hasPreviousData: true },
  { year: 2024, quarter: 4, balance: 1200, deltaAmount: 100, deltaPercent: 9.09, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 1, balance: 1300, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
  { year: 2026, quarter: 2, balance: 1400, deltaAmount: 100, deltaPercent: 7.69, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 3, balance: 1500, deltaAmount: 100, deltaPercent: 7.14, hasData: true, hasPreviousData: true },
  { year: 2026, quarter: 4, balance: 1600, deltaAmount: 100, deltaPercent: 6.67, hasData: true, hasPreviousData: true },
]

// A large balance (>= 1,000,000) on SpecialFund's 2024 Q1 cell (index 0),
// specifically to exercise thousand-comma formatting on both the Balance and
// Delta columns.
const SPECIAL_FUND_CELLS: BalanceCell[] = [
  { year: 2024, quarter: 1, balance: 1234567.89, deltaAmount: 234567.89, deltaPercent: 23.45, hasData: true, hasPreviousData: true },
  ...filledRow(500).slice(1),
]

// Grid deliberately uses years in an order the backend would send (whatever
// that order is) that is NOT what a client-side sort would reconstruct —
// here, ascending and non-contiguous (skips 2025) — to prove the page
// renders `years` verbatim rather than re-sorting (e.g. into the descending
// order the type comment documents as the *typical* real-world shape).
//
// `Assets` carries a SECOND sub-category ("Savings", with its own single
// item) alongside "Bank" specifically so the Sub-category-view test below
// can prove one sub-category's chevron re-expands ONLY that sub-category's
// items, leaving a sibling sub-category independently collapsed.
const GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2024, quarters: [1, 2, 3, 4] },
    { year: 2026, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    {
      id: 'cat-1', name: 'Assets', orderIndex: 0,
      subtotal: filledRow(2000),
      subCategories: [
        {
          id: 'sub-1', name: 'Bank', orderIndex: 0,
          subtotal: filledRow(1500),
          items: [
            { id: 'item-1', name: 'Kbank', type: 'Bank account', orderIndex: 0, exclusive: false, cells: KBANK_CELLS },
            { id: 'item-2', name: 'SpecialFund', type: 'Investment Account', orderIndex: 1, exclusive: true, cells: SPECIAL_FUND_CELLS },
          ],
        },
        {
          id: 'sub-2', name: 'Savings', orderIndex: 1,
          subtotal: filledRow(700),
          items: [
            { id: 'item-3', name: 'SavingsAccount', type: 'Bank account', orderIndex: 0, exclusive: false, cells: filledRow(700) },
          ],
        },
      ],
    },
  ],
  grandTotal: filledRow(3000),
  propertyBreakdown: {
    propertyTotal: filledRow(800),
    nonPropertyTotal: filledRow(2200),
  },
}

// A dedicated fixture for the Category Trend chart's gap-handling test. Uses
// a REALISTIC descending `years` order (unlike `GRID` above, which
// deliberately uses a non-standard order to test the tables' own
// verbatim-rendering guarantee) so the chart's chronological reversal
// produces a genuinely oldest->newest x-axis: reversed, [2025, 2024]
// becomes [2024, 2025]. `cat-a`'s subtotal has `hasData:false` at 2025 Q2 —
// chronological index 5 of 8 (2024 Q1-4 = indices 0-3, 2025 Q1 = index 4,
// 2025 Q2 = index 5) — to prove the chart line breaks there instead of
// plotting a fabricated zero.
const CHART_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2025, quarters: [1, 2, 3, 4] },
    { year: 2024, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    {
      id: 'cat-a', name: 'Assets', orderIndex: 0,
      subtotal: [
        { year: 2025, quarter: 1, balance: 1000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2025, quarter: 2, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: true },
        { year: 2025, quarter: 3, balance: 1200, deltaAmount: 200, deltaPercent: 20, hasData: true, hasPreviousData: true },
        { year: 2025, quarter: 4, balance: 1300, deltaAmount: 100, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 1, balance: 900, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2024, quarter: 2, balance: 950, deltaAmount: 50, deltaPercent: 5.56, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 3, balance: 980, deltaAmount: 30, deltaPercent: 3.16, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 4, balance: 1000, deltaAmount: 20, deltaPercent: 2.04, hasData: true, hasPreviousData: true },
      ],
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2025, quarter: 1, balance: 1000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2025, quarter: 2, balance: 1100, deltaAmount: 100, deltaPercent: 10, hasData: true, hasPreviousData: true },
    { year: 2025, quarter: 3, balance: 1200, deltaAmount: 100, deltaPercent: 9.09, hasData: true, hasPreviousData: true },
    { year: 2025, quarter: 4, balance: 1300, deltaAmount: 100, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 1, balance: 900, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2024, quarter: 2, balance: 950, deltaAmount: 50, deltaPercent: 5.56, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 980, deltaAmount: 30, deltaPercent: 3.16, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: 1000, deltaAmount: 20, deltaPercent: 2.04, hasData: true, hasPreviousData: true },
  ],
  propertyBreakdown: {
    propertyTotal: filledRow(100),
    nonPropertyTotal: filledRow(200),
  },
}

/** An "unstarted" cell — no data, and (matching a set's earliest history) no previous data either. */
const noData = (year: number, quarter: number): BalanceCell => ({
  year, quarter, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false,
})

// A dedicated fixture for the chart's leading-gap-trimming behavior: 2022 has
// NO data at all (in the category subtotal OR grand total — trimming must
// check every series, not just one), 2023 is fully populated. The chart
// should start its x-axis at 2023 Q1, never plotting or labeling 2022 at
// all, even though `years[]` still reports all 4 quarters of 2022 (matching
// the real backend contract — a year with zero Update Lists in it is never
// actually returned, but a year where SOME quarters have data and others
// don't already exercises interior gaps via CHART_GRID above; this fixture
// is specifically for the "entirely-unstarted leading year" case).
const LEADING_GAP_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2023, quarters: [1, 2, 3, 4] },
    { year: 2022, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    {
      id: 'cat-a', name: 'Assets', orderIndex: 0,
      subtotal: [
        { year: 2023, quarter: 1, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2023, quarter: 2, balance: 550, deltaAmount: 50, deltaPercent: 10, hasData: true, hasPreviousData: true },
        { year: 2023, quarter: 3, balance: 600, deltaAmount: 50, deltaPercent: 9.09, hasData: true, hasPreviousData: true },
        { year: 2023, quarter: 4, balance: 650, deltaAmount: 50, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
        noData(2022, 1), noData(2022, 2), noData(2022, 3), noData(2022, 4),
      ],
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2023, quarter: 1, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2023, quarter: 2, balance: 550, deltaAmount: 50, deltaPercent: 10, hasData: true, hasPreviousData: true },
    { year: 2023, quarter: 3, balance: 600, deltaAmount: 50, deltaPercent: 9.09, hasData: true, hasPreviousData: true },
    { year: 2023, quarter: 4, balance: 650, deltaAmount: 50, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
    noData(2022, 1), noData(2022, 2), noData(2022, 3), noData(2022, 4),
  ],
  propertyBreakdown: {
    // 8 cells (2 years x 4 quarters) — matches every other cells/subtotal/
    // total array's length contract, same as `filledRow` elsewhere in this file.
    propertyTotal: filledRow(0),
    nonPropertyTotal: filledRow(0),
  },
}

// A dedicated fixture for the chart's TRAILING-gap-trimming behavior
// (requirement 4) — the mirror image of `LEADING_GAP_GRID` above: the
// LATEST year (2025, realistic descending order) has its two most recent
// quarters (Q3, Q4) blank in BOTH cat-a's subtotal AND Grand Total — the
// exact same "no data in ANY series" predicate the leading trim already
// uses, just searched from the end. Q1/Q2 of 2025 (and all of 2024) are
// fully populated, so the chart's x-axis must stop at 2025 Q2, never
// plotting or labeling 2025 Q3/Q4 even though `years[]` still reports all 4
// quarters of 2025 (matching the real backend contract).
const TRAILING_GAP_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2025, quarters: [1, 2, 3, 4] },
    { year: 2024, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    {
      id: 'cat-a', name: 'Assets', orderIndex: 0,
      subtotal: [
        { year: 2025, quarter: 1, balance: 1300, deltaAmount: 100, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
        { year: 2025, quarter: 2, balance: 1350, deltaAmount: 50, deltaPercent: 3.85, hasData: true, hasPreviousData: true },
        noData(2025, 3), noData(2025, 4),
        { year: 2024, quarter: 1, balance: 900, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2024, quarter: 2, balance: 950, deltaAmount: 50, deltaPercent: 5.56, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 3, balance: 980, deltaAmount: 30, deltaPercent: 3.16, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 4, balance: 1000, deltaAmount: 20, deltaPercent: 2.04, hasData: true, hasPreviousData: true },
      ],
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2025, quarter: 1, balance: 1300, deltaAmount: 100, deltaPercent: 8.33, hasData: true, hasPreviousData: true },
    { year: 2025, quarter: 2, balance: 1350, deltaAmount: 50, deltaPercent: 3.85, hasData: true, hasPreviousData: true },
    noData(2025, 3), noData(2025, 4),
    { year: 2024, quarter: 1, balance: 900, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2024, quarter: 2, balance: 950, deltaAmount: 50, deltaPercent: 5.56, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 980, deltaAmount: 30, deltaPercent: 3.16, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: 1000, deltaAmount: 20, deltaPercent: 2.04, hasData: true, hasPreviousData: true },
  ],
  propertyBreakdown: {
    propertyTotal: filledRow(0),
    nonPropertyTotal: filledRow(0),
  },
}

/** 4 filled cells (single year x 4 quarters) — the single-year equivalent of `filledRow` above. */
const filledRow1Year = (base: number): BalanceCell[] =>
  Array.from({ length: 4 }, (_, i) => filled(base + i * 10))

// ---------------------------------------------------------------------------
// Fixtures — RIGHT chart aggregate overlay lines (Gate 1 requirement 3)
// ---------------------------------------------------------------------------

// A dedicated single-year fixture with deliberately large, round Grand
// Total / Non-Property Total balances so the millions-format label
// ("X.XXM") reads as an obviously-correct, human-checkable value at the
// chart's most recent (Q4) point: Grand Total -> "12.34M", Non-Property
// Total -> "5.67M". `cat-a`'s own subtotal is unrelated small round numbers
// (only its presence/stacking matters for this fixture, not its value).
const OVERLAY_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [{ year: 2024, quarters: [1, 2, 3, 4] }],
  categories: [
    {
      id: 'cat-a', name: 'Assets', orderIndex: 0,
      subtotal: filledRow1Year(500_000),
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2024, quarter: 1, balance: 1_000_000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2024, quarter: 2, balance: 1_050_000, deltaAmount: 50_000, deltaPercent: 5, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 1_100_000, deltaAmount: 50_000, deltaPercent: 4.76, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: 12_340_000, deltaAmount: 11_240_000, deltaPercent: 1021.82, hasData: true, hasPreviousData: true },
  ],
  propertyBreakdown: {
    propertyTotal: filledRow1Year(0),
    nonPropertyTotal: [
      { year: 2024, quarter: 1, balance: 2_000_000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
      { year: 2024, quarter: 2, balance: 3_000_000, deltaAmount: 1_000_000, deltaPercent: 50, hasData: true, hasPreviousData: true },
      { year: 2024, quarter: 3, balance: 4_000_000, deltaAmount: 1_000_000, deltaPercent: 33.33, hasData: true, hasPreviousData: true },
      { year: 2024, quarter: 4, balance: 5_670_000, deltaAmount: 1_670_000, deltaPercent: 41.75, hasData: true, hasPreviousData: true },
    ],
  },
}

// ---------------------------------------------------------------------------
// Fixtures — Change 1 (stacked bar overlay on the Category Trend chart)
// ---------------------------------------------------------------------------

// Categories arrive in an order that DOES NOT match ascending `orderIndex`
// (high orderIndex first, low orderIndex second) — specifically to prove the
// stack/color/legend order is computed defensively (sorted), never just
// "whatever order the API array happens to be in" (even though the real
// backend currently already sends pre-sorted categories). `cat-high`'s Q4
// cell is `hasData:false` to also exercise "absent segment, never a
// zero-height bar" in the same fixture.
const STACK_ORDER_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [{ year: 2024, quarters: [1, 2, 3, 4] }],
  categories: [
    {
      id: 'cat-high', name: 'HighOrder', orderIndex: 5,
      subtotal: [
        { year: 2024, quarter: 1, balance: 300, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2024, quarter: 2, balance: 300, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 3, balance: 300, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: true },
      ],
      subCategories: [],
    },
    {
      id: 'cat-low', name: 'LowOrder', orderIndex: 1,
      subtotal: [
        { year: 2024, quarter: 1, balance: 100, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2024, quarter: 2, balance: 100, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 3, balance: 100, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 4, balance: 100, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
      ],
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2024, quarter: 1, balance: 400, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2024, quarter: 2, balance: 400, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 400, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: 100, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
  ],
  propertyBreakdown: {
    propertyTotal: filledRow1Year(0),
    nonPropertyTotal: filledRow1Year(0),
  },
}

// Two categories whose per-quarter SUM (500) clearly exceeds both any single
// category line's own max (200 / 300) AND the Grand Total line's own
// reported max (deliberately understated at 200, simulating a combined
// total that wasn't recorded as high as the true category sum) — the only
// way to prove the y-axis rescale reads the STACKED total rather than
// happening to already cover it via the Grand Total line itself.
const Y_RESCALE_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [{ year: 2024, quarters: [1, 2, 3, 4] }],
  categories: [
    { id: 'cat-a', name: 'CatA', orderIndex: 0, subtotal: filledConst(200), subCategories: [] },
    { id: 'cat-b', name: 'CatB', orderIndex: 1, subtotal: filledConst(300), subCategories: [] },
  ],
  grandTotal: filledConst(200),
  propertyBreakdown: {
    propertyTotal: filledRow1Year(0),
    nonPropertyTotal: filledRow1Year(0),
  },
}

/** 4 filled cells, all the SAME constant balance — used by Y_RESCALE_GRID above. */
function filledConst(value: number): BalanceCell[] {
  return Array.from({ length: 4 }, (_, i) => ({
    year: 2024, quarter: i + 1, balance: value, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: i > 0,
  }))
}

// Single category, single quarter (Q1) where the category ITSELF is
// `hasData:false` but Grand Total is `hasData:true` for that same quarter —
// the rare "all-categories-absent, total present" edge case. The documented
// choice: render no bar at all for that quarter rather than fabricate a
// segment.
const EDGE_ALL_ABSENT_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [{ year: 2024, quarters: [1, 2, 3, 4] }],
  categories: [
    {
      id: 'cat-a', name: 'CatA', orderIndex: 0,
      subtotal: [
        { year: 2024, quarter: 1, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: false },
        { year: 2024, quarter: 2, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
        { year: 2024, quarter: 3, balance: 500, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
        { year: 2024, quarter: 4, balance: 500, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
      ],
      subCategories: [],
    },
  ],
  grandTotal: [
    { year: 2024, quarter: 1, balance: 500, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
    { year: 2024, quarter: 2, balance: 500, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 3, balance: 500, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
    { year: 2024, quarter: 4, balance: 500, deltaAmount: 0, deltaPercent: 0, hasData: true, hasPreviousData: true },
  ],
  propertyBreakdown: {
    propertyTotal: filledRow1Year(0),
    nonPropertyTotal: filledRow1Year(0),
  },
}

// ---------------------------------------------------------------------------
// Fixtures — Change 2 (Non-Property Total target + progress)
// ---------------------------------------------------------------------------

// Realistic DESCENDING `years` order (2025 = most recent, matching the
// documented contract) where the most recent YEAR's most recent QUARTER
// (2025 Q4, index 3) is blank — the search must fall back to 2025 Q3
// (index 2) rather than either naively reading the flattened array's last
// entry (index 7 = 2024 Q4, an OLDER quarter) or its first entry.
const TARGET_GRID: DashboardBalanceGridOut = {
  trackingSetId: 'set-1',
  years: [
    { year: 2025, quarters: [1, 2, 3, 4] },
    { year: 2024, quarters: [1, 2, 3, 4] },
  ],
  categories: [
    { id: 'cat-a', name: 'CatA', orderIndex: 0, subtotal: filledRow(100), subCategories: [] },
  ],
  grandTotal: filledRow(100),
  propertyBreakdown: {
    propertyTotal: filledRow(0),
    nonPropertyTotal: [
      { year: 2025, quarter: 1, balance: 1_000_000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
      { year: 2025, quarter: 2, balance: 2_000_000, deltaAmount: 1_000_000, deltaPercent: 100, hasData: true, hasPreviousData: true },
      { year: 2025, quarter: 3, balance: 15_000_000, deltaAmount: 13_000_000, deltaPercent: 650, hasData: true, hasPreviousData: true },
      { year: 2025, quarter: 4, balance: null, deltaAmount: null, deltaPercent: null, hasData: false, hasPreviousData: true },
      { year: 2024, quarter: 1, balance: 500_000, deltaAmount: null, deltaPercent: null, hasData: true, hasPreviousData: false },
      { year: 2024, quarter: 2, balance: 600_000, deltaAmount: 100_000, deltaPercent: 20, hasData: true, hasPreviousData: true },
      { year: 2024, quarter: 3, balance: 700_000, deltaAmount: 100_000, deltaPercent: 16.67, hasData: true, hasPreviousData: true },
      { year: 2024, quarter: 4, balance: 800_000, deltaAmount: 100_000, deltaPercent: 14.29, hasData: true, hasPreviousData: true },
    ],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.listSets.mockResolvedValue(SETS)
  mocked.getBalanceGrid.mockResolvedValue(GRID)
})

/**
 * Finds the per-year `<table>`'s surrounding `.card` for a given year by
 * locating its year-table toggle button (works whether that year is
 * currently expanded or collapsed). This deliberately does NOT match the
 * Category Trend chart's own `.card` (which has no such toggle button), so
 * scoping assertions through this helper naturally excludes chart content
 * (e.g. the chart legend's category-name / "Grand Total" text) from
 * per-table text queries.
 */
function getYearCard(year: number): HTMLElement {
  const toggle = screen.getByRole('button', { name: new RegExp(`(Collapse|Expand) ${year} table$`) })
  return toggle.closest('.card') as HTMLElement
}

function getYearTable(year: number): HTMLElement {
  const table = getYearCard(year).querySelector('table')
  expect(table).not.toBeNull()
  return table as HTMLElement
}

/** Waits for the grid to finish loading — Grand Total now renders once per year table, so wait for at least one. */
async function waitForGrid() {
  await screen.findAllByText('Grand Total')
}

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — cell formatting', () => {
  it('renders "—" for both balance and delta on a blank quarter (hasData:false) whose delta is still resolvable', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // The blank cell (2024 Q1) only exists in the 2024 year table's slice of Kbank's row.
    const row = within(getYearTable(2024)).getByText('Kbank').closest('tr')!
    const tds = within(row).getAllByRole('cell')
    // tds[0] = name cell; tds[1]/tds[2] = balance/delta for the first (2024 Q1) column.
    expect(tds[1]).toHaveTextContent('—')
    expect(tds[2]).toHaveTextContent('—')
    expect(tds[2]).not.toHaveTextContent('No prior data')
  })

  it('renders "—" with a "No prior data" tooltip (not "0", not blank text) for a cell with hasPreviousData:false', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // The "No prior data" cell (2026 Q1) only exists in the 2026 year table's slice.
    // The visible text is a compact "—" (title attribute carries the explanation) —
    // shortening this from the old literal "No prior data" text is what let the
    // Delta column's shared width shrink enough for 4 quarters to fit without
    // a horizontal scrollbar.
    const cell = within(getYearTable(2026)).getByText('—', { selector: '[title="No prior data"]' })
    expect(cell).toBeInTheDocument()
    expect(screen.queryByText('+0.00')).not.toBeInTheDocument()
  })

  it('renders an exclusive item in its own row carrying an "Excl." badge (in every year table)', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const badges = screen.getAllByText('Excl.')
    expect(badges).toHaveLength(2) // one per year table
    badges.forEach(badge => {
      const row = badge.closest('tr')
      expect(row).not.toBeNull()
      expect(row!.textContent).toContain('SpecialFund')
    })
  })

  it('renders thousand-comma formatting on both Balance and Delta for a value >= 1,000,000', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // The large balance (2024 Q1) only exists in the 2024 year table's slice.
    const row = within(getYearTable(2024)).getByText('SpecialFund').closest('tr')!
    expect(within(row).getByText('1,234,567.89')).toBeInTheDocument()
    expect(within(row).getByText('+234,567.89')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Row hierarchy / styling
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category/SubCategory subtotal rows', () => {
  it('renders Category, SubCategory, and Item rows as three visually distinct tiers', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const categoryRow = within(table2024).getByText('Assets').closest('tr')!
    const subCategoryRow = within(table2024).getByText('Bank').closest('tr')!
    const itemRow = within(table2024).getByText('Kbank').closest('tr')!

    // Distinct background tint per tier.
    expect(categoryRow).toHaveClass('bg-surface-elevated/70')
    expect(subCategoryRow).toHaveClass('bg-surface-elevated/30')
    expect(itemRow).not.toHaveClass('bg-surface-elevated/70')
    expect(itemRow).not.toHaveClass('bg-surface-elevated/30')

    // Distinct left-accent border per tier (Category: brand-colored; SubCategory:
    // neutral border color; Item: transparent) — a second, independent visual
    // signal beyond opacity so the tiers don't rely on "same color, different
    // transparency" alone.
    const categoryNameCell = within(categoryRow).getAllByRole('cell')[0]
    const subCategoryNameCell = within(subCategoryRow).getAllByRole('cell')[0]
    const itemNameCell = within(itemRow).getAllByRole('cell')[0]
    expect(categoryNameCell).toHaveClass('border-l-brand-500')
    expect(subCategoryNameCell).toHaveClass('border-l-border')
    expect(itemNameCell).toHaveClass('border-l-transparent')

    // Category/SubCategory rows double as toggle buttons; the item row does not.
    expect(within(categoryRow).getByRole('button', { name: /Assets/ })).toBeInTheDocument()
    expect(within(subCategoryRow).getByRole('button', { name: /Bank/ })).toBeInTheDocument()
    expect(within(itemRow).queryByRole('button')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Grid border separators
// ---------------------------------------------------------------------------
//
// These assert against the exact border utility classes in page.tsx:
//  - Item-name column is separated from the quarter columns by `border-r-2
//    border-border` on both the header `<th>` and every name `<td>`
//    (Category/SubCategory/Item/Grand-Total-row-group).
//  - Each quarter's Balance+Delta pair is separated from the previous
//    quarter's pair by `border-l-2 border-border` on the Balance `<td>`/`<th>`
//    — applied to every quarter EXCEPT the first (`groupBorder={i > 0}` in
//    `GridCells`, `i > 0` in the header quarter loop). Since Grand Total now
//    lives inside each single-year table (requirement 3), this rule is
//    scoped entirely within one table — there is no cross-year boundary to
//    test for it any more.
//  - Category/SubCategory/Item rows carry progressively lighter row-boundary
//    borders: Category is `border-y-2 border-border` (heaviest, both edges),
//    SubCategory is `border-b border-border/60`, Item is `border-b
//    border-border/40` (lightest) — a second, border-weight signal on top of
//    the background-tint tiers already covered above.

describe('TrackingDashboardPage — grid border separators', () => {
  it('separates the Item-name header column from the quarter columns with border-r-2, and gives non-first quarter headers a border-l-2 group separator', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const headers = within(getYearTable(2024)).getAllByRole('columnheader')
    // [Item, Q1, Q1 Δ, Q2, Q2 Δ, Q3, Q3 Δ, Q4, Q4 Δ]
    expect(headers).toHaveLength(9)
    expect(headers[0]).toHaveTextContent('Item')
    expect(headers[0]).toHaveClass('border-r-2', 'border-border')

    // Q1 (first quarter) — no left group-separator.
    expect(headers[1]).toHaveTextContent('Q1')
    expect(headers[1]).not.toHaveClass('border-l-2')

    // Q2/Q3/Q4 (non-first quarters) — left group-separator present.
    expect(headers[3]).toHaveTextContent('Q2')
    expect(headers[3]).toHaveClass('border-l-2', 'border-border')
    expect(headers[5]).toHaveTextContent('Q3')
    expect(headers[5]).toHaveClass('border-l-2', 'border-border')
    expect(headers[7]).toHaveTextContent('Q4')
    expect(headers[7]).toHaveClass('border-l-2', 'border-border')

    // Δ headers never carry the group-separator border.
    expect(headers[2]).not.toHaveClass('border-l-2')
    expect(headers[4]).not.toHaveClass('border-l-2')
  })

  it('gives every Category/SubCategory/Item name cell a border-r-2 separator from the quarter columns', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const categoryNameCell = within(table2024).getByText('Assets').closest('tr')!.querySelector('td')!
    const subCategoryNameCell = within(table2024).getByText('Bank').closest('tr')!.querySelector('td')!
    const itemNameCell = within(table2024).getByText('Kbank').closest('td')!

    expect(categoryNameCell).toHaveClass('border-r-2', 'border-border')
    expect(subCategoryNameCell).toHaveClass('border-r-2', 'border-border')
    expect(itemNameCell).toHaveClass('border-r-2', 'border-border')
  })

  it('gives the first quarter\'s Balance cell no left border, and every subsequent quarter\'s Balance cell a border-l-2 group separator (Delta cells never get one)', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const itemRow = within(getYearTable(2024)).getByText('Kbank').closest('tr')!
    const cells = within(itemRow).getAllByRole('cell')
    // [name, Q1-bal, Q1-delta, Q2-bal, Q2-delta, Q3-bal, Q3-delta, Q4-bal, Q4-delta]
    expect(cells).toHaveLength(9)

    const [, q1Bal, q1Delta, q2Bal, q2Delta, q3Bal, q3Delta, q4Bal, q4Delta] = cells

    expect(q1Bal).not.toHaveClass('border-l-2')
    expect(q2Bal).toHaveClass('border-l-2', 'border-border')
    expect(q3Bal).toHaveClass('border-l-2', 'border-border')
    expect(q4Bal).toHaveClass('border-l-2', 'border-border')

    // Delta cells are never group-border carriers, regardless of position.
    expect(q1Delta).not.toHaveClass('border-l-2')
    expect(q2Delta).not.toHaveClass('border-l-2')
    expect(q3Delta).not.toHaveClass('border-l-2')
    expect(q4Delta).not.toHaveClass('border-l-2')
  })

  it('gives Category/SubCategory/Item rows progressively lighter row-separation borders (border-y-2 -> border-b/60 -> border-b/40)', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const categoryRow = within(table2024).getByText('Assets').closest('tr')!
    const subCategoryRow = within(table2024).getByText('Bank').closest('tr')!
    const itemRow = within(table2024).getByText('Kbank').closest('tr')!

    // Category: heaviest — both top and bottom, 2px.
    expect(categoryRow).toHaveClass('border-y-2', 'border-border')
    expect(categoryRow).not.toHaveClass('border-b-2')

    // SubCategory: bottom-only, 1px, muted border color.
    expect(subCategoryRow).toHaveClass('border-b', 'border-border/60')
    expect(subCategoryRow).not.toHaveClass('border-y-2')

    // Item: bottom-only, 1px, even more muted border color — lightest tier.
    expect(itemRow).toHaveClass('border-b', 'border-border/40')
    expect(itemRow).not.toHaveClass('border-y-2')
    expect(itemRow).not.toHaveClass('border-border/60')
  })

  it('gives the Grand Total row (now the first row of each single-year table) the same first-quarter/no-border rule, scoped within its own table', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const grandTotalRow2024 = within(getYearTable(2024)).getByText('Grand Total').closest('tr')!
    const cells = within(grandTotalRow2024).getAllByRole('cell')
    // [name, Q1-bal, Q1-delta, Q2-bal, Q2-delta, Q3-bal, Q3-delta, Q4-bal, Q4-delta] — only THIS table's 4 quarters.
    expect(cells).toHaveLength(9)
    expect(cells[0]).toHaveClass('border-r-2', 'border-border')
    expect(cells[1]).not.toHaveClass('border-l-2') // first column of THIS table — no separator
    expect(cells[3]).toHaveClass('border-l-2', 'border-border') // Q2
  })
})

// ---------------------------------------------------------------------------
// Grand Total rows — now per-year (requirement 3)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Grand Total rows (per-year table)', () => {
  it('renders Grand Total, Property Total, and Non-Property Total once per year table, as the very first rows before any Category', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const table2026 = getYearTable(2026)

    // Exactly one Grand Total row per table (not duplicated within it, not a
    // single global row shared across tables).
    expect(within(table2024).getAllByText('Grand Total')).toHaveLength(1)
    expect(within(table2026).getAllByText('Grand Total')).toHaveLength(1)
    expect(within(table2024).getByText('Property Total')).toBeInTheDocument()
    expect(within(table2024).getByText('Non-Property Total')).toBeInTheDocument()
    expect(within(table2026).getByText('Property Total')).toBeInTheDocument()
    expect(within(table2026).getByText('Non-Property Total')).toBeInTheDocument()

    // Grand Total precedes the "Assets" category row within its own table.
    const rows2024 = within(table2024).getAllByRole('row')
    const grandTotalRowIdx = rows2024.findIndex(r => within(r).queryByText('Grand Total'))
    const assetsRowIdx = rows2024.findIndex(r => within(r).queryByText('Assets'))
    expect(grandTotalRowIdx).toBeGreaterThan(-1)
    expect(assetsRowIdx).toBeGreaterThan(grandTotalRowIdx)
  })

  it('keeps its bold/brand-colored/bg-brand-500\\/10 styling and the subdued Property/Non-Property styling', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const grandTotalRow = within(table2024).getByText('Grand Total').closest('tr')!
    const grandTotalNameCell = within(grandTotalRow).getAllByRole('cell')[0]
    expect(grandTotalRow).toHaveClass('bg-brand-500/10')
    expect(grandTotalNameCell).toHaveClass('font-bold', 'text-brand-400')

    const propertyRow = within(table2024).getByText('Property Total').closest('tr')!
    expect(propertyRow).not.toHaveClass('bg-brand-500/10')
  })

  it('stays visible in a year table when every category/sub-category there is collapsed via Summary', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(screen.getByRole('button', { name: /Summary/i }))

    const table2024 = getYearTable(2024)
    const table2026 = getYearTable(2026)
    expect(within(table2024).getByText('Grand Total')).toBeInTheDocument()
    expect(within(table2024).getByText('Property Total')).toBeInTheDocument()
    expect(within(table2024).getByText('Non-Property Total')).toBeInTheDocument()
    expect(within(table2026).getByText('Grand Total')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Column-width consistency across year tables (requirement 1)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — shared Q1-Q4 column width', () => {
  it('applies an identical, non-empty inline width to every Balance cell (and separately every Delta cell) across every YearTable', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const table2026 = getYearTable(2026)

    // Grand Total row exists (unconditionally) in both tables — compare its
    // Balance/Delta cells' inline widths directly.
    const cells2024 = within(within(table2024).getByText('Grand Total').closest('tr')!).getAllByRole('cell')
    const cells2026 = within(within(table2026).getByText('Grand Total').closest('tr')!).getAllByRole('cell')
    expect(cells2024).toHaveLength(9)
    expect(cells2026).toHaveLength(9)

    // Cells alternate Balance/Delta starting at index 1 (index 0 is the name
    // cell): 1=Q1 Balance, 2=Q1 Delta, 3=Q2 Balance, 4=Q2 Delta, ...
    const balanceWidth = cells2024[1].style.width
    const deltaWidth = cells2024[2].style.width
    expect(balanceWidth).not.toBe('')
    expect(deltaWidth).not.toBe('')
    // Balance and Delta are deliberately sized INDEPENDENTLY (not forced to
    // match): Delta renders amount+percent on one line (e.g. "+10.00
    // (+1.00%)"), which is longer than this fixture's own Balance content
    // ("3,050.00" etc.) — Delta ending up WIDER than Balance here is expected
    // and fine (the user explicitly said Delta may be wider than Balance);
    // what matters is that they're computed independently rather than one
    // shared width forcing both to match.
    expect(balanceWidth).not.toBe(deltaWidth)

    for (let i = 1; i < cells2024.length; i++) {
      const expected = i % 2 === 1 ? balanceWidth : deltaWidth
      expect(cells2024[i].style.width).toBe(expected)
      expect(cells2026[i].style.width).toBe(expected)
    }
  })

  it('applies the same shared width to the header quarter cells across year tables too', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const headers2024 = within(getYearTable(2024)).getAllByRole('columnheader')
    const headers2026 = within(getYearTable(2026)).getAllByRole('columnheader')

    expect(headers2024[1].style.width).not.toBe('')
    expect(headers2024[1].style.width).toBe(headers2026[1].style.width)
    expect(headers2024[2].style.width).toBe(headers2026[2].style.width)
  })

  it('widens the shared column enough to fit the longest formatted value in the dataset (thousand-comma balance)', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // SpecialFund's 2024 Q1 balance ("1,234,567.89", 12 chars) is the longest
    // formatted value in the fixture — the shared width must be at least
    // that many `ch` (plus the component's own small padding).
    const width = within(getYearTable(2024)).getByText('Grand Total').closest('tr')!.querySelector('td:nth-child(2)') as HTMLElement
    const chValue = parseFloat(width.style.width)
    expect(chValue).toBeGreaterThanOrEqual('1,234,567.89'.length)
  })
})

// ---------------------------------------------------------------------------
// Year table order
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — year table order', () => {
  it('renders one table per year, in the exact order the fixture provides, without re-sorting', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const yearButtons = screen.getAllByRole('button', { name: /table$/i })
    expect(yearButtons.map(b => b.getAttribute('aria-label'))).toEqual([
      'Collapse 2024 table',
      'Collapse 2026 table',
    ])
  })
})

// ---------------------------------------------------------------------------
// Collapse behavior — Category
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category collapse', () => {
  it('hides SubCategory/Item rows within one year table when its Category is collapsed there, while its own subtotal row stays visible', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const beforeCellCount = within(within(table2024).getByText('Assets').closest('tr')!).getAllByRole('cell').length

    await user.click(within(table2024).getByRole('button', { name: 'Collapse Assets' }))

    expect(within(table2024).queryByText('Bank')).not.toBeInTheDocument()
    expect(within(table2024).queryByText('Kbank')).not.toBeInTheDocument()

    const categoryRow = within(table2024).getByText('Assets').closest('tr')!
    expect(categoryRow).toBeInTheDocument()
    expect(within(categoryRow).getAllByRole('cell')).toHaveLength(beforeCellCount)

    // Toggling again re-expands.
    await user.click(within(table2024).getByRole('button', { name: 'Expand Assets' }))
    expect(within(table2024).getByText('Kbank')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Collapse behavior — Year (whole table replaced by a header bar)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Year table collapse', () => {
  it('replaces a year\'s whole table with a collapsed header bar, without affecting the other year\'s table', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // Both year tables present up front.
    expect(getYearTable(2024)).toBeInTheDocument()
    expect(getYearTable(2026)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse 2024 table' }))

    // 2024's table is gone; only its collapsed header bar remains.
    expect(screen.queryByRole('button', { name: 'Collapse 2024 table' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand 2024 table' })).toBeInTheDocument()
    expect(getYearCard(2024).querySelector('table')).toBeNull()

    // 2026's table is completely unaffected.
    expect(getYearTable(2026)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse 2026 table' })).toBeInTheDocument()

    // Re-expanding 2024 restores its table.
    await user.click(screen.getByRole('button', { name: 'Expand 2024 table' }))
    expect(screen.getByRole('button', { name: 'Collapse 2024 table' })).toBeInTheDocument()
    expect(getYearTable(2024)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Global Detail / Sub-category / Summary toggle
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — global Detail/Sub-category/Summary toggle', () => {
  it('collapses every Category and SubCategory on "Summary", and re-expands all on "Detail"', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(screen.getByRole('button', { name: /Summary/i }))

    expect(screen.queryByText('Bank')).not.toBeInTheDocument()
    expect(screen.queryByText('Kbank')).not.toBeInTheDocument()
    // The Category rollup itself must remain — once per year table. Scoped
    // per-table (rather than a global `getAllByText`) because the Category
    // Trend chart's own legend also renders the category name once, which
    // would otherwise inflate this count.
    expect(within(getYearTable(2024)).getByText('Assets')).toBeInTheDocument()
    expect(within(getYearTable(2026)).getByText('Assets')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Detail/i }))

    expect(screen.getAllByText('Bank')).toHaveLength(2)
    expect(screen.getAllByText('Kbank')).toHaveLength(2)
  })

  it('affects every year table simultaneously, since collapse state is shared (not scoped per-table)', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024Before = getYearTable(2024)
    const table2026Before = getYearTable(2026)
    // Before "Summary": each year table renders its own SubCategory + Item rows.
    expect(within(table2024Before).getAllByText('Bank')).toHaveLength(1)
    expect(within(table2026Before).getAllByText('Bank')).toHaveLength(1)
    expect(within(table2024Before).getAllByText('Kbank')).toHaveLength(1)
    expect(within(table2026Before).getAllByText('Kbank')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /Summary/i }))

    // After "Summary": BOTH year tables collapse their SubCategory/Item rows,
    // not just one — proving collapsedCategories/collapsedSubCategories is a
    // single shared Set across all per-year tables.
    const table2024After = getYearTable(2024)
    const table2026After = getYearTable(2026)
    expect(within(table2024After).queryByText('Bank')).not.toBeInTheDocument()
    expect(within(table2026After).queryByText('Bank')).not.toBeInTheDocument()
    expect(within(table2024After).queryByText('Kbank')).not.toBeInTheDocument()
    expect(within(table2026After).queryByText('Kbank')).not.toBeInTheDocument()
    // Category rollup remains in both.
    expect(within(table2024After).getByText('Assets')).toBeInTheDocument()
    expect(within(table2026After).getByText('Assets')).toBeInTheDocument()
  })

  it('shows Category and SubCategory subtotal rows but hides Item rows in "Sub-category" view', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(screen.getByRole('button', { name: /Sub-category/i }))

    // Category + both SubCategory rollups remain, once per year table.
    expect(screen.getAllByText('Bank')).toHaveLength(2)
    expect(screen.getAllByText('Savings')).toHaveLength(2)
    expect(within(getYearTable(2024)).getByText('Assets')).toBeInTheDocument()

    // Every Item row is hidden.
    expect(screen.queryByText('Kbank')).not.toBeInTheDocument()
    expect(screen.queryByText('SpecialFund')).not.toBeInTheDocument()
    expect(screen.queryByText('SavingsAccount')).not.toBeInTheDocument()
  })

  it('lets a user independently re-expand just one sub-category\'s items after "Sub-category" view collapses all of them', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(screen.getByRole('button', { name: /Sub-category/i }))
    expect(screen.queryByText('Kbank')).not.toBeInTheDocument()
    expect(screen.queryByText('SavingsAccount')).not.toBeInTheDocument()

    // Re-expand only "Bank" via its own chevron (shared state, so this
    // affects both year tables at once — exactly like the existing
    // Detail/Summary per-row chevrons already do).
    const table2024 = getYearTable(2024)
    await user.click(within(table2024).getByRole('button', { name: 'Expand Bank' }))

    expect(screen.getAllByText('Kbank')).toHaveLength(2)
    expect(screen.getAllByText('SpecialFund')).toHaveLength(2)
    // "Savings" remains independently collapsed — its item is still hidden.
    expect(screen.queryByText('SavingsAccount')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Category Trend chart (requirement 4)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category Trend chart', () => {
  it('renders once, with one line per category plus a Grand Total line, and matching legend entries', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const chart = screen.getByRole('img', { name: 'Category trend lines chart' })
    expect(chart).toBeInTheDocument()

    const legend = screen.getByRole('list', { name: 'Category trend chart legend' })
    const items = within(legend).getAllByRole('listitem')
    // 1 category ("Assets") + Grand Total.
    expect(items).toHaveLength(2)
    expect(within(legend).getByText('Assets')).toBeInTheDocument()
    expect(within(legend).getByText('Grand Total')).toBeInTheDocument()

    expect(chart.querySelector('[data-testid="chart-line-cat-1"]')).toBeInTheDocument()
    expect(chart.querySelector('[data-testid="chart-line-__grand-total__"]')).toBeInTheDocument()
  })

  it('renders exactly once regardless of Detail/Sub-category/Summary/year-collapse toggles', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    expect(screen.getAllByRole('img', { name: 'Category trend lines chart' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /Summary/i }))
    await user.click(screen.getByRole('button', { name: 'Collapse 2024 table' }))

    expect(screen.getAllByRole('img', { name: 'Category trend lines chart' })).toHaveLength(1)
    // Legend is unaffected by any of the above toggles.
    expect(within(screen.getByRole('list', { name: 'Category trend chart legend' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders a blank-data quarter (hasData:false) as a gap in the line, never as a fabricated zero point', async () => {
    mocked.getBalanceGrid.mockResolvedValue(CHART_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const path = document.querySelector('[data-testid="chart-line-cat-a"]') as SVGPathElement
    expect(path).toBeInTheDocument()
    const d = path.getAttribute('d') ?? ''

    // 8 chronological quarters (2024 Q1-4, 2025 Q1-4) with ONE gap at 2025 Q2
    // (chronological index 5) — the path must break there: two separate
    // "M...L..." subpaths (one covering indices 0-4, one covering 6-7)
    // rather than a single continuous polyline, and exactly 7 plotted points
    // total (8 quarters minus the 1 gap that is never plotted at all, let
    // alone plotted as 0).
    const moveCount = (d.match(/M/g) ?? []).length
    const pointCount = (d.match(/[ML]/g) ?? []).length
    expect(moveCount).toBe(2)
    expect(pointCount).toBe(7)

    // The Grand Total line has no gaps in this fixture — a single continuous subpath.
    const grandTotalPath = document.querySelector('[data-testid="chart-line-__grand-total__"]') as SVGPathElement
    const grandTotalD = grandTotalPath.getAttribute('d') ?? ''
    expect((grandTotalD.match(/M/g) ?? []).length).toBe(1)
    expect((grandTotalD.match(/[ML]/g) ?? []).length).toBe(8)
  })

  it('trims leading quarters with no data in ANY series, starting the x-axis at the first quarter that actually has data', async () => {
    mocked.getBalanceGrid.mockResolvedValue(LEADING_GAP_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const chart = screen.getByRole('img', { name: 'Category trend lines chart' })

    // 2022 (entirely unstarted, both cat-a and Grand Total hasData:false for
    // all 4 quarters) must not be labeled on the x-axis at all.
    expect(within(chart).queryByText(/2022/)).not.toBeInTheDocument()
    // 2023 Q1 — the first quarter with real data — must be the first label.
    expect(within(chart).getByText('Q1 2023')).toBeInTheDocument()

    // The underlying line must also only plot the 4 real 2023 points, not 8
    // (i.e. this is a genuine data trim, not just a label/tick display trim).
    const catPath = document.querySelector('[data-testid="chart-line-cat-a"]') as SVGPathElement
    const catD = catPath.getAttribute('d') ?? ''
    expect((catD.match(/M/g) ?? []).length).toBe(1)
    expect((catD.match(/[ML]/g) ?? []).length).toBe(4)

    const grandTotalPath = document.querySelector('[data-testid="chart-line-__grand-total__"]') as SVGPathElement
    const grandTotalD = grandTotalPath.getAttribute('d') ?? ''
    expect((grandTotalD.match(/[ML]/g) ?? []).length).toBe(4)

    // The stacked bar layer reads from the SAME (already-trimmed) `quarters`
    // array as the lines — exactly 4 bar-columns (2023 Q1-4), never 8, i.e.
    // this is a genuine trim of the bar layer too, not just the lines.
    expect(document.querySelectorAll('[data-testid^="chart-bar-column-"]')).toHaveLength(4)
    expect(document.querySelector('[data-testid="chart-bar-column-4"]')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Stacked bar overlay (Change 1)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category Trend chart stacked bars (Change 1)', () => {
  it('stacks bar segments, assigns colors, and orders the legend by ascending orderIndex — NEVER the API array order', async () => {
    mocked.getBalanceGrid.mockResolvedValue(STACK_ORDER_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // Fixture provides categories as [cat-high (orderIndex 5), cat-low
    // (orderIndex 1)] — the defensive sort must reorder to [cat-low, cat-high].
    const legend = screen.getByRole('list', { name: 'Category trend chart legend' })
    const legendLabels = within(legend).getAllByRole('listitem').map(li => li.textContent)
    expect(legendLabels).toEqual(['LowOrder', 'HighOrder', 'Grand Total'])

    // Color assignment follows the same sorted order: slot 1 (blue) goes to
    // the lowest orderIndex, slot 2 (orange) to the next — not array order.
    const lowLine = document.querySelector('[data-testid="chart-line-cat-low"]') as SVGPathElement
    const highLine = document.querySelector('[data-testid="chart-line-cat-high"]') as SVGPathElement
    expect(lowLine.getAttribute('stroke')).toBe('#3987e5')
    expect(highLine.getAttribute('stroke')).toBe('#d95926')

    // Q1 (bar-column 0): both categories present. cat-low (orderIndex 1)
    // must form the BOTTOM segment (larger/lower pixel-y, closer to the
    // baseline) and cat-high (orderIndex 5) the TOP segment (smaller
    // pixel-y) — this is the assertion that would FAIL if the stack were
    // left in array-arrival order or reversed.
    const lowSeg = document.querySelector('[data-testid="chart-bar-segment-0-cat-low"]') as SVGRectElement
    const highSeg = document.querySelector('[data-testid="chart-bar-segment-0-cat-high"]') as SVGRectElement
    expect(lowSeg).toBeInTheDocument()
    expect(highSeg).toBeInTheDocument()
    expect(Number(highSeg.getAttribute('y'))).toBeLessThan(Number(lowSeg.getAttribute('y')))
  })

  it('renders a hasData:false category segment as completely ABSENT for that quarter — never a zero-height or bordered placeholder', async () => {
    mocked.getBalanceGrid.mockResolvedValue(STACK_ORDER_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // Q4 (bar-column 3): cat-high is hasData:false there — no rect at all.
    expect(document.querySelector('[data-testid="chart-bar-segment-3-cat-high"]')).not.toBeInTheDocument()
    // cat-low IS present that quarter and must still render normally.
    expect(document.querySelector('[data-testid="chart-bar-segment-3-cat-low"]')).toBeInTheDocument()
  })

  it('renders no bar at all for a quarter where every category is hasData:false, even if Grand Total has data (documented minimal edge-case treatment)', async () => {
    mocked.getBalanceGrid.mockResolvedValue(EDGE_ALL_ABSENT_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // Q1 (bar-column 0): the only category is hasData:false, Grand Total is
    // hasData:true — no segment is fabricated for the (non-existent)
    // category data.
    const column0 = document.querySelector('[data-testid="chart-bar-column-0"]') as SVGGElement
    expect(column0).toBeInTheDocument()
    expect(column0.querySelectorAll('rect')).toHaveLength(0)

    // Q2 (bar-column 1): normal quarter — the category's own segment renders.
    expect(document.querySelector('[data-testid="chart-bar-segment-1-cat-a"]')).toBeInTheDocument()
  })

  it('rescales the y-axis to fit the tallest STACKED bar total, not just the max of any single line (category or Grand Total)', async () => {
    mocked.getBalanceGrid.mockResolvedValue(Y_RESCALE_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // cat-a maxes at 200, cat-b at 300, Grand Total's own (understated) line
    // maxes at 200 — every individual line's max is well under the true
    // stacked total of 500. If the y-domain were still sized off
    // `allValues` alone (the pre-fix behavior), this stacked segment would
    // be plotted ABOVE the chart's padding-top boundary (y < 20, clipped).
    const topSegment = document.querySelector('[data-testid="chart-bar-segment-0-cat-b"]') as SVGRectElement
    expect(topSegment).toBeInTheDocument()
    // TREND_CHART_PAD.top is 20 in page.tsx — the plot area's top boundary.
    expect(Number(topSegment.getAttribute('y'))).toBeGreaterThanOrEqual(20)
  })
})

// ---------------------------------------------------------------------------
// Non-Property Total target + progress (Change 2)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Non-Property Total highlight + target progress (Change 2)', () => {
  it('gives the Non-Property Total row a distinct highlight, different from Grand Total and Property Total', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const grandTotalRow = within(table2024).getByText('Grand Total').closest('tr')!
    const propertyRow = within(table2024).getByText('Property Total').closest('tr')!
    const nonPropertyRow = within(table2024).getByText('Non-Property Total').closest('tr')!

    expect(nonPropertyRow).toHaveClass('bg-info/10')
    expect(nonPropertyRow).not.toHaveClass('bg-brand-500/10')
    expect(grandTotalRow).not.toHaveClass('bg-info/10')
    expect(propertyRow).not.toHaveClass('bg-info/10')
  })

  it('defaults the target to 20,000,000 when localStorage has no stored value', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // GRID has two year tables (2024, 2026), both driven by the same shared
    // target/progress state — scope to one to avoid an ambiguous multi-match.
    expect(
      within(getYearTable(2024)).getByRole('button', { name: /Edit Non-Property Total target, currently 20,000,000\.00/ }),
    ).toBeInTheDocument()
  })

  it('lets the user edit the target and persists it to localStorage keyed by tracking set id', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(within(getYearTable(2024)).getByRole('button', { name: /Edit Non-Property Total target/ }))
    const input = screen.getByLabelText('Non-Property Total target amount')
    await user.clear(input)
    await user.type(input, '5000000')
    await user.tab() // blur -> commit

    // The shared page-level target state updates both year tables at once.
    expect(screen.getAllByRole('button', { name: /Edit Non-Property Total target, currently 5,000,000\.00/ })).toHaveLength(2)
    expect(localStorage.getItem('tracking-dashboard-target-set-1')).toBe('5000000')
  })

  it('rejects invalid target input (negative/non-numeric) and reverts to the previous value without saving', async () => {
    const user = userEvent.setup()
    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(within(getYearTable(2024)).getByRole('button', { name: /Edit Non-Property Total target/ }))
    const input = screen.getByLabelText('Non-Property Total target amount')
    await user.clear(input)
    await user.type(input, '-5')
    await user.tab()

    // Reverted to the default (20,000,000), not saved as -5.
    expect(
      within(getYearTable(2024)).getByRole('button', { name: /Edit Non-Property Total target, currently 20,000,000\.00/ }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('tracking-dashboard-target-set-1')).toBeNull()
  })

  it('selects the most recent quarter WITH DATA across the whole dataset, not simply the last array entry', async () => {
    mocked.getBalanceGrid.mockResolvedValue(TARGET_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // 2025 Q4 (the literal last-in-time quarter) is hasData:false; 2024 Q4
    // (the literal last array entry) is an OLDER quarter. The real answer,
    // found by searching backward from 2025 Q4, is 2025 Q3 = 15,000,000.
    expect(screen.getAllByText('15,000,000.00 / 20,000,000.00').length).toBeGreaterThan(0)
  })

  it('shows a neutral (non-gain, non-loss) treatment when current is below target', async () => {
    mocked.getBalanceGrid.mockResolvedValue(TARGET_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const amounts = screen.getAllByText('15,000,000.00 / 20,000,000.00')
    amounts.forEach(el => {
      expect(el).not.toHaveClass('text-gain')
      expect(el).not.toHaveClass('text-loss')
    })
  })

  it('switches to the existing text-gain convention when current meets or exceeds target', async () => {
    localStorage.setItem('tracking-dashboard-target-set-1', '15000000') // exactly equal to current -> "at target"
    mocked.getBalanceGrid.mockResolvedValue(TARGET_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const amounts = screen.getAllByText('15,000,000.00 / 15,000,000.00')
    expect(amounts.length).toBeGreaterThan(0)
    amounts.forEach(el => expect(el).toHaveClass('text-gain'))
  })

  it('switches to text-gain when current clearly exceeds target', async () => {
    localStorage.setItem('tracking-dashboard-target-set-1', '10000000') // below current (15,000,000) -> "above target"
    mocked.getBalanceGrid.mockResolvedValue(TARGET_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const amounts = screen.getAllByText('15,000,000.00 / 10,000,000.00')
    expect(amounts.length).toBeGreaterThan(0)
    amounts.forEach(el => expect(el).toHaveClass('text-gain'))
  })

  it('renders the same target/progress value once per year table (one shared indicator, not per-year)', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const progressBars = screen.getAllByRole('progressbar', { name: 'Progress toward Non-Property Total target' })
    // One year table per fixture year (GRID has 2024 + 2026).
    expect(progressBars).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Non-Property Total row bolding (Gate 1 requirement 1)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Non-Property Total row bolding (Gate 1 requirement 1)', () => {
  it('renders Non-Property Total\'s Balance/Delta values with font-semibold text-ink-primary, matching Category/SubCategory tiers', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const table2024 = getYearTable(2024)
    const nonPropertyRow = within(table2024).getByText('Non-Property Total').closest('tr')!
    // First quarter's Balance cell's inner value span — mirrors how Category/
    // SubCategory subtotal rows already render `strong` (font-semibold
    // text-ink-primary) rather than the plain `text-ink-secondary` a
    // non-`strong` row (e.g. Property Total) gets.
    const balanceCell = within(nonPropertyRow).getAllByRole('cell')[1]
    const valueSpan = balanceCell.querySelector('span')!
    expect(valueSpan).toHaveClass('font-semibold', 'text-ink-primary')
    expect(valueSpan).not.toHaveClass('text-ink-secondary')

    // Property Total (NOT bolded) stays on the plain `text-ink-secondary`
    // treatment, for contrast — proves this is a targeted change to
    // Non-Property Total only, not an accidental blanket change.
    const propertyRow = within(table2024).getByText('Property Total').closest('tr')!
    const propertyValueSpan = within(propertyRow).getAllByRole('cell')[1].querySelector('span')!
    expect(propertyValueSpan).toHaveClass('text-ink-secondary')
    expect(propertyValueSpan).not.toHaveClass('font-semibold')
  })
})

// ---------------------------------------------------------------------------
// Two-chart side-by-side split layout (Gate 1 requirement 2)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — two-chart split layout (Gate 1 requirement 2)', () => {
  it('renders the Category Trend lines chart and the Category Stacked Bar chart side by side, inside one responsive grid wrapper', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const linesChart = screen.getByRole('img', { name: 'Category trend lines chart' })
    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    expect(linesChart).toBeInTheDocument()
    expect(barChart).toBeInTheDocument()

    // Both charts' own `.card` containers share one immediate grid wrapper
    // (the `grid grid-cols-1 lg:grid-cols-2 gap-4` pattern already used by
    // action-plan/purchase/[id]/page.tsx and weekly-scan/[id]/dashboard/page.tsx).
    const linesCard = linesChart.closest('.card') as HTMLElement
    const barCard = barChart.closest('.card') as HTMLElement
    const wrapper = linesCard.parentElement!
    expect(wrapper).toHaveClass('grid', 'grid-cols-1', 'lg:grid-cols-2', 'gap-4')
    expect(wrapper).toContainElement(barCard)
  })

  it('keeps the LEFT chart\'s lines-only content and the RIGHT chart\'s bars-only content fully separated', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const linesChart = screen.getByRole('img', { name: 'Category trend lines chart' })
    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })

    // Category/Grand-Total LINES live only on the LEFT chart.
    expect(linesChart.querySelector('[data-testid="chart-line-cat-1"]')).toBeInTheDocument()
    expect(linesChart.querySelector('[data-testid="chart-line-__grand-total__"]')).toBeInTheDocument()
    expect(barChart.querySelector('[data-testid="chart-line-cat-1"]')).not.toBeInTheDocument()
    expect(barChart.querySelector('[data-testid="chart-line-__grand-total__"]')).not.toBeInTheDocument()

    // Stacked BARS live only on the RIGHT chart.
    expect(barChart.querySelectorAll('[data-testid^="chart-bar-column-"]').length).toBeGreaterThan(0)
    expect(linesChart.querySelectorAll('[data-testid^="chart-bar-column-"]').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RIGHT chart aggregate overlay lines (Gate 1 requirement 3)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Category Stacked Bar chart aggregate overlay lines (Gate 1 requirement 3)', () => {
  it('renders both the Non-Property Total and Grand Total overlay lines on the RIGHT chart only, with distinct colors from each other and from every category color', async () => {
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    const nonPropertyLine = within(barChart).getByTestId('chart-line-non-property-total') as unknown as SVGPathElement
    const grandTotalLine = within(barChart).getByTestId('chart-line-grand-total-overlay') as unknown as SVGPathElement
    expect(nonPropertyLine).toBeInTheDocument()
    expect(grandTotalLine).toBeInTheDocument()

    const nonPropertyColor = nonPropertyLine.getAttribute('stroke')
    const grandTotalColor = grandTotalLine.getAttribute('stroke')
    // Distinct from each other.
    expect(nonPropertyColor).not.toBe(grandTotalColor)
    // Distinct from the (single) category's own bar-segment color, and from
    // every CATEGORY_LINE_COLORS slot the app uses for categorical series.
    const categoryColors = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
    expect(categoryColors).not.toContain(nonPropertyColor)
    expect(categoryColors).not.toContain(grandTotalColor)
  })

  it('computes the Non-Property Total overlay line from propertyBreakdown.nonPropertyTotal directly, not from bar segment geometry', async () => {
    mocked.getBalanceGrid.mockResolvedValue(OVERLAY_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    const nonPropertyPath = within(barChart).getByTestId('chart-line-non-property-total')
    const grandTotalPath = within(barChart).getByTestId('chart-line-grand-total-overlay')
    // Single fully-populated year (4 quarters, no gaps) -> one continuous
    // subpath with all 4 points plotted for both overlay lines.
    expect(((nonPropertyPath.getAttribute('d') ?? '').match(/[ML]/g) ?? []).length).toBe(4)
    expect(((grandTotalPath.getAttribute('d') ?? '').match(/[ML]/g) ?? []).length).toBe(4)
  })

  it('shows the millions-format value ("X.XXM") for both overlay lines\' most recent point, visible without hovering', async () => {
    mocked.getBalanceGrid.mockResolvedValue(OVERLAY_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    // Q4 2024 (the most recent/only year's last quarter): Grand Total =
    // 12,340,000 -> "12.34M"; Non-Property Total = 5,670,000 -> "5.67M".
    expect(within(barChart).getByTestId('chart-label-grand-total')).toHaveTextContent('12.34M')
    expect(within(barChart).getByTestId('chart-label-non-property-total')).toHaveTextContent('5.67M')

    // The legend also carries the same millions-format value alongside each
    // aggregate line's label (implementer's choice to show it in both places).
    const legend = screen.getByRole('list', { name: 'Category stacked bar chart legend' })
    expect(within(legend).getByText(/Grand Total.*12\.34M/)).toBeInTheDocument()
    expect(within(legend).getByText(/Non-Property Total.*5\.67M/)).toBeInTheDocument()
  })

  it('keeps the hover tooltip on the RIGHT chart in the existing thousand-comma fmtBalance format, never millions, for the two overlay lines', async () => {
    mocked.getBalanceGrid.mockResolvedValue(OVERLAY_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    // No thousand-comma-formatted tooltip text exists before any hover —
    // only the always-visible millions-format labels ("12.34M"/"5.67M") and
    // the "K"/"M"-abbreviated axis ticks are present pre-hover.
    expect(within(barChart).queryByText(/^-?[\d,]+\.\d{2}$/)).not.toBeInTheDocument()

    const svg = barChart.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: 400, clientY: 100 })

    // Hovering reveals tooltip row(s) using the existing thousand-comma
    // `fmtBalance` format — never the millions format reserved for the
    // always-visible data-point labels above.
    const tooltipValues = within(barChart).getAllByText(/^-?[\d,]+\.\d{2}$/)
    expect(tooltipValues.length).toBeGreaterThan(0)
    // The always-visible millions-format labels remain in the DOM alongside
    // the tooltip — the tooltip is additive, not a replacement.
    expect(within(barChart).getByTestId('chart-label-grand-total')).toHaveTextContent('12.34M')
    expect(within(barChart).getByTestId('chart-label-non-property-total')).toHaveTextContent('5.67M')
  })

  it('fits the RIGHT chart y-domain to the stacked bar total, Grand Total line, AND Non-Property Total line', async () => {
    mocked.getBalanceGrid.mockResolvedValue(OVERLAY_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    // Grand Total's Q4 value (12,340,000) is the tallest of the three
    // domain-feeding arrays (stacked bar total ~2,000,000, Non-Property
    // Total max 5,670,000) — if the y-domain only considered the stacked bar
    // total or ignored the Non-Property Total line, either aggregate line's
    // highest point could clip above the plot area's top boundary.
    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })
    const grandTotalPath = within(barChart).getByTestId('chart-line-grand-total-overlay')
    const nonPropertyPath = within(barChart).getByTestId('chart-line-non-property-total')
    // A crude but effective clip check: every plotted coordinate in both
    // paths' `d` strings must be a finite, non-negative pixel Y within the
    // chart's fixed height (260, see TREND_CHART_H) — a clipped/NaN point
    // would fall outside that range.
    for (const d of [grandTotalPath.getAttribute('d'), nonPropertyPath.getAttribute('d')]) {
      const coords = (d ?? '').match(/[ML]([\d.]+),([\d.]+)/g) ?? []
      expect(coords.length).toBeGreaterThan(0)
      coords.forEach(pair => {
        const y = Number(pair.split(',')[1])
        expect(Number.isFinite(y)).toBe(true)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(260)
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Trailing trim (Gate 1 requirement 4)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — chart trailing quarter trim (Gate 1 requirement 4)', () => {
  it('trims trailing quarters with no data in ANY series, ending the x-axis at the last quarter that actually has data, on BOTH charts', async () => {
    mocked.getBalanceGrid.mockResolvedValue(TRAILING_GAP_GRID)
    render(<TrackingDashboardPage />)
    await waitForGrid()

    const linesChart = screen.getByRole('img', { name: 'Category trend lines chart' })
    const barChart = screen.getByRole('img', { name: 'Category stacked bar chart' })

    // 2025 Q3/Q4 (both cat-a and Grand Total hasData:false there) must not
    // be labeled on either chart's x-axis.
    expect(within(linesChart).queryByText('Q3 2025')).not.toBeInTheDocument()
    expect(within(linesChart).queryByText('Q4 2025')).not.toBeInTheDocument()
    expect(within(barChart).queryByText('Q3 2025')).not.toBeInTheDocument()
    expect(within(barChart).queryByText('Q4 2025')).not.toBeInTheDocument()
    // 2025 Q2 — the last quarter with real data — remains the final label.
    expect(within(linesChart).getByText('Q2 2025')).toBeInTheDocument()

    // Genuine DATA trim (not just a label trim): 8 chronological quarters
    // (2024 Q1-4, 2025 Q1-2 with data + 2025 Q3-4 blank) trimmed down to 6
    // plotted points, one continuous subpath (no interior gaps in what's left).
    const catPath = within(linesChart).getByTestId('chart-line-cat-a')
    const catD = catPath.getAttribute('d') ?? ''
    expect((catD.match(/M/g) ?? []).length).toBe(1)
    expect((catD.match(/[ML]/g) ?? []).length).toBe(6)

    const grandTotalPath = within(linesChart).getByTestId('chart-line-__grand-total__')
    expect(((grandTotalPath.getAttribute('d') ?? '').match(/[ML]/g) ?? []).length).toBe(6)

    // The RIGHT chart's bar layer reads from the SAME (already-trimmed)
    // shared `quarters` array — exactly 6 bar-columns, never 8.
    expect(within(barChart).getAllByTestId(/^chart-bar-column-/)).toHaveLength(6)
    expect(within(barChart).queryByTestId('chart-bar-column-6')).not.toBeInTheDocument()
    expect(within(barChart).queryByTestId('chart-bar-column-7')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Email Dashboard button — orchestration (build HTML from loaded state ->
// fetch a full backup export -> POST both to the email endpoint)
// ---------------------------------------------------------------------------

describe('TrackingDashboardPage — Email Dashboard button', () => {
  const EXPORT_PAYLOAD: TrackingSetExport = {
    exportVersion: 1,
    exportedAt: '2026-08-24T00:00:00Z',
    trackingSet: { id: 'set-1', name: 'Main Set', description: null, createdAt: '', updatedAt: '' },
    categories: [], subCategories: [], trackingItems: [],
    updateTrackingLists: [], updateTrackingListBalances: [], initialInvestmentEntries: [],
  }

  const mockedSendExportEmail = vi.mocked(sendExportEmail)
  const mockedToastSuccess = vi.mocked(toast.success)
  const mockedToastError = vi.mocked(toast.error)

  function getEmailButton() {
    return screen.getByRole('button', { name: /Email Dashboard/i })
  }

  it('is enabled once the grid loads, and calls getExport (no re-fetch of the grid) then sendExportEmail on click, showing a success toast and re-enabling the button', async () => {
    const user = userEvent.setup()
    mocked.getExport.mockResolvedValue(EXPORT_PAYLOAD)
    mockedSendExportEmail.mockResolvedValue({
      success: true, recipient: 'user@example.com', sentAt: '2026-08-24T00:00:01Z', error: null,
    })

    render(<TrackingDashboardPage />)
    await waitForGrid()

    const button = getEmailButton()
    expect(button).toBeEnabled()

    await user.click(button)

    await waitFor(() => expect(mockedSendExportEmail).toHaveBeenCalledTimes(1))

    // getExport called exactly once (the export fetch), getBalanceGrid never
    // re-called beyond its initial load (no re-fetch of already-loaded data).
    expect(mocked.getExport).toHaveBeenCalledWith('set-1')
    expect(mocked.getBalanceGrid).toHaveBeenCalledTimes(1)

    // sendExportEmail receives an HTML body built from already-loaded state
    // plus a base64 attachment of the export payload.
    const callArg = mockedSendExportEmail.mock.calls[0][0]
    expect(callArg.htmlBody).toContain('Assets')
    expect(callArg.attachmentFilename).toMatch(/^tracking-backup-set-1-.*\.json$/)
    expect(callArg.subject).toMatch(/^Financial Tracker Export - \d{4}-\d{2}-\d{2}$/)
    expect(typeof callArg.attachmentContent).toBe('string')
    expect(callArg.attachmentContent.length).toBeGreaterThan(0)

    await waitFor(() => expect(mockedToastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('user@example.com'),
    ))
    expect(mockedToastError).not.toHaveBeenCalled()
    expect(button).toBeEnabled()
  })

  it('carries Thai category text through the full export -> base64 attachment pipeline intact (real user data is Thai script)', async () => {
    const user = userEvent.setup()
    const thaiCategoryName = 'เงินฝากธนาคาร'
    const exportWithThaiData: TrackingSetExport = {
      ...EXPORT_PAYLOAD,
      categories: [{ id: 'cat-1', name: thaiCategoryName }],
    }
    mocked.getExport.mockResolvedValue(exportWithThaiData)
    mockedSendExportEmail.mockResolvedValue({
      success: true, recipient: 'user@example.com', sentAt: '2026-08-24T00:00:01Z', error: null,
    })

    render(<TrackingDashboardPage />)
    await waitForGrid()

    await user.click(getEmailButton())

    await waitFor(() => expect(mockedSendExportEmail).toHaveBeenCalledTimes(1))

    const callArg = mockedSendExportEmail.mock.calls[0][0]
    const decodedAttachment = Buffer.from(callArg.attachmentContent, 'base64').toString('utf-8')
    expect(decodedAttachment).toContain(thaiCategoryName)
  })

  it('disables the button while the request is in flight', async () => {
    const user = userEvent.setup()
    let resolveExport: (value: TrackingSetExport) => void
    mocked.getExport.mockReturnValue(new Promise(resolve => { resolveExport = resolve }))

    render(<TrackingDashboardPage />)
    await waitForGrid()

    const button = getEmailButton()
    await user.click(button)

    expect(button).toBeDisabled()

    resolveExport!(EXPORT_PAYLOAD)
    // Let the export-fetch failure branch resolve (getExport succeeds but
    // sendExportEmail was never mocked here to resolve, so just wait for the
    // export call and stop — the disabled-state assertion above is this
    // test's point).
    await waitFor(() => expect(mocked.getExport).toHaveBeenCalled())
  })

  it('shows a distinct "could not build backup" error and re-enables the button when getExport fails, WITHOUT calling sendExportEmail at all', async () => {
    const user = userEvent.setup()
    mocked.getExport.mockRejectedValue(new Error('network error'))

    render(<TrackingDashboardPage />)
    await waitForGrid()

    const button = getEmailButton()
    await user.click(button)

    await waitFor(() => expect(mockedToastError).toHaveBeenCalledWith(
      expect.stringMatching(/could not build backup/i),
    ))
    expect(mockedSendExportEmail).not.toHaveBeenCalled()
    expect(button).toBeEnabled()
  })

  it('shows a distinct "not configured" error on a 503 and re-enables the button', async () => {
    const user = userEvent.setup()
    mocked.getExport.mockResolvedValue(EXPORT_PAYLOAD)
    mockedSendExportEmail.mockRejectedValue({
      isAxiosError: true, response: { status: 503, data: { detail: 'SMTP not configured' } },
    })

    render(<TrackingDashboardPage />)
    await waitForGrid()

    const button = getEmailButton()
    await user.click(button)

    await waitFor(() => expect(mockedToastError).toHaveBeenCalledWith(
      expect.stringMatching(/not configured/i),
    ))
    expect(button).toBeEnabled()
  })

  it('shows a distinct "sending the email failed" error on a 502 (backup succeeded, delivery failed), and re-enables the button', async () => {
    const user = userEvent.setup()
    mocked.getExport.mockResolvedValue(EXPORT_PAYLOAD)
    mockedSendExportEmail.mockRejectedValue({
      isAxiosError: true, response: { status: 502, data: { detail: 'SMTP send failed' } },
    })

    render(<TrackingDashboardPage />)
    await waitForGrid()

    const button = getEmailButton()
    await user.click(button)

    await waitFor(() => expect(mockedToastError).toHaveBeenCalledWith(
      expect.stringMatching(/sending the email failed/i),
    ))
    expect(button).toBeEnabled()
  })

  it('renders three genuinely distinct error messages across the three failure paths', async () => {
    const user = userEvent.setup()

    // Path 1: export fetch fails.
    mocked.getExport.mockRejectedValueOnce(new Error('boom'))
    render(<TrackingDashboardPage />)
    await waitForGrid()
    await user.click(getEmailButton())
    await waitFor(() => expect(mockedToastError).toHaveBeenCalledTimes(1))
    const msg1 = mockedToastError.mock.calls[0][0]

    // Path 2: 503.
    mocked.getExport.mockResolvedValueOnce(EXPORT_PAYLOAD)
    mockedSendExportEmail.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503, data: {} } })
    await user.click(getEmailButton())
    await waitFor(() => expect(mockedToastError).toHaveBeenCalledTimes(2))
    const msg2 = mockedToastError.mock.calls[1][0]

    // Path 3: 502.
    mocked.getExport.mockResolvedValueOnce(EXPORT_PAYLOAD)
    mockedSendExportEmail.mockRejectedValueOnce({ isAxiosError: true, response: { status: 502, data: {} } })
    await user.click(getEmailButton())
    await waitFor(() => expect(mockedToastError).toHaveBeenCalledTimes(3))
    const msg3 = mockedToastError.mock.calls[2][0]

    expect(new Set([msg1, msg2, msg3]).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// utf8ToBase64 — UTF-8-safe base64 encoding used for the Email Dashboard
// backup attachment. This app's real user is a Thai investor whose
// remark/description/accountName fields routinely contain Thai script, so
// the round trip must survive real non-ASCII, multi-byte text intact
// (plain `btoa(jsonString)` would throw or mangle bytes on this input).
// ---------------------------------------------------------------------------

describe('utf8ToBase64', () => {
  it('round-trips Thai script plus an emoji without corrupting any byte', () => {
    const original = 'หมวดหมู่การลงทุน 💰 - เงินฝากธนาคาร'

    const encoded = utf8ToBase64(original)
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')

    expect(decoded).toBe(original)
  })
})
