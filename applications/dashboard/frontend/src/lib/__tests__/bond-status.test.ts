import { describe, it, expect } from 'vitest'
import { computeBondStatus, computeBondYears } from '@/lib/bond-status'

// Mirrors the backend derivation exactly. Dates are ISO strings (yyyy-MM-dd),
// which sort lexically, so plain string comparison is a valid date comparison.

describe('computeBondStatus', () => {
  it("returns 'Unknown' when either date is missing", () => {
    expect(computeBondStatus(null, '2030-01-01', '2026-01-01')).toBe('Unknown')
    expect(computeBondStatus('2025-01-01', null, '2026-01-01')).toBe('Unknown')
    expect(computeBondStatus(null, null, '2026-01-01')).toBe('Unknown')
  })

  it("returns 'Pre-order' when today is before the start date", () => {
    expect(computeBondStatus('2027-01-01', '2030-01-01', '2026-12-31')).toBe('Pre-order')
  })

  it("returns 'Expire' when today is after the expiry date", () => {
    expect(computeBondStatus('2020-01-01', '2025-01-01', '2025-01-02')).toBe('Expire')
  })

  it("returns 'Active' when today is within the term", () => {
    expect(computeBondStatus('2025-01-01', '2030-01-01', '2026-06-15')).toBe('Active')
  })

  it("treats the bounds as inclusive ('Active' on the start and expiry dates)", () => {
    expect(computeBondStatus('2025-01-01', '2030-01-01', '2025-01-01')).toBe('Active')
    expect(computeBondStatus('2025-01-01', '2030-01-01', '2030-01-01')).toBe('Active')
  })
})

// ── computeBondYears — whole-year term span, ties away from zero ─────────────
//
// MUST stay result-identical to the backend `app.services.bond_status.
// compute_bond_years` (see tracking-backend/tests/test_bond_status.py). The
// day-count boundaries below are derived against the fixed 365.25 divisor:
//   365.25 * 0.5  = 182.625  -> 182d = 0.4983 (->0),   183d = 0.5010 (->1)
//   365.25 * 2.5  = 913.125  -> 913d = 2.4997 (->2),   914d = 2.5024 (->3)
//   365.25 * 5    = 1826.25  -> 1826d = 4.9993 (->5)
//   365.25 * 10   = 3652.5   -> 3653d = 10.0014 (->10)
// Negative spans (expired before start) pass through unchanged: no clamp, no
// throw. Ties round away from zero in both directions.

const YBASE = '2000-01-01'
const YBASE_MS = Date.parse(`${YBASE}T00:00:00Z`)

/** ISO date exactly `n` days from YBASE (n may be negative). */
const isoFromBase = (n: number): string =>
  new Date(YBASE_MS + n * 86_400_000).toISOString().slice(0, 10)

/**
 * `computeBondYears` for a span of exactly `n` days. A tiny negative span
 * yields JS `-0`; collapse it to `0` so `toBe(0)` (Object.is) is clean —
 * `-0` and `0` are mathematically identical here.
 */
const yearsForDays = (n: number): number | null => {
  const v = computeBondYears(YBASE, isoFromBase(n))
  return v === 0 ? 0 : v
}

describe('computeBondYears', () => {
  it('returns null when either term date is missing', () => {
    expect(computeBondYears(null, '2030-01-01')).toBeNull()
    expect(computeBondYears('', '2030-01-01')).toBeNull()
    expect(computeBondYears('2020-01-01', null)).toBeNull()
    expect(computeBondYears('2020-01-01', '')).toBeNull()
    expect(computeBondYears(null, null)).toBeNull()
  })

  it('returns 0 for a zero-day span (start === expired)', () => {
    expect(computeBondYears('2020-01-01', '2020-01-01')).toBe(0)
    expect(yearsForDays(0)).toBe(0)
  })

  it('rounds the near-0.5-year boundary: 182d -> 0, 183d -> 1', () => {
    expect(yearsForDays(182)).toBe(0)
    expect(yearsForDays(183)).toBe(1)
  })

  it('rounds whole-year spans: 365d -> 1, 1826d -> 5, 3653d -> 10', () => {
    expect(yearsForDays(365)).toBe(1)
    expect(yearsForDays(1826)).toBe(5)
    expect(yearsForDays(3653)).toBe(10)
  })

  it('rounds ties away from zero at the 2.5-year boundary: 913d -> 2, 914d -> 3', () => {
    expect(yearsForDays(913)).toBe(2)
    expect(yearsForDays(914)).toBe(3)
  })

  it('passes negative spans through unchanged and never throws', () => {
    expect(() => yearsForDays(-183)).not.toThrow()
    expect(yearsForDays(-183)).toBe(-1)
    expect(yearsForDays(-182)).toBe(0)
    expect(yearsForDays(-3653)).toBe(-10)
    expect(computeBondYears('2025-01-01', '2015-01-01')).toBe(-10)
  })

  it('is deterministic — identical inputs give identical results', () => {
    const a = computeBondYears('2020-01-01', '2025-01-01')
    const b = computeBondYears('2020-01-01', '2025-01-01')
    expect(a).toBe(b)
    expect(a).toBe(5)
  })
})
