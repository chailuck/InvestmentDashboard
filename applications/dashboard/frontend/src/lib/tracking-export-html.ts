/**
 * Builds a self-contained, email-client-safe HTML representation of the
 * Financial Tracker Dashboard's currently-visible balance grid.
 *
 * This is a PURE function: no I/O, no React, no `apiClient` import — it only
 * transforms already-loaded data (`DashboardBalanceGridOut`, the same type
 * `tracking/dashboard/page.tsx` already renders from) plus the page's
 * current collapse/expand UI state into an HTML string. The caller (the
 * "Email Dashboard" button in page.tsx) is responsible for actually sending
 * that string anywhere.
 *
 * Design decisions (documented per the task spec):
 *
 * 1. Inline `style="..."` attributes ONLY — no `<style>` block, no CSS
 *    classes, no Tailwind. Email clients unpredictably strip embedded/
 *    external stylesheets, so every visual rule here is inlined per element.
 *
 * 2. Visibility mirrors `page.tsx` EXACTLY:
 *      - A year in `visibility.collapsedYears` is rendered as a single
 *        one-line notice ("<year> — collapsed, not included in this
 *        export") with NO grand-total/category/sub-category/item rows for
 *        that year at all (the requirement is that a collapsed year's data
 *        must be genuinely ABSENT from the HTML, not merely visually
 *        hidden — matching `YearTable`'s own collapsed short-circuit return
 *        in page.tsx, which renders only a header button and no `<table>`).
 *      - A Category's OWN row (its subtotal) is always rendered — exactly
 *        like `YearTable` in page.tsx, where the category row "doubles as
 *        its subtotal row" and stays visible even when collapsed — but its
 *        SubCategory/Item children are omitted when
 *        `visibility.collapsedCategories` contains that category's id.
 *      - Symmetrically, a SubCategory's own subtotal row is always
 *        rendered, but its Item rows are omitted when
 *        `visibility.collapsedSubCategories` contains that sub-category's
 *        id.
 *      - Grand Total / Property Total / Non-Property Total are rendered
 *        unconditionally for every VISIBLE (non-collapsed) year, matching
 *        `GrandTotalRows` in page.tsx which is never gated by
 *        `collapsedCategories`/`collapsedSubCategories`.
 *
 * 3. Number formatting reuses this app's existing `formatNumber` thousand-
 *    comma helper from `@/lib/utils` (a pure module — its only dependency is
 *    `numeral`, no React/DOM) rather than re-implementing a local
 *    formatter, so the email reads with the exact same "1,234,567.89"
 *    convention as the live page. The signed-amount ("+"/"-" prefix)
 *    conventions are re-derived locally (`fmtBalance`/`fmtAmount`/
 *    `fmtPercent`) because page.tsx's own copies of those helpers are not
 *    exported (Next.js App Router rejects extra named exports from a
 *    page.tsx module).
 *
 * 4. All user-controlled text (category/sub-category/item names) is
 *    HTML-escaped before being embedded in the string — this HTML is sent
 *    as an email body, so unescaped user input here would be a stored-XHTML-
 *    injection vector into whatever renders the email.
 */

import { formatNumber } from '@/lib/utils'
import type {
  BalanceCell,
  DashboardBalanceGridOut,
  DashboardCategoryRow,
  OriginalInvestmentRollup,
} from '@/services/tracking'

/** The three collapse/expand `Set`s from `page.tsx`'s `useToggleSet` state, as of the moment the user clicked "Email Dashboard". */
export interface VisibilitySnapshot {
  collapsedYears: ReadonlySet<number>
  collapsedCategories: ReadonlySet<string>
  collapsedSubCategories: ReadonlySet<string>
}

// ── Local formatting helpers ────────────────────────────────────────────────
// Mirror page.tsx's fmtBalance/fmtAmount/fmtPercent conventions exactly (see
// module docblock point 3) so the emailed numbers read identically to the
// live page.

