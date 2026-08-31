'use client'

import { Segmented } from './ChartCard'
import type { ComparisonConfig, ComparisonMode, PeriodRef } from '../types'

/** FR-9 / FR-10 — Off / QoQ / YoY / Custom. "Custom" reveals two period pickers. */
export function ComparisonControl({
  value,
  populatedPeriods,
  onChange,
}: {
  value: ComparisonConfig
  /** the populated periods the user may pick from, newest last. */
  populatedPeriods: { ref: PeriodRef; label: string }[]
  onChange: (next: ComparisonConfig) => void
}) {
  const setMode = (mode: ComparisonMode) => {
    if (mode === 'custom') {
      const n = populatedPeriods.length
      onChange({
        mode,
        periodA: value.periodA ?? populatedPeriods[Math.max(0, n - 2)]?.ref,
        periodB: value.periodB ?? populatedPeriods[n - 1]?.ref,
      })
    } else {
      onChange({ mode })
    }
  }

  const pick = (which: 'periodA' | 'periodB', raw: string) => {
    const found = populatedPeriods.find(p => p.label === raw)
    if (found) onChange({ ...value, mode: 'custom', [which]: found.ref })
  }

  const labelFor = (ref?: PeriodRef) =>
    ref ? populatedPeriods.find(p => sameRef(p.ref, ref))?.label ?? '' : ''

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Segmented<ComparisonMode>
        name="comparison"
        label="Period comparison"
        value={value.mode}
        onChange={setMode}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'qoq', label: 'QoQ' },
          { value: 'yoy', label: 'YoY' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {value.mode === 'custom' && (
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Comparison period A"
            className="input text-xs py-1"
            value={labelFor(value.periodA)}
            onChange={e => pick('periodA', e.target.value)}
          >
            <option value="">A…</option>
            {populatedPeriods.map(p => <option key={`a-${p.label}`} value={p.label}>{p.label}</option>)}
          </select>
          <span className="text-ink-muted text-xs" aria-hidden="true">→</span>
          <select
            aria-label="Comparison period B"
            className="input text-xs py-1"
            value={labelFor(value.periodB)}
            onChange={e => pick('periodB', e.target.value)}
          >
            <option value="">B…</option>
            {populatedPeriods.map(p => <option key={`b-${p.label}`} value={p.label}>{p.label}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

function sameRef(a: PeriodRef, b: PeriodRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'year' && b.kind === 'year') return a.year === b.year
  if (a.kind === 'quarter' && b.kind === 'quarter') return a.year === b.year && a.quarter === b.quarter
  return false
}
