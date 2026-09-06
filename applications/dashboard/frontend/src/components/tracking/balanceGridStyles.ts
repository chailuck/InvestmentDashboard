/**
 * Canonical presentational tokens for the Financial Tracker "balance grid"
 * look — the per-year quarterly roll-up table shared, visually, between the
 * main **Tracking / Dashboard** year tables and the Analysis tab's **Scoped
 * Dashboard** grid.
 *
 * This module holds ONLY class-string constants + a column-width helper — no
 * React components and no number formatting, so it can be consumed by call
 * sites that format their values differently (the dashboard renders bare
 * amounts; the Analysis grid prefixes the Baht symbol) without either one
 * having to adopt the other's formatter.
 *
 * NOTE: `tracking/dashboard/page.tsx` currently still carries its own inline
 * copies of these exact tokens (`BalanceTd` / `DeltaTd` / `YearTable`
 * header / row-emphasis rows). That duplication is intentional and interim —
 * the dashboard page is a large, well-tested module and was deliberately
 * left untouched by the restyle that introduced this file. When the
 * dashboard page is next refactored, it should import these constants in
 * place of its local literals.
 */

import { useMemo } from 'react'

/** Shared class strings — kept byte-for-byte in sync with the dashboard year table. */
export const balanceGrid = {
  /** `<table>` element. */
  table: 'w-full text-xs border-collapse',
  /** header `<tr>`. */
  headRow: 'border-b-2 border-border bg-surface-elevated/20 text-ink-muted',
  /** first header `<th>` (the label / row-name column). */
  headLabelTh: 'px-3 py-2 text-left font-medium min-w-[220px] border-r-2 border-border',
  /** every Balance / Delta header `<th>`. */
  headValueTh: 'px-2 py-1 text-right font-medium text-[10px]',
  /** left grid-border separating one period group (quarter / year) from the next. */
  groupBorder: 'border-l-2 border-border',
  /** every Balance body `<td>`. */
  balanceTd: 'px-2 py-1.5 text-right font-mono whitespace-nowrap',
  /** every Delta body `<td>`. */
  deltaTd: 'px-2 py-1.5 text-right whitespace-nowrap',
  /** the em-dash span shown for a blank / no-prior-data cell. */
  blankSpan: 'text-ink-disabled text-[11px]',
  /** the em-dash glyph itself (U+2014), distinct from the charts' en-dash `NO_DATA_DASH`. */
  blankGlyph: '—',
  /** Delta amount span (colour class from `deltaSignClass` is appended). */
  deltaAmountSpan: 'font-mono text-xs font-medium',
  /** wrapper holding the Delta amount + percent on one baseline-aligned line. */
  deltaWrap: 'inline-flex items-baseline gap-1',
  /** the parenthesised Delta percent span. */
  deltaPercentSpan: 'text-[10px] text-ink-muted font-normal',

  // ── row / label-cell emphasis ──────────────────────────────────────────
  /** grand-total (`scopeTotal`) `<tr>`. */
  grandRow: 'bg-brand-500/10 border-t-2 border-brand-500/30',
  /** grand-total label `<td>`. */
  grandLabelTd: 'px-3 py-2.5 font-bold text-brand-400 text-sm border-r-2 border-border',
  /** sub-category subtotal `<tr>`. */
  subtotalRow: 'bg-surface-elevated/30 border-b border-border/60',
  /** sub-category subtotal label `<td>` (indent supplied by the caller). */
  subtotalLabelTd: 'px-3 py-1.5 border-l-4 border-l-border border-r-2 border-border font-medium text-ink-secondary',
  /** leaf item `<tr>`. */
  itemRow: 'border-b border-border/40 hover:bg-surface-elevated/50 transition-colors',
  /** leaf item label `<td>` (indent supplied by the caller). */
  itemLabelTd: 'px-3 py-1.5 border-l-4 border-l-transparent border-r-2 border-border',
  /** a plain / split / derived `<tr>` with no special background. */
  plainRow: 'border-b border-border/40',
  /** a plain label `<td>` (split rows, fallbacks). */
  plainLabelTd: 'px-3 py-1.5 border-r-2 border-border',
} as const

export type BalanceEmphasis = 'grand' | 'strong' | 'normal'

/**
 * Text-colour / weight class for a Balance *value* span, keyed off the row's
 * emphasis tier — mirrors the dashboard `BalanceTd`'s `grand ? … : strong ? … : …`.
 */
export function balanceValueClass(emphasis: BalanceEmphasis): string {
  return emphasis === 'grand'
    ? 'font-bold text-brand-400'
    : emphasis === 'strong'
      ? 'font-semibold text-ink-primary'
      : 'text-ink-secondary'
}

/**
 * Gain / loss colour for a Delta value — `>= 0` reads as a gain, matching the
 * dashboard `DeltaTd`. Callers must still render an explicit `+` / `-` sign so
 * the direction is legible without colour (NFR-2).
 */
export function deltaSignClass(signedValue: number): string {
  return signedValue >= 0 ? 'text-gain' : 'text-loss'
}

/** The two independently-sized `ch`-based column widths. */
export interface BalanceColWidths {
  balance: string
  delta: string
}

/** Minimal row shape the width helper needs — parallel arrays aligned to a period axis. */
export interface BalanceWidthRow {
  balance: (number | null)[]
  deltaAmount: (number | null)[]
  deltaPercent: (number | null)[]
  hasData: boolean[]
  hasPreviousData: boolean[]
}

/**
 * Computes two independent shared `ch`-based widths — one for every Balance
 * column, one for every Delta column — by measuring the longest realistically
 * rendered string across every supplied row, so that every independently
 * rendered per-year sub-table lines its period columns up pixel-for-pixel.
 *
 * Generalised from the dashboard's `useSharedColWidths`: it takes raw parallel
 * `{ balance, deltaAmount, deltaPercent, hasData, hasPreviousData }` fields
 * plus the caller's own formatters (`fmt.balance` for a Balance value,
 * `fmt.deltaText` for the exact Delta string the caller will render), rather
 * than a fixed `BalanceCell` object and hard-wired formatters.
 *
 * `fmt` must be referentially stable across renders (memoise it) — it is a
 * dependency of the memo.
 */
export function useSharedBalanceColWidths(
  rows: readonly BalanceWidthRow[],
  fmt: {
    balance: (value: number) => string
    deltaText: (amount: number, percent: number | null) => string
  },
): BalanceColWidths {
  return useMemo(() => {
    let maxBalanceLen = 0
    let maxDeltaLen = 0
    for (const r of rows) {
      for (let i = 0; i < r.balance.length; i++) {
        const b = r.balance[i]
        if (r.hasData[i] && b !== null && b !== undefined) {
          const s = fmt.balance(b)
          if (s.length > maxBalanceLen) maxBalanceLen = s.length
        }
        const d = r.deltaAmount[i]
        if (r.hasPreviousData[i] && d !== null && d !== undefined) {
          const s = fmt.deltaText(d, r.deltaPercent[i] ?? null)
          if (s.length > maxDeltaLen) maxDeltaLen = s.length
        }
      }
    }
    // Same "+2 chars padding, sane minimum" rationale as the dashboard helper.
    return {
      balance: `${Math.max(maxBalanceLen + 2, 8)}ch`,
      delta: `${Math.max(maxDeltaLen + 2, 7)}ch`,
    }
  }, [rows, fmt])
}
