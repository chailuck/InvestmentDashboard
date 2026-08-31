import { describe, it, expect } from 'vitest'
import {
  BAHT,
  NO_DATA_DASH,
  NO_PRIOR_DATA,
  deltaArrow,
  deltaColorClass,
  fmtAxisNumber,
  fmtBalance,
  fmtDelta,
  fmtDeltaAmount,
  fmtDeltaPercent,
  fmtSharePercent,
  toFiniteOrNull,
} from '../tracking-format'

describe('toFiniteOrNull', () => {
  it('passes through finite numbers', () => {
    expect(toFiniteOrNull(0)).toBe(0)
    expect(toFiniteOrNull(-12.5)).toBe(-12.5)
  })
  it('parses numeric strings (backend Decimal serialization)', () => {
    expect(toFiniteOrNull('1234.56')).toBe(1234.56)
  })
  it('returns null for null / undefined / empty / non-numeric', () => {
    expect(toFiniteOrNull(null)).toBeNull()
    expect(toFiniteOrNull(undefined)).toBeNull()
    expect(toFiniteOrNull('')).toBeNull()
    expect(toFiniteOrNull('abc')).toBeNull()
    expect(toFiniteOrNull(Infinity)).toBeNull()
  })
})

describe('fmtBalance', () => {
  it('formats with baht symbol, thousands and 2 decimals, no + on positives', () => {
    expect(fmtBalance(1234567.89)).toBe(`${BAHT}1,234,567.89`)
  })
  it('keeps a leading minus for negatives', () => {
    expect(fmtBalance(-50)).toBe(`-${BAHT}50.00`)
  })
  it('can drop the symbol', () => {
    expect(fmtBalance(1000, { symbol: false })).toBe('1,000.00')
  })
  it('renders the no-data dash for null', () => {
    expect(fmtBalance(null)).toBe(NO_DATA_DASH)
  })
})

describe('fmtDeltaAmount', () => {
  it('always carries an explicit sign', () => {
    expect(fmtDeltaAmount(100)).toBe(`+${BAHT}100.00`)
    expect(fmtDeltaAmount(-100)).toBe(`-${BAHT}100.00`)
    expect(fmtDeltaAmount(0)).toBe(`+${BAHT}0.00`)
  })
})

describe('fmtDeltaPercent', () => {
  it('signs and fixes to 2 decimals', () => {
    expect(fmtDeltaPercent(12.345)).toBe('+12.35%')
    expect(fmtDeltaPercent(-4.5)).toBe('-4.50%')
  })
  it('dash for null', () => {
    expect(fmtDeltaPercent(null)).toBe(NO_DATA_DASH)
  })
})

describe('fmtSharePercent', () => {
  it('one decimal', () => {
    expect(fmtSharePercent(33.333)).toBe('33.3%')
  })
})

describe('fmtDelta (combined)', () => {
  it('"No prior data" when the amount is null', () => {
    expect(fmtDelta(null, null)).toBe(NO_PRIOR_DATA)
  })
  it('notes "prior was ฿0" when only the percent is null', () => {
    expect(fmtDelta(100, null)).toBe(`+${BAHT}100.00 (n/a (prior was ${BAHT}0))`)
  })
  it('combines amount and percent', () => {
    expect(fmtDelta(100, 25)).toBe(`+${BAHT}100.00 (+25.00%)`)
  })
})

describe('deltaColorClass / deltaArrow', () => {
  it('maps sign to colour class', () => {
    expect(deltaColorClass(5)).toBe('text-gain')
    expect(deltaColorClass(-5)).toBe('text-loss')
    expect(deltaColorClass(0)).toBe('text-ink-muted')
    expect(deltaColorClass(null)).toBe('text-ink-muted')
  })
  it('maps sign to an arrow (empty for zero / null)', () => {
    expect(deltaArrow(5)).toBe('▲')
    expect(deltaArrow(-5)).toBe('▼')
    expect(deltaArrow(0)).toBe('')
    expect(deltaArrow(null)).toBe('')
  })
})

describe('fmtAxisNumber', () => {
  it('abbreviates millions and thousands', () => {
    expect(fmtAxisNumber(2_500_000)).toBe('2.5M')
    expect(fmtAxisNumber(12_000)).toBe('12K')
    expect(fmtAxisNumber(500)).toBe('500')
  })
})
