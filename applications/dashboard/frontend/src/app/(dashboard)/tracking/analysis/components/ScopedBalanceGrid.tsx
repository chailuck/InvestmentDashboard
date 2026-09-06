'use client'

import { Fragment, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fmtBalance, fmtDeltaAmount, fmtDeltaPercent, NO_PRIOR_DATA } from '@/lib/tracking-format'
import {
  balanceGrid,
  balanceValueClass,
  deltaSignClass,
  useSharedBalanceColWidths,
  type BalanceEmphasis,
  type BalanceWidthRow,
} from '@/components/tracking/balanceGridStyles'
import { yearlyRowView, type ScopedGrid, type ScopedRow } from '@/lib/tracking-analysis'
import type { Granularity, Measure } from '../types'

/**
 * §4.9.4 — pure presentational grid. Renders the per-year quarterly
 * sub-tables OR the single yearly "as-of year end" table from the normalized
 * `ScopedGrid` row list. Never applies the chart-only leading/trailing trim
 * to quarters (every quarter column is shown); it DOES trim whole
 * leading/trailing all-blank years, keeping interior all-blank years.
 *
 * Visual styling (column widths, header, group borders, row emphasis, blank
 * / gain-loss colour coding) is deliberately identical to the main
 * Tracking / Dashboard year table — the shared tokens live in
 * `@/components/tracking/balanceGridStyles`.
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

  // The exact Balance / Delta strings this grid will render — passed to the
  // shared width helper so every per-year sub-table's columns line up, and
  // keyed off `measure` (Δ amount vs Δ%) so the Delta column is sized for
  // whichever it actually shows.
  const fmt = useMemo(
    () => ({
      balance: (v: number) => fmtBalance(v),
      deltaText: (amount: number, percent: number | null) =>
        measure === 'deltaPercent'
          ? fmtDeltaPercent(percent)
          : percent !== null
            ? `${fmtDeltaAmount(amount)} (${fmtDeltaPercent(percent)})`
            : fmtDeltaAmount(amount),
    }),
    [measure],
  )

  // Width sample set: quarterly measures the raw per-quarter series; yearly
  // measures the derived "as-of year end" series (its own values + its own
  // year-over-year deltas), since that is what the yearly table renders.
  const widthRows = useMemo<BalanceWidthRow[]>(() => {
    const base = [...scoped.rows, ...scoped.exclusiveRows]
    if (granularity !== 'yearly') return base
    return base.map(r => {
      const yv = yearlyRowView(r, scoped.axis)
      return {
        balance: yv.years.map(y => y.value),
        deltaAmount: yv.deltaAmount,
        deltaPercent: yv.deltaPercent,
        hasData: yv.years.map(y => y.value !== null),
        hasPreviousData: yv.hasPreviousData,
      }
    })
  }, [scoped, granularity])

  const colW = useSharedBalanceColWidths(widthRows, fmt)
  const inlineWidth = (w: string) => ({ width: w, minWidth: w, maxWidth: w })

  // ── row / label-cell / value emphasis, keyed off row kind ────────────────
  const rowMeta = (
    r: ScopedRow,
  ): { row: string; labelTd: string; emphasis: BalanceEmphasis } => {
    switch (r.kind) {
      case 'scopeTotal':
        return { row: balanceGrid.grandRow, labelTd: balanceGrid.grandLabelTd, emphasis: 'grand' }
      case 'subCategorySubtotal':
        return {
          row: balanceGrid.subtotalRow,
          labelTd: cn(balanceGrid.subtotalLabelTd, r.indent === 1 ? 'pl-8' : 'pl-3'),
          emphasis: 'strong',
        }
      case 'item':
        return {
          row: balanceGrid.itemRow,
          labelTd: cn(balanceGrid.itemLabelTd, r.indent === 1 ? 'pl-14' : 'pl-6'),
          emphasis: 'normal',
        }
      case 'splitProperty':
      case 'splitNonProperty':
        return {
          row: cn(balanceGrid.plainRow, 'text-ink-secondary italic'),
          labelTd: cn(balanceGrid.plainLabelTd, 'pl-6'),
          emphasis: 'normal',
        }
      default:
        return { row: balanceGrid.plainRow, labelTd: balanceGrid.plainLabelTd, emphasis: 'normal' }
    }
  }

  const balanceCell = (
    emphasis: BalanceEmphasis,
    hasData: boolean,
    value: number | null | undefined,
    groupBorder: boolean,
  ) => (
    <td
      className={cn(
        balanceGrid.balanceTd,
        emphasis === 'grand' ? 'text-sm' : 'text-xs',
        groupBorder && balanceGrid.groupBorder,
      )}
      style={inlineWidth(colW.balance)}
    >
      {!hasData || value === null || value === undefined ? (
        <span className={balanceGrid.blankSpan}>{balanceGrid.blankGlyph}</span>
      ) : (
        <span className={balanceValueClass(emphasis)}>{fmtBalance(value)}</span>
      )}
    </td>
  )

  const deltaCell = (
    amount: number | null | undefined,
    percent: number | null | undefined,
    hasData: boolean,
    hasPrev: boolean,
  ) => {
    const w = inlineWidth(colW.delta)
    if (!hasData || !hasPrev) {
      return (
        <td className={balanceGrid.deltaTd} style={w}>
          <span
            className={balanceGrid.blankSpan}
            title={hasData && !hasPrev ? NO_PRIOR_DATA : undefined}
          >
            {balanceGrid.blankGlyph}
          </span>
        </td>
      )
    }
    if (amount === null || amount === undefined) {
      return (
        <td className={balanceGrid.deltaTd} style={w}>
          <span className={balanceGrid.blankSpan}>{balanceGrid.blankGlyph}</span>
        </td>
      )
    }
    const isPercentMeasure = measure === 'deltaPercent'
    const signed = isPercentMeasure ? percent ?? amount : amount
    return (
      <td className={balanceGrid.deltaTd} style={w}>
        <span className={balanceGrid.deltaWrap}>
          <span className={cn(balanceGrid.deltaAmountSpan, deltaSignClass(signed))}>
            {isPercentMeasure ? fmtDeltaPercent(percent) : fmtDeltaAmount(amount)}
          </span>
          {!isPercentMeasure && percent !== null && percent !== undefined && (
            <span className={balanceGrid.deltaPercentSpan}>({fmtDeltaPercent(percent)})</span>
          )}
        </span>
      </td>
    )
  }

  const labelCell = (r: ScopedRow) =>
    r.kind === 'item' && r.itemId ? (
      <button
        type="button"
        className="text-left text-brand-400 hover:underline"
        onClick={() => onDrillItem(r.itemId as string)}
      >
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
          <table className={balanceGrid.table}>
            <caption className="sr-only">Scoped yearly as-of balance grid</caption>
            <thead>
              <tr className={balanceGrid.headRow}>
                <th scope="col" className={balanceGrid.headLabelTh}>Row</th>
                {years.map((y, yi) => {
                  const yp = headerAsOf?.years.find(v => v.year === y)
                  const asOf = yp?.asOfQuarter ? ` (as of Q${yp.asOfQuarter})` : ''
                  return (
                    <Fragment key={y}>
                      <th
                        scope="col"
                        className={cn(balanceGrid.headValueTh, yi > 0 && balanceGrid.groupBorder)}
                        style={inlineWidth(colW.balance)}
                      >
                        {y}
                        {asOf}
                      </th>
                      <th scope="col" className={balanceGrid.headValueTh} style={inlineWidth(colW.delta)}>
                        Δ
                      </th>
                    </Fragment>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {allRows.map((r, ri) => {
                const yv = asOfByRow[ri]
                const meta = rowMeta(r)
                return (
                  <tr key={r.key} className={meta.row}>
                    <td className={meta.labelTd}>{labelCell(r)}</td>
                    {years.map((y, yi) => {
                      const idx = yv.years.findIndex(v => v.year === y)
                      const point = yv.years[idx]
                      const hasData = !!point && point.value !== null
                      return (
                        <Fragment key={y}>
                          {balanceCell(meta.emphasis, hasData, point?.value ?? null, yi > 0)}
                          {deltaCell(
                            yv.deltaAmount[idx] ?? null,
                            yv.deltaPercent[idx] ?? null,
                            hasData,
                            yv.hasPreviousData[idx] ?? false,
                          )}
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
            <table className={balanceGrid.table}>
              <caption className="sr-only">Scoped quarterly balance grid — {year}</caption>
              <thead>
                <tr className={balanceGrid.headRow}>
                  <th scope="col" className={balanceGrid.headLabelTh}>{year}</th>
                  {quarters.map((q, qi) => (
                    <Fragment key={q.quarter}>
                      <th
                        scope="col"
                        className={cn(balanceGrid.headValueTh, qi > 0 && balanceGrid.groupBorder)}
                        style={inlineWidth(colW.balance)}
                      >
                        Q{q.quarter}
                      </th>
                      <th
                        scope="col"
                        className={balanceGrid.headValueTh}
                        style={inlineWidth(colW.delta)}
                      >
                        Q{q.quarter} Δ
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.map(r => {
                  const meta = rowMeta(r)
                  return (
                    <tr key={r.key} className={meta.row}>
                      <td className={meta.labelTd}>{labelCell(r)}</td>
                      {quarters.map((q, qi) => {
                        const i = q.index
                        const hasData = r.hasData[i]
                        return (
                          <Fragment key={q.quarter}>
                            {balanceCell(meta.emphasis, hasData, r.balance[i], qi > 0)}
                            {deltaCell(r.deltaAmount[i], r.deltaPercent[i], hasData, r.hasPreviousData[i])}
                          </Fragment>
                        )
                      })}
                    </tr>
                  )
                })}
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
