import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  balanceGrid,
  balanceValueClass,
  deltaSignClass,
  useSharedBalanceColWidths,
  type BalanceWidthRow,
} from '../balanceGridStyles'

describe('balanceGridStyles — presentational tokens', () => {
  it('exposes the em-dash blank glyph (U+2014), not the charts en-dash', () => {
    expect(balanceGrid.blankGlyph).toBe('—')
    expect(balanceGrid.blankGlyph).not.toBe('–')
  })

  it('balanceValueClass maps each emphasis tier to the dashboard classes', () => {
    expect(balanceValueClass('grand')).toBe('font-bold text-brand-400')
    expect(balanceValueClass('strong')).toBe('font-semibold text-ink-primary')
    expect(balanceValueClass('normal')).toBe('text-ink-secondary')
  })

  it('deltaSignClass treats >= 0 as a gain and < 0 as a loss', () => {
    expect(deltaSignClass(10)).toBe('text-gain')
    expect(deltaSignClass(0)).toBe('text-gain')
    expect(deltaSignClass(-0.01)).toBe('text-loss')
  })
})

describe('useSharedBalanceColWidths', () => {
  const fmt = {
    balance: (v: number) => `฿${v.toLocaleString('en-US')}`,
    deltaText: (amount: number, percent: number | null) =>
      percent !== null ? `${amount >= 0 ? '+' : '-'}฿${Math.abs(amount)} (${percent}%)` : `${amount}`,
  }

  const row = (over: Partial<BalanceWidthRow> = {}): BalanceWidthRow => ({
    balance: [null, 1_234_567, null, 2_000_000],
    deltaAmount: [null, 12_345, null, 765_433],
    deltaPercent: [null, 1, null, 38.27],
    hasData: [false, true, false, true],
    hasPreviousData: [false, true, false, true],
    ...over,
  })

  it('returns two independent ch-based widths sized to the longest rendered string', () => {
    const { result } = renderHook(() => useSharedBalanceColWidths([row()], fmt))
    expect(result.current.balance).toMatch(/^\d+ch$/)
    expect(result.current.delta).toMatch(/^\d+ch$/)
    // "฿2,000,000" → 10 chars + 2 padding
    expect(result.current.balance).toBe('12ch')
    // "+฿765433 (38.27%)" → 17 chars + 2 padding
    expect(result.current.delta).toBe('19ch')
  })

  it('applies the sane minimums when every row is blank', () => {
    const blank = row({
      balance: [null, null],
      deltaAmount: [null, null],
      deltaPercent: [null, null],
      hasData: [false, false],
      hasPreviousData: [false, false],
    })
    const { result } = renderHook(() => useSharedBalanceColWidths([blank], fmt))
    expect(result.current).toEqual({ balance: '8ch', delta: '7ch' })
  })

  it('never measures a cell whose hasData / hasPreviousData flag is false', () => {
    const misleading = row({
      // large values sit behind false flags — must be ignored; the only
      // measured cell (index 1) renders as a 1-2 char string
      balance: [999_999_999_999, 1],
      deltaAmount: [999_999_999_999, 5],
      deltaPercent: [123_456, null],
      hasData: [false, true],
      hasPreviousData: [false, true],
    })
    const { result } = renderHook(() => useSharedBalanceColWidths([misleading], fmt))
    expect(result.current).toEqual({ balance: '8ch', delta: '7ch' })
  })
})
