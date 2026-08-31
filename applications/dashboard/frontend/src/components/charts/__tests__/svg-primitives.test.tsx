import { describe, it, expect } from 'vitest'
import { render } from '@/test/test-utils'
import {
  buildAreaPath,
  buildLinePath,
  buildStackedAreaPaths,
  ChartTooltip,
  formatPeriodLabel,
  linearScale,
  niceTicks,
  thinLabelIndices,
} from '../svg-primitives'
import type { AxisPoint } from '@/app/(dashboard)/tracking/analysis/types'

describe('linearScale', () => {
  it('maps domain endpoints to range endpoints', () => {
    const s = linearScale(0, 100, 0, 200)
    expect(s(0)).toBe(0)
    expect(s(50)).toBe(100)
    expect(s(100)).toBe(200)
  })
})

describe('niceTicks', () => {
  it('returns the requested count spanning the data, snapped to a round step', () => {
    const t = niceTicks(0, 97, 5)
    expect(t).toHaveLength(5)
    expect(t[0]).toBeLessThanOrEqual(0)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97)
  })
  it('degenerate min === max still yields ticks', () => {
    expect(niceTicks(5, 5, 4)).toHaveLength(4)
  })
})

describe('buildLinePath', () => {
  it('breaks the path at every null point (multiple subpaths)', () => {
    const d = buildLinePath([{ x: 0, y: 0 }, { x: 1, y: null }, { x: 2, y: 2 }, { x: 3, y: 3 }])
    expect(d).toBe('M0.00,0.00 M2.00,2.00 L3.00,3.00')
  })
})

describe('buildAreaPath', () => {
  it('closes each run to the baseline', () => {
    const d = buildAreaPath([{ x: 0, y: 10 }, { x: 1, y: 20 }], 100)
    expect(d).toContain('M0.00,100.00')
    expect(d.trim().endsWith('Z')).toBe(true)
  })
})

describe('buildStackedAreaPaths', () => {
  it('returns one closed path per series, stacked bottom-up (nulls contribute 0)', () => {
    const paths = buildStackedAreaPaths([[1, null], [2, 3]], [0, 10], v => 100 - v)
    expect(paths).toHaveLength(2)
    expect(paths[0].endsWith('Z')).toBe(true)
    expect(paths[1].endsWith('Z')).toBe(true)
  })
})

describe('formatPeriodLabel', () => {
  const q: AxisPoint = { index: 0, label: 'Q3 2025', year: 2025, quarter: 3, asOfQuarter: null, asOfLabel: null }
  const y: AxisPoint = { index: 0, label: '2025', year: 2025, quarter: null, asOfQuarter: 3, asOfLabel: 'as of Q3 2025' }
  it('quarter labels pass through; yearly labels gain the as-of quarter', () => {
    expect(formatPeriodLabel(q)).toBe('Q3 2025')
    expect(formatPeriodLabel(y)).toBe('2025 (as of Q3)')
  })
})

describe('thinLabelIndices', () => {
  it('caps the label count and always keeps the last index', () => {
    const idxs = thinLabelIndices(40, 8)
    expect(idxs.length).toBeLessThanOrEqual(9)
    expect(idxs[idxs.length - 1]).toBe(39)
  })
})

describe('ChartTooltip multi-line rows', () => {
  // Regression guard for the Analysis "Trend" tooltip punch-list bug: a row with
  // a `sub` line (period-over-period delta) used to be concatenated onto the
  // value and overflow / overlap the series label. Every logical line — the
  // title, each row's main line and each `sub` line — must sit on its own
  // vertical band, in increasing document order, with no two lines colliding.
  const translateY = (el: Element | null): number => {
    const t = el?.getAttribute('transform') ?? ''
    const m = /translate\(\s*-?[\d.]+\s*,\s*(-?[\d.]+)\s*\)/.exec(t)
    return m ? parseFloat(m[1]) : 0
  }
  const effectiveY = (t: Element): number =>
    translateY(t.parentElement) + parseFloat(t.getAttribute('y') ?? '0')

  it('never stacks two tooltip text lines at the same effective y', () => {
    const rows = [
      { label: 'Lens total', value: '฿12,345,678.90', sub: '+฿1,234,567.89 (+11.11%)', color: '#fff' },
      { label: 'Assets', value: '฿10,000,000.00', sub: '+฿900,000.00 (+9.00%)', color: '#0af' },
      { label: 'Misc', value: '฿2,345,678.90', color: '#fa0' },
    ]
    const { container } = render(
      <svg>
        <ChartTooltip anchorX={20} top={0} title="Q3 2025" containerWidth={720} rows={rows} />
      </svg>,
    )

    const texts = Array.from(container.querySelectorAll('text'))
    // title + (main + sub) for the 2 multi-line rows + 1 main for the single-line row
    const expectedLogicalLines = 1 + rows.reduce((n, r) => n + 1 + (r.sub ? 1 : 0), 0)
    expect(expectedLogicalLines).toBe(6)

    const ys = texts.map(effectiveY)

    // Document order never regresses upward (label/value share a baseline → allow equal).
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1])
    }

    // Every logical line occupies its own distinct band, and consecutive bands
    // have readable leading (>= the sub-line height) so nothing visually overlaps.
    const bands = [...new Set(ys)].sort((a, b) => a - b)
    expect(bands).toHaveLength(expectedLogicalLines)
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i] - bands[i - 1]).toBeGreaterThanOrEqual(12)
    }
  })
})
