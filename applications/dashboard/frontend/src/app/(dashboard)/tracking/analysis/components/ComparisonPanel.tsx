'use client'

import { cn } from '@/lib/utils'
import { ChartCard } from './ChartCard'
import { deltaArrow, deltaColorClass, fmtBalance, fmtDeltaAmount, fmtDeltaPercent, NO_DATA_DASH } from '@/lib/tracking-format'

export interface ComparisonRowModel {
  name: string
  valueA: number | null
  valueB: number | null
  delta: number | null
  deltaPercent: number | null
}

export interface ComparisonPanelModel {
  ok: boolean
  note: string | null
  headerLabel: string
  periodALabel: string
  periodBLabel: string
  rows: ComparisonRowModel[]
  total: ComparisonRowModel
}

/**
 * FR-9 / FR-10 / §4.5f — dedicated bottom panel (not a chart overlay).
 * Paired bars per current group-by bucket (A muted, B brand) + a table with
 * value A, value B, Δ, Δ%, and a bold lens-total row. Header states the exact
 * resolved periods and any gap fallback.
 */
export function ComparisonPanel({ model }: { model: ComparisonPanelModel }) {
  if (!model.ok) {
    return (
      <ChartCard title="Period comparison" subtitle={model.headerLabel}>
        <p className="text-xs text-ink-muted py-6 text-center">{model.note ?? 'Comparison unavailable.'}</p>
      </ChartCard>
    )
  }

  const maxVal = Math.max(
    1,
    ...[...model.rows, model.total].flatMap(r => [Math.abs(r.valueA ?? 0), Math.abs(r.valueB ?? 0)]),
  )

  return (
    <ChartCard title="Period comparison" subtitle={model.headerLabel}>
      {model.note && <p className="text-xs text-warning mb-2">{model.note}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ul className="space-y-2" aria-label="Comparison bars">
          {model.rows.map(r => (
            <li key={r.name} className="text-xs space-y-1">
              <span className="text-ink-secondary">{r.name}</span>
              <div className="flex items-center gap-1">
                <div className="flex-1 h-3 bg-surface-elevated rounded-sm overflow-hidden">
                  <div className="h-full bg-ink-muted/60" style={{ width: `${((Math.abs(r.valueA ?? 0)) / maxVal) * 100}%` }} />
                </div>
                <span className="w-24 text-right tabular-nums text-ink-muted">{fmtBalance(r.valueA)}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="flex-1 h-3 bg-surface-elevated rounded-sm overflow-hidden">
                  <div className="h-full bg-brand-500/70" style={{ width: `${((Math.abs(r.valueB ?? 0)) / maxVal) * 100}%` }} />
                </div>
                <span className="w-24 text-right tabular-nums text-ink-primary">{fmtBalance(r.valueB)}</span>
              </div>
            </li>
          ))}
        </ul>

        <table className="w-full text-xs border-collapse self-start">
          <caption className="sr-only">Comparison values table</caption>
          <thead>
            <tr>
              <th className="text-left px-2 py-1 text-ink-muted font-medium">Bucket</th>
              <th className="text-right px-2 py-1 text-ink-muted font-medium">{model.periodALabel}</th>
              <th className="text-right px-2 py-1 text-ink-muted font-medium">{model.periodBLabel}</th>
              <th className="text-right px-2 py-1 text-ink-muted font-medium">Δ</th>
              <th className="text-right px-2 py-1 text-ink-muted font-medium">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map(r => <CmpRow key={r.name} r={r} />)}
          </tbody>
          <tfoot>
            <CmpRow r={model.total} bold />
          </tfoot>
        </table>
      </div>
    </ChartCard>
  )
}

function CmpRow({ r, bold }: { r: ComparisonRowModel; bold?: boolean }) {
  return (
    <tr className={cn('border-t border-border/30', bold && 'font-semibold text-ink-primary')}>
      <td className="px-2 py-1">{r.name}</td>
      <td className="px-2 py-1 text-right tabular-nums">{r.valueA === null ? NO_DATA_DASH : fmtBalance(r.valueA)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{r.valueB === null ? NO_DATA_DASH : fmtBalance(r.valueB)}</td>
      <td className={cn('px-2 py-1 text-right tabular-nums', deltaColorClass(r.delta))}>
        <span aria-hidden="true">{deltaArrow(r.delta)}</span> {r.delta === null ? NO_DATA_DASH : fmtDeltaAmount(r.delta)}
      </td>
      <td className="px-2 py-1 text-right tabular-nums">{r.deltaPercent === null ? NO_DATA_DASH : fmtDeltaPercent(r.deltaPercent)}</td>
    </tr>
  )
}
