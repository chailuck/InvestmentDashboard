/**
 * Shared low-level cell / number / delta formatting helpers for the Financial
 * Tracker "Analysis" view (charts + Scoped Dashboard grid).
 *
 * This is a PURE module — no React, no I/O. It reuses the app-wide
 * `formatNumber` thousand-comma helper from `@/lib/utils` underneath rather
 * than re-implementing it, so every amount on the Analysis screen reads with
 * the exact same "1,234,567.89" convention as the rest of the app. The
 * signed-amount / percentage / "no data" conventions are defined here once so
 * the four charts and the Scoped grid never drift apart.
 */

import { formatNumber } from '@/lib/utils'

/** The glyph shown for a cell that has no recorded balance. */
export const NO_DATA_DASH = '–' // en dash "–"

/** The label shown on a row's first populated period (no earlier value to diff against). */
export const NO_PRIOR_DATA = 'No prior data'

/** The label shown for a delta-% that cannot be computed because the prior value was exactly 0. */
export const PERCENT_NA = 'n/a (prior was ฿0)'

/** Thai Baht currency symbol used across the tracking module. */
export const BAHT = '฿'

/**
 * Coerces a value that may arrive as a JSON number OR a numeric string
 * (backend Decimal serialization) into a finite number, or `null` when the
 * value is null / undefined / non-finite. Mirrors the dashboard page's own
 * `toFiniteOrNull` so both screens coerce identically.
 */
export function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Formats a balance-style value with thousand separators and 2 decimals,
 * prefixed with the Baht symbol. No leading "+" on positives (matches the
 * dashboard's `fmtBalance` convention). `null` → the no-data dash.
 */
export function fmtBalance(n: number | null | undefined, opts: { symbol?: boolean } = {}): string {
  const v = toFiniteOrNull(n)
  if (v === null) return NO_DATA_DASH
  const symbol = opts.symbol === false ? '' : BAHT
  return (v < 0 ? '-' : '') + symbol + formatNumber(Math.abs(v))
}

/**
 * Formats a signed delta amount, always carrying an explicit "+" / "-" sign
 * (so the sign is legible without relying on colour — NFR-2). `null` → the
 * no-data dash.
 */
export function fmtDeltaAmount(n: number | null | undefined, opts: { symbol?: boolean } = {}): string {
  const v = toFiniteOrNull(n)
  if (v === null) return NO_DATA_DASH
  const symbol = opts.symbol === false ? '' : BAHT
  return (v >= 0 ? '+' : '-') + symbol + formatNumber(Math.abs(v))
}

/**
 * Formats a signed percentage with 2 decimals and an explicit sign, e.g.
 * "+12.34%" / "-4.50%". `null` → the no-data dash (callers that need the
 * "prior was ฿0" wording should special-case before calling this).
 */
export function fmtDeltaPercent(n: number | null | undefined): string {
  const v = toFiniteOrNull(n)
  if (v === null) return NO_DATA_DASH
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

/** Formats a share value (already a 0–100 percentage) with 1 decimal. `null` → dash. */
export function fmtSharePercent(n: number | null | undefined): string {
  const v = toFiniteOrNull(n)
  if (v === null) return NO_DATA_DASH
  return v.toFixed(1) + '%'
}

/** The Tailwind text-colour class for a delta's sign — never the only sign signal. */
export function deltaColorClass(n: number | null | undefined): string {
  const v = toFiniteOrNull(n)
  if (v === null || v === 0) return 'text-ink-muted'
  return v > 0 ? 'text-gain' : 'text-loss'
}

/** A direction arrow for a delta's sign (paired with the "+"/"-" sign, never colour alone). */
export function deltaArrow(n: number | null | undefined): string {
  const v = toFiniteOrNull(n)
  if (v === null || v === 0) return ''
  return v > 0 ? '▲' : '▼' // ▲ / ▼
}

/**
 * Combined "amount (percent)" delta label used in tooltips and grid cells.
 * `amount === null` → "No prior data". `percent === null` but `amount` present
 * → the amount plus the "prior was ฿0" note.
 */
export function fmtDelta(
  amount: number | null | undefined,
  percent: number | null | undefined,
  opts: { symbol?: boolean } = {},
): string {
  const a = toFiniteOrNull(amount)
  if (a === null) return NO_PRIOR_DATA
  const p = toFiniteOrNull(percent)
  if (p === null) return `${fmtDeltaAmount(a, opts)} (${PERCENT_NA})`
  return `${fmtDeltaAmount(a, opts)} (${fmtDeltaPercent(p)})`
}

/** Abbreviated axis number, e.g. "1.2M" / "500K" — matches the dashboard chart axes. */
export function fmtAxisNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toFixed(0)
}
