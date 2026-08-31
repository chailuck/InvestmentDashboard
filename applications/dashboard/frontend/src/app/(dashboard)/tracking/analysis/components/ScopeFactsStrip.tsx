'use client'

import { fmtBalance, fmtDeltaAmount, fmtDeltaPercent, NO_DATA_DASH } from '@/lib/tracking-format'
import type { ScopeFacts } from '@/lib/tracking-analysis'

/**
 * §4.9.2 / AC-SD-10 — leaf-scope coverage facts: first / last populated
 * period, populated-period count, peak + trough (with periods), net change,
 * latest Δ. Shown only at drill depth 3.
 */
export function ScopeFactsStrip({ facts }: { facts: ScopeFacts }) {
  const cells: { label: string; value: string; hint?: string | null }[] = [
    { label: 'First populated', value: facts.firstPopulatedLabel ?? NO_DATA_DASH },
    { label: 'Last populated', value: facts.lastPopulatedLabel ?? NO_DATA_DASH },
    { label: 'Populated periods', value: String(facts.populatedCount) },
    { label: 'Peak', value: fmtBalance(facts.peakValue), hint: facts.peakLabel },
    { label: 'Trough', value: fmtBalance(facts.troughValue), hint: facts.troughLabel },
    { label: 'Net change', value: facts.netChange === null ? NO_DATA_DASH : fmtDeltaAmount(facts.netChange) },
    {
      label: 'Latest Δ',
      value:
        facts.latestDeltaAmount === null
          ? NO_DATA_DASH
          : `${fmtDeltaAmount(facts.latestDeltaAmount)}${facts.latestDeltaPercent === null ? '' : ` (${fmtDeltaPercent(facts.latestDeltaPercent)})`}`,
    },
  ]
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
      {cells.map(c => (
        <div key={c.label} className="card-elevated p-2">
          <dt className="text-ink-muted uppercase tracking-wide text-[10px]">{c.label}</dt>
          <dd className="text-ink-primary tabular-nums mt-0.5">
            {c.value}
            {c.hint && <span className="text-ink-muted"> · {c.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
