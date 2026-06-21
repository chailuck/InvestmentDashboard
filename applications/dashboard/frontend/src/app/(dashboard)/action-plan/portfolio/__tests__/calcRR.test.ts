'use client'

/**
 * Unit tests for the calcRR and fmtRR functions in the Portfolio Plan editor.
 *
 * Scope: The RR (Risk/Reward) calculation and formatting logic is extracted and
 * tested as pure functions. This validates all acceptance criteria for the RR
 * display feature without requiring full Next.js page rendering.
 *
 * Acceptance criteria verified:
 *   AC-1.1  RR is calculated as (TP − entryPrice) / (entryPrice − SL) — tested
 *   AC-1.2  Returns null when any of TP, entryPrice, or SL is null — tested
 *   AC-1.3  Returns null when entryPrice === SL (division by zero guard) — tested
 *   AC-1.4  Returns correct value for RR >= 2.0 (good risk/reward) — tested
 *   AC-1.5  Returns correct value for RR in range [1.0, 2.0) (acceptable) — tested
 *   AC-1.6  Returns correct value for RR < 1.0 (poor risk/reward) — tested
 *   AC-1.7  Returns negative RR for invalid trades (TP < entryPrice) — tested (display-only, no rejection)
 *   AC-1.8  Result is a float, not truncated (precision preserved) — tested
 *   AC-1.9  fmtRR formats to exactly 1 decimal place followed by 'R' — tested
 *   AC-1.10 fmtRR returns '—' (em-dash) for null input — tested
 */

import { describe, it, expect } from 'vitest'

// ── Functions extracted for unit testing ──────────────────────────────────────
//
// These mirror exactly the module-scoped functions in page.tsx (lines 39–53).
// They are not exported from the page, so we duplicate them here following the
// same pattern established in copyFromPreviousPlan.test.ts.

function calcRR(
  tp: number | null,
  entryPrice: number | null,
  sl: number | null,
): number | null {
  if (tp == null || entryPrice == null || sl == null) return null
  const denominator = entryPrice - sl
  if (denominator === 0) return null
  return (tp - entryPrice) / denominator
}

function fmtRR(v: number | null): string {
  if (v == null) return '—'
  return `${v.toFixed(1)}R`
}

// ── Suite 1: calcRR() ─────────────────────────────────────────────────────────

describe('calcRR — happy path (AC-1.1, AC-1.4, AC-1.5, AC-1.6)', () => {

  it('AC-1.4: returns 2.0 for a good 2:1 setup (tp=120, entry=100, sl=90)', () => {
    // RR = (120 - 100) / (100 - 90) = 20 / 10 = 2.0
    expect(calcRR(120, 100, 90)).toBe(2.0)
  })

  it('AC-1.4: returns 2.5 for tp=115, entry=100, sl=94', () => {
    // RR = (115 - 100) / (100 - 94) = 15 / 6 = 2.5
    expect(calcRR(115, 100, 94)).toBe(2.5)
  })

  it('AC-1.5: returns 1.0 for exactly 1:1 setup (tp=110, entry=100, sl=90)', () => {
    // RR = (110 - 100) / (100 - 90) = 10 / 10 = 1.0
    expect(calcRR(110, 100, 90)).toBe(1.0)
  })

  it('AC-1.6: returns 0.5 for a poor sub-1.0 setup (tp=105, entry=100, sl=90)', () => {
    // RR = (105 - 100) / (100 - 90) = 5 / 10 = 0.5
    expect(calcRR(105, 100, 90)).toBe(0.5)
  })

  it('AC-1.1: returns 0.0 when TP equals entryPrice (reward = 0)', () => {
    // RR = (100 - 100) / (100 - 90) = 0 / 10 = 0.0
    expect(calcRR(100, 100, 90)).toBe(0.0)
  })
})

describe('calcRR — null guards (AC-1.2)', () => {

  it('AC-1.2: returns null when tp is null', () => {
    expect(calcRR(null, 100, 90)).toBeNull()
  })

  it('AC-1.2: returns null when entryPrice is null', () => {
    expect(calcRR(120, null, 90)).toBeNull()
  })

  it('AC-1.2: returns null when sl is null', () => {
    expect(calcRR(120, 100, null)).toBeNull()
  })

  it('AC-1.2: returns null when all three inputs are null', () => {
    expect(calcRR(null, null, null)).toBeNull()
  })
})

