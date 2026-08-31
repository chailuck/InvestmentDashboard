'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChartTooltip,
  formatPeriodLabel,
  linearScale,
  niceTicks,
  thinLabelIndices,
} from '@/components/charts/svg-primitives'
import { fmtAxisNumber, fmtBalance, fmtDeltaAmount, fmtDeltaPercent, NO_PRIOR_DATA } from '@/lib/tracking-format'
import type { DeltaMode } from '../types'
import type { AnalysisSeries, AxisPoint } from '../types'

const H = 260
const PAD = { top: 16, right: 14, bottom: 30, left: 52 }
const GAIN = '#22C55E'
const LOSS = '#EF4444'

/**
 * FR-7 / §4.5d — diverging vertical bars around a 0 baseline (gains up, losses
 * down; sign also by arrow / sign label). Waterfall toggle. Unit toggle
 * Δ amount / Δ %. No bar for the first populated period; a bar after an
 * interior gap is labelled "vs {last populated period}".
 */
export function DeltaTrendChart({
  axis,
  node,
  deltaMode,
  onDeltaModeChange,
}: {
  axis: AxisPoint[]
  node: AnalysisSeries
  deltaMode: DeltaMode
  onDeltaModeChange: (m: DeltaMode) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [unit, setUnit] = useState<'amount' | 'percent'>('amount')
  const [hover, setHover] = useState<number | null>(null)
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

  const deltas = unit === 'amount' ? node.deltaAmount : node.deltaPercent
  const populatedCount = node.balance.filter(v => v !== null).length

  const model = useMemo(() => {
    if (axis.length === 0) return null
    const innerW = width - PAD.left - PAD.right
    const xOf = (i: number) => PAD.left + (axis.length > 1 ? (i / (axis.length - 1)) * innerW : innerW / 2)
    const barW = Math.max(4, Math.min(24, innerW / Math.max(axis.length, 1) - 6))

    if (deltaMode === 'waterfall') {
      const vals = node.balance.filter((v): v is number => v !== null)
      const lo = Math.min(0, ...vals)
      const hi = Math.max(1, ...vals)
      const ticks = niceTicks(lo, hi, 5)
      const yScale = linearScale(ticks[0], ticks[ticks.length - 1], H - PAD.bottom, PAD.top)
      return { mode: 'waterfall' as const, xOf, barW, yScale, ticks }
    }

    const dv = deltas.filter((v): v is number => v !== null)
    const maxAbs = Math.max(1, ...dv.map(Math.abs))
    const ticks = niceTicks(-maxAbs, maxAbs, 5)
    const yScale = linearScale(ticks[0], ticks[ticks.length - 1], H - PAD.bottom, PAD.top)
    return { mode: 'bars' as const, xOf, barW, yScale, ticks }
  }, [axis, node, deltas, deltaMode, width])

  const zeroY = model ? model.yScale(0) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/60 overflow-hidden text-xs" role="group" aria-label="Delta chart form">
            {(['bars', 'waterfall'] as const).map(m => (
              <button key={m} type="button" aria-pressed={deltaMode === m} onClick={() => onDeltaModeChange(m)}
                className={cn('px-2.5 py-1', deltaMode === m ? 'bg-brand-500/20 text-ink-primary' : 'text-ink-secondary hover:text-ink-primary')}>
                {m === 'bars' ? 'Bars' : 'Waterfall'}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-border/60 overflow-hidden text-xs" role="group" aria-label="Delta unit">
            {(['amount', 'percent'] as const).map(u => (
              <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}
                className={cn('px-2.5 py-1', unit === u ? 'bg-brand-500/20 text-ink-primary' : 'text-ink-secondary hover:text-ink-primary')}>
                {u === 'amount' ? 'Δ Amount' : 'Δ %'}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setShowTable(v => !v)}>
          {showTable ? 'Hide table' : 'Table view'}
        </button>
      </div>

      {populatedCount < 2 ? (
        <p className="text-xs text-ink-muted py-8 text-center">Need at least two populated periods for a delta.</p>
      ) : (
        <div ref={containerRef} className="w-full">
          {model && !showTable && (
            <svg
              width={width}
              height={H}
              viewBox={`0 0 ${width} ${H}`}
              role="img"
              tabIndex={0}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
              aria-label={`Period-over-period ${deltaMode === 'waterfall' ? 'waterfall of running balance' : `${unit === 'amount' ? 'change in amount' : 'change in percent'}`} across ${axis.length} periods`}
              onMouseMove={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const mx = e.clientX - rect.left - PAD.left
                const stepW = axis.length > 1 ? (width - PAD.left - PAD.right) / (axis.length - 1) : 1
                setHover(Math.max(0, Math.min(axis.length - 1, Math.round(mx / stepW))))
              }}
              onMouseLeave={() => setHover(null)}
              style={{ display: 'block' }}
            >
              {model.ticks.map((t, i) => (
                <line key={i} x1={PAD.left} y1={model.yScale(t)} x2={width - PAD.right} y2={model.yScale(t)} stroke="currentColor" strokeOpacity={0.07} />
              ))}
              {model.ticks.map((t, i) => (
                <text key={`l${i}`} x={PAD.left - 6} y={model.yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {deltaMode === 'bars' && unit === 'percent' ? `${t.toFixed(0)}%` : fmtAxisNumber(t)}
                </text>
              ))}
              <line x1={PAD.left} y1={zeroY} x2={width - PAD.right} y2={zeroY} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.25} />
              {thinLabelIndices(axis.length).map(i => (
                <text key={`x${i}`} x={model.xOf(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>{axis[i].label}</text>
              ))}

              {deltaMode === 'waterfall'
                ? node.balance.map((bal, i) => {
                    if (bal === null) return null
                    const prevIdx = lastPrev(node.balance, i)
                    const prev = prevIdx >= 0 ? (node.balance[prevIdx] as number) : 0
                    const y1 = model.yScale(prev)
                    const y2 = model.yScale(bal)
                    const up = bal >= prev
                    return (
                      <rect
                        key={i}
                        x={model.xOf(i) - model.barW / 2}
                        y={Math.min(y1, y2)}
                        width={model.barW}
                        height={Math.max(1, Math.abs(y2 - y1))}
                        rx={2}
                        fill={prevIdx < 0 ? '#64748B' : up ? GAIN : LOSS}
                        fillOpacity={0.9}
                      />
                    )
                  })
                : deltas.map((d, i) => {
                    if (d === null) return null
                    const y = model.yScale(d)
                    const up = d >= 0
                    return (
                      <rect
                        key={i}
                        x={model.xOf(i) - model.barW / 2}
                        y={up ? y : zeroY}
                        width={model.barW}
                        height={Math.max(1, Math.abs(y - zeroY))}
                        rx={2}
                        fill={up ? GAIN : LOSS}
                        fillOpacity={0.9}
                      />
                    )
                  })}

              {hover !== null && (
                <ChartTooltip
                  anchorX={model.xOf(hover)}
                  top={PAD.top}
                  containerWidth={width}
                  title={formatPeriodLabel(axis[hover])}
                  rows={deltaRows(node, hover)}
                />
              )}
            </svg>
          )}
          {showTable && (
            <table className="w-full text-xs border-collapse">
              <caption className="sr-only">Period-over-period delta table</caption>
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 text-ink-muted font-medium">Period</th>
                  <th className="text-right px-2 py-1 text-ink-muted font-medium">Balance</th>
                  <th className="text-right px-2 py-1 text-ink-muted font-medium">Δ Amount</th>
                  <th className="text-right px-2 py-1 text-ink-muted font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {axis.map((p, i) => (
                  <tr key={p.label} className="border-t border-border/30">
                    <td className="px-2 py-1 text-ink-secondary">{formatPeriodLabel(p)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-primary">{fmtBalance(node.balance[i])}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-primary">
                      {node.balance[i] !== null && node.deltaAmount[i] === null ? NO_PRIOR_DATA : fmtDeltaAmount(node.deltaAmount[i])}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-primary">{fmtDeltaPercent(node.deltaPercent[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function lastPrev(series: (number | null)[], i: number): number {
  for (let k = i - 1; k >= 0; k--) if (series[k] !== null) return k
  return -1
}

function deltaRows(node: AnalysisSeries, i: number) {
  const prevIdx = lastPrev(node.balance, i)
  const rows = [
    { label: 'Balance', value: fmtBalance(node.balance[i]) },
    {
      label: 'Δ amount',
      value: node.balance[i] !== null && node.deltaAmount[i] === null ? NO_PRIOR_DATA : fmtDeltaAmount(node.deltaAmount[i]),
    },
    { label: 'Δ %', value: fmtDeltaPercent(node.deltaPercent[i]) },
  ]
  if (prevIdx >= 0 && prevIdx !== i - 1) {
    rows.push({ label: 'compared vs', value: 'last populated period' })
  }
  return rows
}
