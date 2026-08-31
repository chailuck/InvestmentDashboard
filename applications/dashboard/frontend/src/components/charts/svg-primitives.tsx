'use client'

/**
 * Shared inline-SVG chart primitives.
 *
 * A light, ADDITIVE extraction of the hand-rolled chart logic currently inline
 * on `tracking/dashboard/page.tsx` and `analytics/daily-performance/page.tsx`
 * (ADR-019 #5 — no charting library). This iteration does NOT refactor those
 * two pages to consume it; it is used by the new Analysis view only.
 *
 * Everything here is pure / presentational — no data fetching, no app state.
 */

import type { ReactNode } from 'react'
import type { AxisPoint } from '@/app/(dashboard)/tracking/analysis/types'

// ── Scales ────────────────────────────────────────────────────────────────

export type Scale = (value: number) => number

/** A linear scale mapping `[domainMin, domainMax]` → `[rangeMin, rangeMax]`. */
export function linearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): Scale {
  const span = domainMax - domainMin || 1
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin)
}

/**
 * "Nice" evenly-spaced tick values spanning `[min, max]`, rounded to a
 * human-friendly step (1 / 2 / 2.5 / 5 × 10ⁿ). Always returns `count` ticks.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const base = Number.isFinite(min) ? min : 0
    return Array.from({ length: count }, (_, i) => base + i)
  }
  const range = max - min
  const rawStep = range / (count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))))
  const norm = rawStep / mag
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = niceNorm * mag
  const niceMin = Math.floor(min / step) * step
  return Array.from({ length: count }, (_, i) => niceMin + i * step)
}

// ── Path builders ─────────────────────────────────────────────────────────

export interface PathPoint {
  x: number
  /** `null` ⇒ a genuine gap — the path BREAKS here, never interpolates. */
  y: number | null
}

