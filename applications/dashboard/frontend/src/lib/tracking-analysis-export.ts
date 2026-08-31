/**
 * Client-side CSV export for the Financial Tracker "Analysis" view
 * (ANALYSIS-DESIGN.html §4.8 + ADR-019 #4). PURE — builds strings only; the
 * caller wraps the result in a `Blob(['﻿' + csv], …)` (UTF-8 BOM added at
 * the Blob layer) and triggers the download.
 *
 * Format: RFC-4180 quoting, `\r\n` line endings, `#`-prefixed header comment
 * lines recording the applied context. One CSV covers the chart-derived
 * bucket rows AND the Scoped Dashboard grid rows (when that section is
 * expanded). A second CSV is produced when a comparison is active. No
 * exclusive items appear in any export.
 */

export type ExportBucketKind =
  | 'category'
  | 'subCategory'
  | 'item'
  | 'itemType'
  | 'other'
  | 'aggregate'
  | 'subCategoryTotal'
  | 'scopeTotal'

export interface ExportPeriodCell {
  label: string
  year: number
  quarter: number | null
  asOfQuarter: number | null
  balance: number | null
  deltaAmount: number | null
  deltaPercent: number | null
  sharePercent: number | null
  hasData: boolean
}

export interface ExportBucketRow {
  /** flat, human row label. */
  bucketName: string
  bucketKind: ExportBucketKind
  /** hierarchical path, e.g. "Investments › Stocks". */
  drillPath: string
  periods: ExportPeriodCell[]
}

export interface ExportComparisonRow {
  bucketName: string
  periodALabel: string
  valueA: number | null
  periodBLabel: string
  valueB: number | null
  deltaAmount: number | null
  deltaPercent: number | null
}

export interface AnalysisCsvContext {
  trackingSetName: string
  lensLabel: string
  drillPathLabel: string
  groupByLabel: string
  granularityLabel: string
  measureLabel: string
  /** ISO-8601 timestamp. */
  generatedAt: string
  comparison?: { modeLabel: string; periodALabel: string; periodBLabel: string } | null
}

export interface AnalysisCsvInput extends AnalysisCsvContext {
  rows: ExportBucketRow[]
  comparisonRows?: ExportComparisonRow[] | null
}

const EOL = '\r\n'

/** RFC-4180 field quoting with formula-injection neutralisation. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // Neutralise CSV formula injection (leading =, +, -, @, tab)
  if (/^[=+\-@\t]/.test(s)) s = "'" + s
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function num(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n)
}

function headerComments(ctx: AnalysisCsvContext): string[] {
  const lines = [
    `# tracking_set: ${ctx.trackingSetName}`,
    `# lens: ${ctx.lensLabel}`,
    `# drill_path: ${ctx.drillPathLabel}`,
    `# group_by: ${ctx.groupByLabel}`,
    `# granularity: ${ctx.granularityLabel}`,
    `# measure: ${ctx.measureLabel}`,
    `# generated_at: ${ctx.generatedAt}`,
  ]
  if (ctx.comparison) {
    lines.push(`# comparison: ${ctx.comparison.modeLabel}`)
    lines.push(`# comparison_period_a: ${ctx.comparison.periodALabel}`)
    lines.push(`# comparison_period_b: ${ctx.comparison.periodBLabel}`)
  }
  return lines
}

const MAIN_COLUMNS = [
  'tracking_set', 'lens', 'drill_path', 'group_by', 'granularity',
  'period_label', 'period_year', 'period_quarter', 'as_of_quarter',
  'bucket_name', 'bucket_kind', 'balance', 'delta_amount', 'delta_percent',
  'share_percent', 'has_data',
]

/** The primary "export current view" CSV (chart-derived + scoped-grid rows). */
export function buildAnalysisCsv(input: AnalysisCsvInput): string {
  const out: string[] = [...headerComments(input)]
  out.push(MAIN_COLUMNS.join(','))
  for (const row of input.rows) {
    for (const p of row.periods) {
      out.push([
        csvField(input.trackingSetName),
        csvField(input.lensLabel),
        csvField(row.drillPath),
        csvField(input.groupByLabel),
        csvField(input.granularityLabel),
        csvField(p.label),
        csvField(p.year),
        csvField(p.quarter),
        csvField(p.asOfQuarter),
        csvField(row.bucketName),
        csvField(row.bucketKind),
        num(p.balance),
        num(p.deltaAmount),
        num(p.deltaPercent),
        num(p.sharePercent),
        csvField(p.hasData),
      ].join(','))
    }
  }
  return out.join(EOL) + EOL
}

const COMPARISON_COLUMNS = [
  'bucket_name', 'period_a_label', 'value_a', 'period_b_label', 'value_b',
  'delta_amount', 'delta_percent',
]

/** The second CSV, emitted only when a comparison is active (§4.8). */
export function buildComparisonCsv(input: AnalysisCsvInput): string {
  const rows = input.comparisonRows ?? []
  const out: string[] = [...headerComments(input)]
  out.push(COMPARISON_COLUMNS.join(','))
  for (const r of rows) {
    out.push([
      csvField(r.bucketName),
      csvField(r.periodALabel),
      num(r.valueA),
      csvField(r.periodBLabel),
      num(r.valueB),
      num(r.deltaAmount),
      num(r.deltaPercent),
    ].join(','))
  }
  return out.join(EOL) + EOL
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'set'
}

function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '00000000'
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

export function analysisCsvFilename(input: AnalysisCsvContext, lensKey: string, groupByKey: string, granularityKey: string): string {
  return `analysis_${slug(input.trackingSetName)}_${lensKey}_${groupByKey}_${granularityKey}_${stamp(input.generatedAt)}.csv`
}

export function comparisonCsvFilename(input: AnalysisCsvContext, lensKey: string, groupByKey: string, granularityKey: string): string {
  return `analysis_${slug(input.trackingSetName)}_${lensKey}_${groupByKey}_${granularityKey}_${stamp(input.generatedAt)}_comparison.csv`
}