describe('calcRR — zero denominator guard (AC-1.3)', () => {

  it('AC-1.3: returns null when entryPrice equals sl (would divide by zero)', () => {
    // denominator = 100 - 100 = 0 → must not throw; must return null
    expect(calcRR(120, 100, 100)).toBeNull()
  })
})

describe('calcRR — negative RR (invalid trade signal, AC-1.7)', () => {

  it('AC-1.7: returns -1.0 when TP is below entryPrice (tp=90, entry=100, sl=90)', () => {
    // RR = (90 - 100) / (100 - 90) = -10 / 10 = -1.0
    // Function returns the value as-is for display purposes; no rejection logic
    expect(calcRR(90, 100, 90)).toBe(-1.0)
  })

  it('AC-1.7: returns -2.0 when SL is above entryPrice (pathological short-side case)', () => {
    // RR = (120 - 100) / (100 - 110) = 20 / -10 = -2.0
    expect(calcRR(120, 100, 110)).toBe(-2.0)
  })
})

describe('calcRR — floating-point precision (AC-1.8)', () => {

  it('AC-1.8: preserves float precision without truncation (tp=113, entry=100, sl=94)', () => {
    // RR = (113 - 100) / (100 - 94) = 13 / 6 ≈ 2.16667...
    // Must not be truncated to 2; toBeCloseTo ensures we get the actual float
    expect(calcRR(113, 100, 94)).toBeCloseTo(2.1667, 4)
  })
})

// ── Suite 2: fmtRR() ──────────────────────────────────────────────────────────

describe('fmtRR — null handling (AC-1.10)', () => {

  it('AC-1.10: returns em-dash for null input', () => {
    expect(fmtRR(null)).toBe('—')
  })
})

describe('fmtRR — formatted output (AC-1.9)', () => {

  it('AC-1.9: formats 2.0 as "2.0R"', () => {
    expect(fmtRR(2.0)).toBe('2.0R')
  })

  it('AC-1.9: formats 2.5 as "2.5R"', () => {
    expect(fmtRR(2.5)).toBe('2.5R')
  })

  it('AC-1.9: formats 1.0 as "1.0R"', () => {
    expect(fmtRR(1.0)).toBe('1.0R')
  })

  it('AC-1.9: formats 0.5 as "0.5R"', () => {
    expect(fmtRR(0.5)).toBe('0.5R')
  })

  it('AC-1.9: formats 0.0 as "0.0R"', () => {
    expect(fmtRR(0.0)).toBe('0.0R')
  })

  it('AC-1.9: formats -1.0 as "-1.0R" (negative RR — invalid trade signal)', () => {
    expect(fmtRR(-1.0)).toBe('-1.0R')
  })

  it('AC-1.9: rounds 2.1667 to one decimal place and formats as "2.2R"', () => {
    // toFixed(1) rounds 2.1667 → "2.2"
    expect(fmtRR(2.1667)).toBe('2.2R')
  })
})

// ── Suite 3: calcRR + fmtRR integration ───────────────────────────────────────

describe('calcRR + fmtRR — end-to-end pipeline for RR column display', () => {

  it('good RR (>=2.0): calcRR(120, 100, 90) → 2.0 → fmtRR → "2.0R"', () => {
    const rr = calcRR(120, 100, 90)
    expect(fmtRR(rr)).toBe('2.0R')
  })

  it('acceptable RR (1.0–1.99): calcRR(110, 100, 90) → 1.0 → fmtRR → "1.0R"', () => {
    const rr = calcRR(110, 100, 90)
    expect(fmtRR(rr)).toBe('1.0R')
  })

  it('poor RR (<1.0): calcRR(105, 100, 90) → 0.5 → fmtRR → "0.5R"', () => {
    const rr = calcRR(105, 100, 90)
    expect(fmtRR(rr)).toBe('0.5R')
  })

  it('missing TP: calcRR(null, 100, 90) → null → fmtRR → "—"', () => {
    const rr = calcRR(null, 100, 90)
    expect(fmtRR(rr)).toBe('—')
  })

  it('zero denominator: calcRR(120, 100, 100) → null → fmtRR → "—"', () => {
    const rr = calcRR(120, 100, 100)
    expect(fmtRR(rr)).toBe('—')
  })
})
