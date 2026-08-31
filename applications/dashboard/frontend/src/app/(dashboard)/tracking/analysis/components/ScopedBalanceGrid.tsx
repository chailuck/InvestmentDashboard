'use client'

import { Fragment, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fmtBalance, fmtDeltaAmount, fmtDeltaPercent, NO_DATA_DASH, NO_PRIOR_DATA } from '@/lib/tracking-format'
import { yearlyRowView, type ScopedGrid, type ScopedRow } from '@/lib/tracking-analysis'
import type { Granularity, Measure } from '../types'

/**
 * §4.9.4 — pure presentational grid. Renders the per-year quarterly
 * sub-tables OR the single yearly "as-of year end" table from the normalized
 * `ScopedGrid` row list. Never applies the chart-only leading/trailing trim
 * to quarters (every quarter column is shown); it DOES trim whole
 * leading/trailing all-blank years, keeping interior all-blank years.
 */
export function ScopedBalanceGrid({
  scoped,
  granularity,
  measure,
  onDrillItem,
}: {
  scoped: ScopedGrid
  granularity: Granularity
  measure: Measure
  onDrillItem: (itemId: string) => void
}) {
  const allRows = [...scoped.rows]
  const years = useMemo(() => {
    const ys = [...new Set(scoped.axis.map(p => p.year))].sort((a, b) => b - a)
    // trim leading/trailing whole years with no data across every rendered row
    const rowsForTrim = [...scoped.rows, ...scoped.exclusiveRows]
    const yearHasData = (y: number) =>
      scoped.axis.some((p, i) => p.year === y && rowsForTrim.some(r => r.hasData[i]))
    let lo = 0
    let hi = ys.length - 1
    while (lo <= hi && !yearHasData(ys[lo])) lo++
    while (hi >= lo && !yearHasData(ys[hi])) hi--
    return lo > hi ? ys : ys.slice(lo, hi + 1)
  }, [scoped])

  const deltaFmt = (amount: number | null, percent: number | null, hasData: boolean, hasPrev: boolean) => {
    if (!hasData) return NO_DATA_DASH
    if (!hasPrev) return NO_PRIOR_DATA
    return measure === 'deltaPercent' ? fmtDeltaPercent(percent) : fmtDeltaAmount(amount)
  }

  const rowClass = (r: ScopedRow) =>
    cn(
      'border-t border-border/30',
      (r.kind === 'scopeTotal' || r.kind === 'subCategorySubtotal') && 'font-semibold text-ink-primary',
      (r.kind === 'splitProperty' || r.kind === 'splitNonProperty') && 'text-ink-secondary italic',
      r.indent === 1 && '[&>td:first-child]:pl-6',
    )

  const labelCell = (r: ScopedRow) =>
    r.kind === 'item' && r.itemId ? (
      <button type="button" className="text-left text-brand-400 hover:underline" onClick={() => onDrillItem(r.itemId as string)}>
        {r.label}
        {r.exclusive && <span className="ml-1 badge-neutral">exclusive</span>}
      </button>
    ) : (
      <span>{r.label}</span>
    )

  const footnote = scoped.completeness
  const footText =
    scoped.emptyState.kind === 'noPopulatedPeriods'
      ? `0 of ${footnote.total} periods populated`
      : `${footnote.populated} of ${footnote.total} periods populated` +
        (footnote.firstLabel ? ` · first ${footnote.firstLabel}` : '') +
        (footnote.lastLabel ? ` · last ${footnote.lastLabel}` : '')

  if (granularity === 'yearly') {
    const asOfByRow = allRows.map(r => yearlyRowView(r, scoped.axis))
    const headerAsOf = asOfByRow[0]
    return (
      <div className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <caption className="sr-only">Scoped yearly as-of balance grid</caption>
            <thead>
              <tr className="text-ink-muted">
                <th className="text-left px-2 py-1 font-medium">Row</th>
                {years.map(y => {
                  const yp = headerAsOf?.years.find(v => v.year === y)
                  return (
                    <th key={y} colSpan={2} className="text-right px-2 py-1 font-medium">
                      {y}{yp?.asOfQuarter ? ` (as of Q${yp.asOfQuarter})` : ''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {allRows.map((r, ri) => {
                const yv = asOfByRow[ri]
                return (
                  <tr key={r.key} className={rowClass(r)}>
                    <td className="px-2 py-1">{labelCell(r)}</td>
                    {years.map(y => {
                      const idx = yv.years.findIndex(v => v.year === y)
                      const point = yv.years[idx]
                      const hasData = !!point && point.value !== null
                      return (
                        <Fragment key={y}>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-primary">
                            {hasData ? fmtBalance(point.value) : NO_DATA_DASH}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-muted">
                            {deltaFmt(yv.deltaAmount[idx] ?? null, yv.deltaPercent[idx] ?? null, hasData, yv.hasPreviousData[idx] ?? false)}
                          </td>
                        </Fragment>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {scoped.splitNote && <p className="text-xs text-ink-muted italic">{scoped.splitNote}</p>}
        <ExclusiveBlock rows={scoped.exclusiveRows} onDrillItem={onDrillItem} />
        <p className="text-xs text-ink-muted">{footText}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {years.map(year => {
        const quarters = scoped.axis.filter(p => p.year === year)
        return (
          <div key={year} className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <caption className="sr-only">Scoped quarterly balance grid — {year}</caption>
              <thead>
                <tr className="text-ink-muted">
                  <th className="text-left px-2 py-1 font-medium">{year}</th>
                  {quarters.map(q => (
                    <th key={q.quarter} colSpan={2} className="text-right px-2 py-1 font-medium">Q{q.quarter}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.map(r => (
                  <tr key={r.key} className={rowClass(r)}>
                    <td className="px-2 py-1">{labelCell(r)}</td>
                    {quarters.map(q => {
                      const i = q.index
                      const hasData = r.hasData[i]
                      return (
                        <Fragment key={q.quarter}>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-primary">
                            {hasData ? fmtBalance(r.balance[i]) : NO_DATA_DASH}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-muted">
                            {deltaFmt(r.deltaAmount[i], r.deltaPercent[i], hasData, r.hasPreviousData[i])}
                          </td>
                        </Fragment>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      {scoped.splitNote && <p className="text-xs text-ink-muted italic">{scoped.splitNote}</p>}
      <ExclusiveBlock rows={scoped.exclusiveRows} onDrillItem={onDrillItem} />
      <p className="text-xs text-ink-muted">{footText}</p>
    </div>
  )
}

function ExclusiveBlock({ rows, onDrillItem }: { rows: ScopedRow[]; onDrillItem: (id: string) => void }) {
  if (rows.length === 0) return null
  return (
    <div className="border border-border/40 rounded-lg p-2 space-y-1">
      <p className="text-xs font-medium text-ink-secondary">Excluded from total (exclusive)</p>
      <ul className="text-xs space-y-0.5">
        {rows.map(r => (
          <li key={r.key}>
            <button type="button" className="text-brand-400 hover:underline" onClick={() => r.itemId && onDrillItem(r.itemId)}>
              {r.label}
            </button>
            <span className="ml-1 badge-neutral">exclusive</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
