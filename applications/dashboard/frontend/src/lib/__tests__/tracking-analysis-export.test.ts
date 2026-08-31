import { describe, it, expect } from 'vitest'
import {
  analysisCsvFilename,
  buildAnalysisCsv,
  buildComparisonCsv,
  comparisonCsvFilename,
  csvField,
  type AnalysisCsvInput,
  type ExportBucketRow,
} from '../tracking-analysis-export'

const CTX = {
  trackingSetName: 'บ้าน & Cash',
  lensLabel: 'Grand Total',
  drillPathLabel: 'Grand Total › Assets',
  groupByLabel: 'Sub-category',
  granularityLabel: 'Quarterly',
  measureLabel: 'balance',
  generatedAt: '2026-08-30T10:20:30.000Z',
  comparison: null,
}

function bucket(name: string, kind: ExportBucketRow['bucketKind'], values: (number | null)[]): ExportBucketRow {
  return {
    bucketName: name,
    bucketKind: kind,
    drillPath: 'Grand Total › Assets',
    periods: values.map((v, i) => ({
      label: `Q${i + 1} 2025`,
      year: 2025,
      quarter: i + 1,
      asOfQuarter: null,
      balance: v,
      deltaAmount: i === 0 ? null : 10,
      deltaPercent: i === 0 ? null : 5,
      sharePercent: v === null ? null : 50,
      hasData: v !== null,
    })),
  }
}

describe('csvField (RFC-4180)', () => {
  it('quotes fields containing comma / quote / newline and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line\r\nbreak')).toBe('"line\r\nbreak"')
  })
  it('empty for null / undefined', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
})

describe('buildAnalysisCsv', () => {
  const input: AnalysisCsvInput = {
    ...CTX,
    rows: [bucket('Bank', 'subCategory', [100, 110]), bucket('Grand Total total', 'aggregate', [300, 330])],
  }
  const csv = buildAnalysisCsv(input)

  it('opens with #-prefixed context comment lines (no BOM — added at the Blob layer)', () => {
    expect(csv.startsWith('# tracking_set: บ้าน & Cash\r\n')).toBe(true)
    expect(csv).toContain('# lens: Grand Total')
    expect(csv).toContain('# drill_path: Grand Total › Assets')
    expect(csv).toContain('# granularity: Quarterly')
    expect(csv).toContain('# measure: balance')
    expect(csv).toContain('# generated_at: 2026-08-30T10:20:30.000Z')
  })

  it('uses CRLF line endings and the documented column header', () => {
    expect(csv.includes('\r\n')).toBe(true)
    expect(csv).toContain('tracking_set,lens,drill_path,group_by,granularity,period_label,period_year,period_quarter,as_of_quarter,bucket_name,bucket_kind,balance,delta_amount,delta_percent,share_percent,has_data')
  })

  it('emits one row per bucket × period', () => {
    const bodyLines = csv.trimEnd().split('\r\n').filter(l => !l.startsWith('#') && !l.startsWith('tracking_set,'))
    expect(bodyLines).toHaveLength(4) // 2 buckets × 2 periods
    expect(bodyLines[0]).toContain(',Bank,subCategory,100,,,50,true')
  })

  it('adds comparison context lines when a comparison is active', () => {
    const withCmp = buildAnalysisCsv({
      ...input,
      comparison: { modeLabel: 'YOY', periodALabel: 'Q2 2024', periodBLabel: 'Q3 2025' },
    })
    expect(withCmp).toContain('# comparison: YOY')
    expect(withCmp).toContain('# comparison_period_a: Q2 2024')
    expect(withCmp).toContain('# comparison_period_b: Q3 2025')
  })
})

describe('buildComparisonCsv', () => {
  it('emits the second-file columns and rows', () => {
    const csv = buildComparisonCsv({
      ...CTX,
      comparison: { modeLabel: 'QOQ', periodALabel: 'Q1 2025', periodBLabel: 'Q2 2025' },
      rows: [],
      comparisonRows: [
        { bucketName: 'Bank', periodALabel: 'Q1 2025', valueA: 100, periodBLabel: 'Q2 2025', valueB: 130, deltaAmount: 30, deltaPercent: 30 },
        { bucketName: 'Grand Total total', periodALabel: 'Q1 2025', valueA: 300, periodBLabel: 'Q2 2025', valueB: 360, deltaAmount: 60, deltaPercent: 20 },
      ],
    })
    expect(csv).toContain('bucket_name,period_a_label,value_a,period_b_label,value_b,delta_amount,delta_percent')
    expect(csv).toContain('Bank,Q1 2025,100,Q2 2025,130,30,30')
    expect(csv.trimEnd().endsWith('Grand Total total,Q1 2025,300,Q2 2025,360,60,20')).toBe(true)
  })
})

describe('filenames', () => {
  it('slugifies the set name and stamps the UTC date', () => {
    expect(analysisCsvFilename(CTX, 'grandTotal', 'subCategory', 'quarterly'))
      .toBe('analysis_cash_grandTotal_subCategory_quarterly_20260830.csv')
    expect(comparisonCsvFilename(CTX, 'property', 'item', 'yearly'))
      .toBe('analysis_cash_property_item_yearly_20260830_comparison.csv')
  })
})
