'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  buildStackedAreaPaths,
  ChartTooltip,
  formatPeriodLabel,
  linearScale,
  thinLabelIndices,
} from '@/components/charts/svg-primitives'
import { fmtBalance, fmtSharePercent } from '@/lib/tracking-format'
import type { CompositionResult } from '@/lib/tracking-analysis'
import type { AnalysisSeries, AxisPoint } from '../types'

const H = 280
const PAD = { top: 12, right: 12, bottom: 26, left: 40 }

/**
 * FR-6 / §4.5b — 100%-stacked area over time (toggle to absolute stacked
 * area). One band per bucket, stack order stable by the incoming bucket
 * order. Hover → per-bucket share % + absolute value. Band click → drill.
 */
export function CompositionChart({
  axis,
  buckets,
  composition,
  onDrill,
}: {
  axis: AxisPoint[]
  buckets: AnalysisSeries[]
  composition: CompositionResult
  onDrill: (drillId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  const [mode, setMode] = useState<'share' | 'absolute'>('share')
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(el.clientWidth || 520)
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.max(280, Math.floor(e.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layers = mode === 'share' ? composition.sharePercent : composition.absolute

  const model = useMemo(() => {
    if (axis.length === 0 || buckets.length === 0) return null
    const innerW = width - PAD.left - PAD.right
    const xs = axis.map((_, i) => PAD.left + (axis.length > 1 ? (i / (axis.length - 1)) * innerW : innerW / 2))
    let yMax = 100
    if (mode === 'absolute') {
      yMax = 1
      for (let p = 0; p < axis.length; p++) {
        let sum = 0
        for (let b = 0; b < buckets.length; b++) sum += composition.absolute[b][p] ?? 0
        if (sum > yMax) yMax = sum
      }
    }
    const yScale = linearScale(0, yMax, H - PAD.bottom, PAD.top)
    const paths = buildStackedAreaPaths(layers, xs, yScale)
    const xTicks = thinLabelIndices(axis.length).map(i => ({ x: xs[i], label: axis[i].label }))
    return { xs, yScale, paths, xTicks }
  }, [axis, buckets, composition, layers, mode, width])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-border/60 overflow-hidden text-xs" role="group" aria-label="Composition mode">
          {(['share', 'absolute'] as const).map(m => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn('px-2.5 py-1', mode === m ? 'bg-brand-500/20 text-ink-primary' : 'text-ink-secondary hover:text-ink-primary')}
            >
              {m === 'share' ? '100% share' : 'Absolute'}
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
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
            aria-label={`Composition over time by ${buckets.length} buckets, ${mode === 'share' ? 'percentage share' : 'absolute value'}`}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - rect.left - PAD.left
              const step = axis.length > 1 ? (width - PAD.left - PAD.right) / (axis.length - 1) : 1
              setHover(Math.max(0, Math.min(axis.length - 1, Math.round(mx / step))))
            }}
            onMouseLeave={() => setHover(null)}
            style={{ display: 'block' }}
          >
            {model.paths.map((d, b) => (
              <path
                key={buckets[b].id}
                data-testid={`composition-band-${buckets[b].id}`}
                d={d}
                fill={buckets[b].color}
                fillOpacity={0.85}
                stroke="#131929"
                strokeWidth={0.75}
                onClick={() => buckets[b].drillId && onDrill(buckets[b].drillId as string)}
                style={{ cursor: buckets[b].drillId ? 'pointer' : 'default' }}
              />
            ))}
            {hover !== null && (
              <>
                <line x1={model.xs[hover]} y1={PAD.top} x2={model.xs[hover]} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4,3" />
                <ChartTooltip
                  anchorX={model.xs[hover]}
                  top={PAD.top}
                  containerWidth={width}
                  title={formatPeriodLabel(axis[hover])}
                  rows={buckets.map((bk, b) => ({
                    label: bk.label,
                    color: bk.color,
                    value: `${fmtSharePercent(composition.sharePercent[b][hover])} · ${fmtBalance(composition.absolute[b][hover])}`,
                  }))}
                />
              </>
            )}
          </svg>
        )}
        {showTable && (
          <table className="w-full text-xs border-collapse">
            <caption className="sr-only">Composition data table (share % / absolute)</caption>
            <thead>
              <tr>
                <th className="text-left px-2 py-1 text-ink-muted font-medium">Period</th>
                {buckets.map(b => <th key={b.id} className="text-right px-2 py-1 text-ink-muted font-medium">{b.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {axis.map((p, i) => (
                <tr key={p.label} className="border-t border-border/30">
                  <td className="px-2 py-1 text-ink-secondary">{formatPeriodLabel(p)}</td>
                  {buckets.map((b, bi) => (
                    <td key={b.id} className="px-2 py-1 text-right tabular-nums text-ink-primary">
                      {fmtSharePercent(composition.sharePercent[bi][i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap" role="list" aria-label="Composition legend">
        {buckets.map(b => (
          <span key={b.id} role="listitem" className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} aria-hidden="true" />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}
