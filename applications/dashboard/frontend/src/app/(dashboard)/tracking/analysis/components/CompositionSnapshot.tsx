'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPeriodLabel } from '@/components/charts/svg-primitives'
import { fmtBalance, fmtSharePercent, NO_DATA_DASH } from '@/lib/tracking-format'
import type { CompositionResult } from '@/lib/tracking-analysis'
import type { AnalysisSeries, AxisPoint } from '../types'

/**
 * FR-6 / §4.5c — ranked horizontal bars for a single period (value or share
 * toggle) with a ◀ ▶ stepper across populated periods and a dropdown. Null
 * buckets render a short "no data" tick, sorted last. Bar click → drill.
 *
 * Share values come from the SAME `computeComposition` result the
 * `CompositionChart` uses (`bucketBalance / lens-aggregate periodTotal`,
 * 0.1%-rounded, last-band residual) so the two panels can never disagree —
 * they are not recomputed locally.
 */
export function CompositionSnapshot({
  axis,
  buckets,
  composition,
  periodIndex,
  onPeriodChange,
  onDrill,
}: {
  axis: AxisPoint[]
  buckets: AnalysisSeries[]
  composition: CompositionResult
  periodIndex: number
  onPeriodChange: (index: number) => void
  onDrill: (drillId: string) => void
}) {
  const [mode, setMode] = useState<'value' | 'share'>('value')

  const populatedIdxs = useMemo(
    () => axis.map((_, i) => i).filter(i => buckets.some(b => b.balance[i] !== null)),
    [axis, buckets],
  )
  const safeIdx = axis[periodIndex] ? periodIndex : populatedIdxs[populatedIdxs.length - 1] ?? 0
  const posInPopulated = populatedIdxs.indexOf(safeIdx)

  const rows = useMemo(() => {
    return buckets
      .map((b, bi) => ({
        id: b.id,
        label: b.label,
        color: b.color,
        drillId: b.drillId,
        value: b.balance[safeIdx],
        share: composition.sharePercent[bi]?.[safeIdx] ?? null,
      }))
      .sort((a, z) => {
        if (a.value === null && z.value === null) return 0
        if (a.value === null) return 1
        if (z.value === null) return -1
        return z.value - a.value
      })
  }, [buckets, composition, safeIdx])

  const maxVal = Math.max(1, ...rows.map(r => (mode === 'share' ? r.share ?? 0 : r.value ?? 0)))
  const step = (dir: -1 | 1) => {
    const next = populatedIdxs[posInPopulated + dir]
    if (next !== undefined) onPeriodChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-icon" aria-label="Previous populated period" disabled={posInPopulated <= 0} onClick={() => step(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <select
            className="input text-xs py-1"
            aria-label="Snapshot period"
            value={safeIdx}
            onChange={e => onPeriodChange(Number(e.target.value))}
          >
            {populatedIdxs.map(i => <option key={i} value={i}>{formatPeriodLabel(axis[i])}</option>)}
          </select>
          <button type="button" className="btn-icon" aria-label="Next populated period" disabled={posInPopulated < 0 || posInPopulated >= populatedIdxs.length - 1} onClick={() => step(1)}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-border/60 overflow-hidden text-xs" role="group" aria-label="Snapshot unit">
          {(['value', 'share'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={cn('px-2.5 py-1', mode === m ? 'bg-brand-500/20 text-ink-primary' : 'text-ink-secondary hover:text-ink-primary')}>
              {m === 'value' ? 'Value' : 'Share %'}
            </button>
          ))}
        </div>
      </div>

      <ul
        className="space-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
        tabIndex={0}
        aria-label={`Breakdown by bucket for ${axis[safeIdx] ? formatPeriodLabel(axis[safeIdx]) : 'the selected period'}, ranked by value`}
      >
        {rows.map(r => {
          const q = mode === 'share' ? r.share : r.value
          const pct = q === null ? 0 : (q / maxVal) * 100
          return (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="w-28 shrink-0 text-left text-ink-secondary hover:text-ink-primary truncate disabled:hover:text-ink-secondary"
                disabled={!r.drillId}
                onClick={() => r.drillId && onDrill(r.drillId)}
              >
                {r.label}
              </button>
              <div className="flex-1 h-4 bg-surface-elevated rounded-sm overflow-hidden">
                {q !== null
                  ? <div className="h-full rounded-sm" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: r.color }} />
                  : <div className="h-full w-1 bg-ink-disabled" title="no data" />}
              </div>
              <span className="w-24 text-right tabular-nums text-ink-primary">
                {q === null ? `${NO_DATA_DASH} no data` : mode === 'share' ? fmtSharePercent(q) : fmtBalance(q)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