/** SVG `d` for a poly-line that breaks at every `null` point (multiple `M…L…` subpaths). */
export function buildLinePath(points: readonly PathPoint[]): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (p.y === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `
    pen = true
  }
  return d.trim()
}

/** SVG `d` for a soft area fill under a line, closed to `baselineY`; breaks at gaps. */
export function buildAreaPath(points: readonly PathPoint[], baselineY: number): string {
  let d = ''
  let run: { x: number; y: number }[] = []
  const flush = () => {
    if (run.length === 0) return
    d += `M${run[0].x.toFixed(2)},${baselineY.toFixed(2)} `
    for (const pt of run) d += `L${pt.x.toFixed(2)},${pt.y.toFixed(2)} `
    d += `L${run[run.length - 1].x.toFixed(2)},${baselineY.toFixed(2)} Z `
    run = []
  }
  for (const p of points) {
    if (p.y === null) { flush(); continue }
    run.push({ x: p.x, y: p.y })
  }
  flush()
  return d.trim()
}

/**
 * Stacked-area band paths. `seriesValues[s][p]` is series `s`'s value at
 * period `p` (`null` ⇒ contributes 0, the band pinches). Returns one closed
 * `d` string per series, bottom band first.
 */
export function buildStackedAreaPaths(
  seriesValues: readonly (number | null)[][],
  xs: readonly number[],
  yOf: Scale,
): string[] {
  const nSeries = seriesValues.length
  const nPeriods = xs.length
  const lower = new Array(nPeriods).fill(0)
  const paths: string[] = []
  for (let s = 0; s < nSeries; s++) {
    const upper = lower.map((lo, p) => lo + (seriesValues[s][p] ?? 0))
    let d = ''
    for (let p = 0; p < nPeriods; p++) d += `${p === 0 ? 'M' : 'L'}${xs[p].toFixed(2)},${yOf(upper[p]).toFixed(2)} `
    for (let p = nPeriods - 1; p >= 0; p--) d += `L${xs[p].toFixed(2)},${yOf(lower[p]).toFixed(2)} `
    d += 'Z'
    paths.push(d.trim())
    for (let p = 0; p < nPeriods; p++) lower[p] = upper[p]
  }
  return paths
}

// ── Labels ────────────────────────────────────────────────────────────────

/** e.g. "Q3 2025" (quarterly) or "2025 (as of Q3)" (yearly). */
export function formatPeriodLabel(point: AxisPoint): string {
  if (point.quarter !== null) return point.label
  return point.asOfQuarter ? `${point.label} (as of Q${point.asOfQuarter})` : point.label
}

/** Thins a list of indices to at most `max`, always keeping the last. */
export function thinLabelIndices(count: number, max = 8): number[] {
  const step = Math.max(1, Math.ceil(count / max))
  const out: number[] = []
  for (let i = 0; i < count; i++) if (i % step === 0 || i === count - 1) out.push(i)
  return out
}

// ── Axis components ──────────────────────────────────────────────────────

export function AxisY({
  ticks, x1, x2,
}: {
  ticks: number[]
  x1: number
  x2: number
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t, i) => (
        <line key={i} x1={x1} y1={t} x2={x2} y2={t} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
      ))}
    </g>
  )
}

export function AxisYLabels({
  ticks, x, values, format,
}: {
  ticks: number[]
  x: number
  values: number[]
  format: (v: number) => string
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((y, i) => (
        <text key={i} x={x} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
          {format(values[i])}
        </text>
      ))}
    </g>
  )
}

export function AxisX({
  ticks, y,
}: {
  ticks: { x: number; label: string }[]
  y: number
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t, i) => (
        <text key={i} x={t.x} y={y} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
          {t.label}
        </text>
      ))}
    </g>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────

export interface TooltipRow {
  label: string
  value: string
  /**
   * Optional secondary line rendered beneath the row's main line with readable
   * leading (e.g. a period-over-period delta). Rows that follow advance by the
   * full height this row occupies, so a `sub` line never overlaps the next row.
   */
  sub?: string
  color?: string
}

/** Vertical advance for a single-line row / the extra advance a `sub` line adds. */
const TOOLTIP_LINE_H = 16
const TOOLTIP_SUB_H = 12

/**
 * An SVG tooltip box. Flips to the left of `anchorX` when it would overflow
 * `containerWidth`. Purely visual — the accessible equivalent is the chart's
 * table view / `aria-live` region.
 *
 * A row may carry an optional `sub` line (secondary detail such as a
 * period-over-period delta); it renders on its own baseline beneath the main
 * line and every subsequent row is pushed down by the full height it occupies,
 * so multi-line rows never overlap themselves or their neighbours.
 */
export function ChartTooltip({
  anchorX, top, title, rows, containerWidth, rightPad = 12,
}: {
  anchorX: number
  top: number
  title: string
  rows: TooltipRow[]
  containerWidth: number
  rightPad?: number
}): ReactNode {
  const width = 210
  // Running vertical offset per row — a row with a `sub` line occupies two
  // lines, so it advances the next row by TOOLTIP_LINE_H + TOOLTIP_SUB_H.
  const rowOffsets = rows.reduce<number[]>((acc, _r, i) => {
    if (i === 0) return [0]
    acc.push(acc[i - 1] + TOOLTIP_LINE_H + (rows[i - 1].sub ? TOOLTIP_SUB_H : 0))
    return acc
  }, [])
  const rowsHeight = rows.length
    ? rowOffsets[rows.length - 1] + TOOLTIP_LINE_H + (rows[rows.length - 1].sub ? TOOLTIP_SUB_H : 0)
    : 0
  const height = 22 + rowsHeight + 6
  const flip = anchorX + width + rightPad > containerWidth
  const x = flip ? anchorX - width - rightPad : anchorX + rightPad
  return (
    <g pointerEvents="none">
      <rect x={x} y={top} width={width} height={height} rx={6} ry={6} fill="#1C2333" fillOpacity={0.98} stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} />
      <text x={x + 10} y={top + 16} fontSize={11} fontWeight={600} fill="#E2E8F0">{title}</text>
      {rows.map((r, i) => (
        <g key={i} transform={`translate(${x + 10}, ${top + 30 + rowOffsets[i]})`}>
          {r.color && <rect x={0} y={-8} width={8} height={8} rx={2} fill={r.color} />}
          <text x={r.color ? 14 : 0} y={0} fontSize={10.5} fill="#94A3B8">{r.label}</text>
          <text x={width - 20} y={0} textAnchor="end" fontSize={10.5} fill="#E2E8F0">{r.value}</text>
          {r.sub && (
            <text x={width - 20} y={TOOLTIP_SUB_H} textAnchor="end" fontSize={9.5} fill="#94A3B8">{r.sub}</text>
          )}
        </g>
      ))}
    </g>
  )
}
