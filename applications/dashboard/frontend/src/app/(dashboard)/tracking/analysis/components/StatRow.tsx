'use client'

import { cn } from '@/lib/utils'
import {
  BAHT,
  deltaArrow,
  deltaColorClass,
  fmtBalance,
  fmtDeltaAmount,
  fmtDeltaPercent,
} from '@/lib/tracking-format'
import type { StatRowModel } from '@/lib/tracking-analysis'

/**
 * FR-8 / §4.5e — five always-visible KPI tiles for the current lens + drill
 * node + granularity. Scope-aware (SD-OQ-1): fed by the same node-total
 * series as the Scoped Dashboard's scope-total, so figures always match.
 */
export function StatRow({ model, cleared }: { model: StatRowModel; cleared?: boolean }) {
  if (cleared) {
    return (
      <div className="card p-4 text-xs text-ink-muted">
        No qualifying data for the current lens at this level — KPIs cleared.
      </div>
    )
  }

  const tiles: { label: string; value: string; chip?: { text: string; n: number | null } }[] = [
    {
      label: 'Latest value',
      value: model.latestValue === null ? '—' : fmtBalance(model.latestValue),
      chip: model.latestPeriodLabel ? { text: model.latestPeriodLabel, n: null } : undefined,
    },
    {
      label: 'Latest change',
      value: model.latestDeltaAmount === null ? 'No prior data' : fmtDeltaAmount(model.latestDeltaAmount),
      chip:
        model.latestDeltaAmount === null
          ? undefined
          : { text: model.latestDeltaPercent === null ? `n/a (prior was ${BAHT}0)` : fmtDeltaPercent(model.latestDeltaPercent), n: model.latestDeltaAmount },
    },
    {
      label: 'Change over range',
      value: model.rangeChangeAmount === null ? '—' : fmtDeltaAmount(model.rangeChangeAmount),
      chip:
        model.rangeChangeAmount === null
          ? model.rangeSpanLabel ? { text: model.rangeSpanLabel, n: null } : undefined
          : { text: model.rangeChangePercent === null ? 'n/a' : fmtDeltaPercent(model.rangeChangePercent), n: model.rangeChangeAmount },
    },
    {
      label: 'Annualized change',
      value: model.annualisedPercent === null ? 'n/a' : fmtDeltaPercent(model.annualisedPercent),
      chip: model.rangeSpanLabel ? { text: model.rangeSpanLabel, n: null } : undefined,
    },
    {
      label: 'Populated periods',
      value: `${model.populatedCount} / ${model.totalPeriods}`,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3" role="list" aria-label="Key figures">
      {tiles.map(t => (
        <div key={t.label} role="listitem" className="card p-3 space-y-1">
          <p className="metric-label">{t.label}</p>
          <p className="text-lg font-bold text-ink-primary tabular-nums">{t.value}</p>
          {t.chip && (
            <p
              className={cn(
                'text-xs font-medium flex items-center gap-1',
                t.chip.n === null ? 'text-ink-muted' : deltaColorClass(t.chip.n),
              )}
            >
              {t.chip.n !== null && <span aria-hidden="true">{deltaArrow(t.chip.n)}</span>}
              {t.chip.text}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