function fmtBalance(n: number): string {
  return (n >= 0 ? '' : '-') + formatNumber(Math.abs(n))
}

function fmtAmount(n: number): string {
  return (n >= 0 ? '+' : '-') + formatNumber(Math.abs(n))
}

function fmtPercent(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

/** Same defensive coercion as page.tsx's `toFiniteOrNull` — a balance/delta value may arrive as a JSON number or numeric string. */
function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const EMPTY_CELL: BalanceCell = {
  year: 0, quarter: 0, balance: null, deltaAmount: null, deltaPercent: null,
  hasData: false, hasPreviousData: false,
}

function cellAt(cells: BalanceCell[], idx: number): BalanceCell {
  return cells[idx] ?? EMPTY_CELL
}

/** Escapes the five HTML-significant characters — this HTML becomes an email body, so user-controlled names (category/sub-category/item) must never be interpolated raw. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Inline style constants ───────────────────────────────────────────────────

const FONT = "font-family:Arial,Helvetica,sans-serif;"
const TABLE_STYLE = `${FONT}border-collapse:collapse;width:100%;margin:0 0 24px 0;font-size:12px;`
const TH_STYLE = `${FONT}border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;padding:6px 8px;text-align:right;font-size:11px;font-weight:600;`
const TH_LABEL_STYLE = `${FONT}border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;padding:6px 8px;text-align:left;font-size:11px;font-weight:600;`
const TD_BASE = `${FONT}border:1px solid #e2e8f0;padding:4px 8px;text-align:right;font-size:12px;white-space:nowrap;`
const TD_LABEL_BASE = `${FONT}border:1px solid #e2e8f0;padding:4px 8px;text-align:left;font-size:12px;`
const TD_DASH = `color:#94a3b8;`

/** Balance `<td>` — bold weight/color varies by row tier, matching page.tsx's grand/strong distinction. */
function balanceCellHtml(cell: BalanceCell, weight: 'grand' | 'strong' | 'normal'): string {
  const balance = toFiniteOrNull(cell.balance)
  if (!cell.hasData || balance === null) {
    return `<td style="${TD_BASE}${TD_DASH}">&mdash;</td>`
  }
  const fontWeight = weight === 'normal' ? 'normal' : 'bold'
  const color = weight === 'grand' ? '#1d4ed8' : '#0f172a'
  return `<td style="${TD_BASE}font-weight:${fontWeight};color:${color};">${fmtBalance(balance)}</td>`
}

/** Delta `<td>` — amount + percent on one line, matching page.tsx's `DeltaTd`. */
function deltaCellHtml(cell: BalanceCell): string {
  if (!cell.hasPreviousData) {
    return `<td style="${TD_BASE}${TD_DASH}">&mdash;</td>`
  }
  const amount = toFiniteOrNull(cell.deltaAmount)
  if (amount === null) {
    return `<td style="${TD_BASE}${TD_DASH}">&mdash;</td>`
  }
  const percent = toFiniteOrNull(cell.deltaPercent)
  const color = amount >= 0 ? '#16a34a' : '#dc2626'
  const pctText = percent !== null ? ` (${fmtPercent(percent)})` : ''
  return `<td style="${TD_BASE}color:${color};">${fmtAmount(amount)}${pctText}</td>`
}

/** Renders one Balance+Delta `<td>` pair per quarter index in `colIndices`, in order — mirrors page.tsx's `GridCells`. */
function gridCellsHtml(cells: BalanceCell[], colIndices: number[], weight: 'grand' | 'strong' | 'normal'): string {
  return colIndices.map(idx => {
    const cell = cellAt(cells, idx)
    return balanceCellHtml(cell, weight) + deltaCellHtml(cell)
  }).join('')
}

/** One label `<td>` at a given indentation depth (0 = category, 1 = sub-category, 2 = item), bold for depth 0/1 — matches page.tsx's tiered visual hierarchy (Category strong, SubCategory medium, Item plain). */
function labelCellHtml(name: string, depth: 0 | 1 | 2, exclusive = false): string {
  const paddingLeft = 8 + depth * 20
  const fontWeight = depth === 2 ? 'normal' : 'bold'
  const badge = exclusive
    ? ' <span style="font-size:9px;color:#7c3aed;border:1px solid #c4b5fd;border-radius:3px;padding:0 3px;">Excl.</span>'
    : ''
  return `<td style="${TD_LABEL_BASE}padding-left:${paddingLeft}px;font-weight:${fontWeight};">${escapeHtml(name)}${badge}</td>`
}

/** Builds the `<thead>` row: "Item" + one Balance/Delta header pair per quarter, matching page.tsx's `YearTable` header. */
function headerRowHtml(quarters: number[]): string {
  const quarterHeaders = quarters.map(q =>
    `<th style="${TH_STYLE}">Q${q}</th><th style="${TH_STYLE}">Q${q} &Delta;</th>`,
  ).join('')
  return `<tr><th style="${TH_LABEL_STYLE}">Item</th>${quarterHeaders}</tr>`
}

/** Grand Total / Property Total / Non-Property Total rows — always rendered for every visible year, unconditionally (mirrors `GrandTotalRows` in page.tsx, which is never gated by category/sub-category collapse state). */
function grandTotalRowsHtml(grid: DashboardBalanceGridOut, colIndices: number[]): string {
  const grandTotal = gridCellsHtml(grid.grandTotal, colIndices, 'grand')
  const propertyTotal = gridCellsHtml(grid.propertyBreakdown.propertyTotal, colIndices, 'normal')
  const nonPropertyTotal = gridCellsHtml(grid.propertyBreakdown.nonPropertyTotal, colIndices, 'strong')
  return (
    `<tr style="background:#dbeafe;">` +
      `<td style="${TD_LABEL_BASE}font-weight:bold;color:#1d4ed8;">Grand Total</td>${grandTotal}` +
    `</tr>` +
    `<tr>` +
      `<td style="${TD_LABEL_BASE}padding-left:24px;color:#64748b;font-size:11px;">Property Total</td>${propertyTotal}` +
    `</tr>` +
    `<tr style="background:#ecfeff;">` +
      `<td style="${TD_LABEL_BASE}padding-left:24px;color:#334155;font-size:11px;font-weight:600;">Non-Property Total</td>${nonPropertyTotal}` +
    `</tr>`
  )
}

/**
 * Renders every visible Category/SubCategory/Item row for one year, applying
 * the exact same collapse rules `YearTable` in page.tsx applies:
 *   - a category's own subtotal row is always emitted
 *   - its sub-categories are emitted ONLY if the category is not collapsed
 *   - a sub-category's own subtotal row is always emitted (when its parent
 *     category is expanded)
 *   - its items are emitted ONLY if the sub-category is not collapsed
 */
function categoryRowsHtml(
  categories: DashboardCategoryRow[],
  colIndices: number[],
  visibility: VisibilitySnapshot,
): string {
  return categories.map(cat => {
    const catCollapsed = visibility.collapsedCategories.has(cat.id)
    let html = `<tr style="background:#f8fafc;">${labelCellHtml(cat.name, 0)}${gridCellsHtml(cat.subtotal, colIndices, 'strong')}</tr>`

    if (!catCollapsed) {
      html += cat.subCategories.map(sub => {
        const subCollapsed = visibility.collapsedSubCategories.has(sub.id)
        let subHtml = `<tr>${labelCellHtml(sub.name, 1)}${gridCellsHtml(sub.subtotal, colIndices, 'strong')}</tr>`

        if (!subCollapsed) {
          subHtml += sub.items.map(item =>
            `<tr>${labelCellHtml(item.name, 2, item.exclusive)}${gridCellsHtml(item.cells, colIndices, 'normal')}</tr>`,
          ).join('')
        }
        return subHtml
      }).join('')
    }
    return html
  }).join('')
}

/**
 * UTF-8-safe base64 encoding for the "Email Dashboard" backup attachment.
 * Plain `btoa(jsonString)` only works correctly for Latin1 text — it throws
 * (or silently mangles bytes, depending on engine) on any character outside
 * that range, and this app's tracking data routinely contains non-ASCII text
 * (Thai `remark`/`description`/`accountName` fields). This encodes to UTF-8
 * bytes first via `TextEncoder`, then base64-encodes THAT byte sequence one
 * byte at a time, so every character survives the round trip intact.
 *
 * Lives here (not in `page.tsx`) because Next.js App Router statically
 * rejects any named export from a `page.tsx` module other than the specific
 * ones it recognizes (`default`, `metadata`, `generateStaticParams`, ...) —
 * this needs to be both used internally by the page AND unit-tested
 * directly, so it must live in a plain module instead.
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * Renders the optional "Original Investment vs Profit" section appended
 * after the year tables — one row per `rollup.items[]` (covered rows carry
 * real figures; not-covered rows render an em dash in every numeric cell,
 * NEVER a fabricated 0 / "0%"), a covered-only totals row, and a coverage
 * footnote. Every name/text cell goes through `escapeHtml` (this is an email
 * body); numeric cells use `formatNumber` / `toFixed`. Thai text passes
 * through `escapeHtml` unchanged.
 */
function originalInvestmentSectionHtml(rollup: OriginalInvestmentRollup): string {
  const numericCell = (covered: boolean, value: number | null): string =>
    !covered || value === null
      ? `<td style="${TD_BASE}${TD_DASH}">&mdash;</td>`
      : `<td style="${TD_BASE}">${formatNumber(value)}</td>`

  const percentCell = (covered: boolean, value: number | null): string =>
    !covered || value === null
      ? `<td style="${TD_BASE}${TD_DASH}">&mdash;</td>`
      : `<td style="${TD_BASE}">${value.toFixed(2)}%</td>`

  const itemRows = rollup.items.map(item => (
    '<tr>' +
      `<td style="${TD_LABEL_BASE}">${escapeHtml(item.itemName)}</td>` +
      `<td style="${TD_LABEL_BASE}">${escapeHtml(item.categoryName)}</td>` +
      `<td style="${TD_LABEL_BASE}">${escapeHtml(item.subCategoryName)}</td>` +
      numericCell(item.isCovered, item.netOriginalInvestment) +
      numericCell(item.isCovered, item.currentValue) +
      numericCell(item.isCovered, item.profit) +
      percentCell(item.isCovered, item.profitPercent) +
    '</tr>'
  )).join('')

  const t = rollup.totals
  const totalsRow =
    '<tr style="background:#f1f5f9;">' +
      `<td style="${TD_LABEL_BASE}font-weight:bold;" colspan="3">Total (covered items)</td>` +
      `<td style="${TD_BASE}font-weight:bold;">${t.netOriginalInvestment === null ? '&mdash;' : formatNumber(t.netOriginalInvestment)}</td>` +
      `<td style="${TD_BASE}font-weight:bold;">${t.currentValue === null ? '&mdash;' : formatNumber(t.currentValue)}</td>` +
      `<td style="${TD_BASE}font-weight:bold;">${t.profit === null ? '&mdash;' : formatNumber(t.profit)}</td>` +
      `<td style="${TD_BASE}font-weight:bold;">${t.profitPercent === null ? '&mdash;' : `${t.profitPercent.toFixed(2)}%`}</td>` +
    '</tr>'

  // Footnote: the fixed prose has no HTML-significant characters, and each
  // excluded name is individually `escapeHtml`-ed before being joined in, so
  // the assembled string is NOT escaped again here (that would double-encode
  // an `&` in a name to `&amp;amp;`).
  const cov = rollup.coverage
  let footnote = `Profit vs original shown for ${cov.shownCount} of ${cov.totalCount} tracked items.`
  if (cov.excludedItemNames.length > 0) {
    footnote += ` Not shown: ${cov.excludedItemNames.map(escapeHtml).join(', ')}.`
  }

  return (
    `<h2 style="${FONT}font-size:15px;margin:0 0 6px 0;">Original Investment vs Profit</h2>` +
    `<table style="${TABLE_STYLE}">` +
      '<thead><tr>' +
        `<th style="${TH_LABEL_STYLE}">Item</th>` +
        `<th style="${TH_LABEL_STYLE}">Category</th>` +
        `<th style="${TH_LABEL_STYLE}">Sub-category</th>` +
        `<th style="${TH_STYLE}">Original investment</th>` +
        `<th style="${TH_STYLE}">Current value</th>` +
        `<th style="${TH_STYLE}">Profit</th>` +
        `<th style="${TH_STYLE}">Profit %</th>` +
      '</tr></thead>' +
      `<tbody>${itemRows}${totalsRow}</tbody>` +
    '</table>' +
    `<p style="${FONT}font-size:11px;color:#64748b;margin:0 0 16px 0;">${footnote}</p>`
  )
}

/**
 * Builds the full dashboard email HTML body from an already-loaded balance
 * grid and the page's current collapse/expand state. See the module
 * docblock for the full set of design decisions.
 *
 * `rollup` is optional and degrades gracefully: when it is `undefined` /
 * `null` (or has zero items) the output is byte-identical to the pre-rollup
 * version — the profit section is simply omitted, so the "Email Dashboard"
 * button can still send the balance grid alone if the rollup fetch fails.
 */
export function buildDashboardEmailHtml(
  grid: DashboardBalanceGridOut,
  visibility: VisibilitySnapshot,
  rollup?: OriginalInvestmentRollup | null,
): string {
  const parts: string[] = []
  parts.push(`<div style="${FONT}color:#0f172a;">`)
  parts.push(`<h1 style="${FONT}font-size:18px;margin:0 0 12px 0;">Financial Tracker &mdash; Balance Grid</h1>`)

  if (grid.years.length === 0) {
    parts.push(`<p style="${FONT}font-size:13px;color:#64748b;">No quarterly data available for this tracking set.</p>`)
    parts.push('</div>')
    return parts.join('')
  }

  grid.years.forEach((yearCol, yearIdx) => {
    if (visibility.collapsedYears.has(yearCol.year)) {
      parts.push(
        `<p style="${FONT}font-size:13px;color:#64748b;margin:0 0 12px 0;">` +
        `${yearCol.year} &mdash; collapsed, not included in this export</p>`,
      )
      return
    }

    const colIndices = yearCol.quarters.map((_, i) => yearIdx * 4 + i)

    parts.push(`<h2 style="${FONT}font-size:15px;margin:0 0 6px 0;">${yearCol.year}</h2>`)
    parts.push(`<table style="${TABLE_STYLE}">`)
    parts.push('<thead>')
    parts.push(headerRowHtml(yearCol.quarters))
    parts.push('</thead>')
    parts.push('<tbody>')
    parts.push(grandTotalRowsHtml(grid, colIndices))
    parts.push(categoryRowsHtml(grid.categories, colIndices, visibility))
    parts.push('</tbody>')
    parts.push('</table>')
  })

  // Optional profit section — appended after every year table. Omitted
  // entirely (output byte-identical to the pre-rollup version) when `rollup`
  // is null/undefined or carries no items, so a failed rollup fetch never
  // blocks the email.
  if (rollup && rollup.items.length > 0) {
    parts.push(originalInvestmentSectionHtml(rollup))
  }

  parts.push('</div>')
  return parts.join('')
}
