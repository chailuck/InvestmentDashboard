'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  AxisX,
  AxisY,
  AxisYLabels,
  buildAreaPath,
  buildLinePath,
  ChartTooltip,
  formatPeriodLabel,
  linearScale,
  niceTicks,
  thinLabelIndices,
  type PathPoint,
} from '@/components/charts/svg-primitives'
import { fmtAxisNumber, fmtBalance, fmtDelta, fmtDeltaAmount, fmtDeltaPercent } from '@/lib/tracking-format'
import type { AnalysisSeries, AxisPoint, Measure } from '../types'

const H = 300
const PAD = { top: 16, right: 16, bottom: 28, left: 52 }

function pick(series: AnalysisSeries, measure: Measure): (number | null)[] {
  if (measure === 'deltaAmount') return series.deltaAmount
  if (measure === 'deltaPercent') return series.deltaPercent
  return series.balance
}

/**
 * FR-5 / §4.5a — multi-series line of the selected measure over time, with a
 * dashed near-white "Lens/Scope total" overlay, legend visibility toggles, a
 * hover tooltip, an ArrowLeft/ArrowRight period cursor with an `aria-live`
 * readout, and a table view (no value is hover-gated).
 */
export function TrendChart({
  axis,
  series,
  aggregate,
  measure,
  onDrill,
}: {
  axis: AxisPoint[]
  series: AnalysisSeries[]
  aggregate: AnalysisSeries
  measure: Measure
  onDrill: (drillId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(el.clientWidth || 720)
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.max(320, Math.floor(e.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fmtValue = (v: number | null) =>
    measure === 'deltaPercent' ? fmtDeltaPercent(v) : measure === 'deltaAmount' ? fmtDeltaAmount(v) : fmtBalance(v)

  const visibleSeries = useMemo(
    () => [aggregate, ...series].filter(s => !hidden.has(s.id)),
    [aggregate, series, hidden],
  )

  const model = useMemo(() => {
    if (axis.length === 0) return null
    const innerW = width - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const xOf = (i: number) => PAD.left + (axis.length > 1 ? (i / (axis.length - 1)) * innerW : innerW / 2)

    const allVals = visibleSeries.flatMap(s => pick(s, measure).filter((v): v is number => v !== null))
    const dataMin = Math.min(measure === 'balance' ? 0 : Math.min(0, ...(allVals.length ? allVals : [0])), ...(allVals.length ? allVals : [0]))
    const dataMax = allVals.length ? Math.max(...allVals) : 1
    const ticks = niceTicks(dataMin, dataMax, 5)
    const yMin = ticks[0]
    const yMax = ticks[ticks.length - 1]
    const yScale = linearScale(yMin, yMax, PAD.top + innerH, PAD.top)
    const yTicks = ticks.map(yScale)

    const lines = [aggregate, ...series].map(s => {
      const vals = pick(s, measure)
      const points: PathPoint[] = vals.map((v, i) => ({ x: xOf(i), y: v === null ? null : yScale(v) }))
      return { s, points, vals }
    })
    const xTicks = thinLabelIndices(axis.length).map(i => ({ x: xOf(i), label: axis[i].label }))
    return { innerH, xOf, yScale, yTicks, tickValues: ticks, lines, xTicks }
  }, [axis, series, aggregate, measure, visibleSeries, width])

  const toggle = (id: string) =>
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (axis.length === 0) return
    if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(c => Math.min(axis.length - 1, (c ?? -1) + 1)) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setCursor(c => Math.max(0, (c ?? axis.length) - 1)) }
    if (e.key === 'Escape') setCursor(null)
  }

  const activeIdx = cursor
  const cursorReadout =
    activeIdx !== null && model
      ? `${formatPeriodLabel(axis[activeIdx])}: ` +
        [aggregate, ...series]
          .filter(s => !hidden.has(s.id))
          .map(s => `${s.label} ${fmtValue(pick(s, measure)[activeIdx])}`)
          .join(', ')
      : ''

  const measureLabel = measure === 'deltaPercent' ? 'Δ %' : measure === 'deltaAmount' ? 'Δ amount' : 'balance'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap" role="group" aria-label="Trend legend">
          {[aggregate, ...series].map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-pressed={!hidden.has(s.id)}
              className={cn('flex items-center gap-1.5 hover:text-ink-primary', hidden.has(s.id) && 'opacity-40 line-through')}
            >
              <span
                className="inline-block w-3 rounded-full"
                style={{ height: s.kind === 'aggregate' ? '3px' : '2px', backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className={cn(s.kind === 'aggregate' && 'font-semibold text-ink-primary')}>{s.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setShowTable(v => !v)}>
          {showTable ? 'Hide table' : 'Table view'}
        </button>
      </div>

      <div ref={containerRef} className="w-full">
        {model && !showTable && (
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`Trend of ${measureLabel} over ${axis.length} periods, ${series.length} series plus the total overlay`}
            onKeyDown={onKeyDown}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - rect.left - PAD.left
              const step = axis.length > 1 ? (width - PAD.left - PAD.right) / (axis.length - 1) : 1
              setCursor(Math.max(0, Math.min(axis.length - 1, Math.round(mx / step))))
            }}
            onMouseLeave={() => setCursor(null)}
            style={{ display: 'block', cursor: 'crosshair' }}
          >
            <AxisY ticks={model.yTicks} x1={PAD.left} x2={width - PAD.right} />
            <AxisYLabels ticks={model.yTicks} x={PAD.left - 6} values={model.tickValues} format={fmtAxisNumber} />
            <AxisX ticks={model.xTicks} y={H - 8} />
            {model.lines.map(({ s, points }) => (
              <g key={s.id} opacity={hidden.has(s.id) ? 0 : 1}>
                {series.length <= 1 && s.kind !== 'aggregate' && (
                  <path d={buildAreaPath(points, PAD.top + model.innerH)} fill={s.color} fillOpacity={0.1} />
                )}
                <path
                  data-testid={`trend-line-${s.id}`}
                  d={buildLinePath(points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.kind === 'aggregate' ? 2.5 : 2}
                  strokeDasharray={s.kind === 'aggregate' ? '6,3' : s.excluded ? '2,3' : undefined}
                  strokeOpacity={s.excluded ? 0.5 : 1}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}
            {activeIdx !== null && (
              <>
                <line
                  x1={model.xOf(activeIdx)}
                  y1={PAD.top}
                  x2={model.xOf(activeIdx)}
                  y2={PAD.top + model.innerH}
                  stroke="currentColor"
                  strokeOpacity={0.25}
                  strokeDasharray="4,3"
                />
                <ChartTooltip
                  anchorX={model.xOf(activeIdx)}
                  top={PAD.top + 2}
                  title={formatPeriodLabel(axis[activeIdx])}
                  containerWidth={width}
                  rows={[aggregate, ...series]
                    .filter(s => !hidden.has(s.id))
                    .map(s => ({
                      label: s.label,
                      color: s.color,
                      // For balances the period-over-period delta is its own
                      // secondary line (`sub`) so it never collides with the
                      // series label; other measures stay single-line.
                      ...(measure === 'balance'
                        ? {
                            value: fmtBalance(s.balance[activeIdx]),
                            sub: fmtDelta(s.deltaAmount[activeIdx], s.deltaPercent[activeIdx]),
                          }
                        : { value: fmtValue(pick(s, measure)[activeIdx]) }),
                    }))}
                />
              </>
            )}
          </svg>
        )}
        {showTable && <TrendTable axis={axis} series={[aggregate, ...series]} measure={measure} fmtValue={fmtValue} />}
      </div>

      <p className="sr-only" aria-live="polite">{cursorReadout}</p>

      {!showTable && series.some(s => s.drillId) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-ink-muted">Drill into:</span>
          {series.filter(s => s.drillId).map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => s.drillId && onDrill(s.drillId)}
              className="btn-ghost px-2 py-0.5 text-xs"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TrendTable({
  axis,
  series,
  measure,
  fmtValue,
}: {
  axis: AxisPoint[]
  series: AnalysisSeries[]
  measure: Measure
  fmtValue: (v: number | null) => string
}) {
  return (
    <table className="w-full text-xs border-collapse">
      <caption className="sr-only">Trend data table</caption>
      <thead>
        <tr>
          <th className="text-left px-2 py-1 text-ink-muted font-medium">Period</th>
          {series.map(s => (
            <th key={s.id} className="text-right px-2 py-1 text-ink-muted font-medium">{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {axis.map((p, i) => (
          <tr key={p.label} className="border-t border-border/30">
            <td className="px-2 py-1 text-ink-secondary">{formatPeriodLabel(p)}</td>
            {series.map(s => {
              const vals = measure === 'deltaAmount' ? s.deltaAmount : measure === 'deltaPercent' ? s.deltaPercent : s.balance
              return <td key={s.id} className="px-2 py-1 text-right tabular-nums text-ink-primary">{fmtValue(vals[i])}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
