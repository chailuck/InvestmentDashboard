'use client'

import { Segmented } from './ChartCard'
import type { Measure } from '../types'

/** FR — Balance / Δ Amount / Δ % measure selector (the plotted quantity for the charts). */
export function MeasureSelect({ value, onChange }: { value: Measure; onChange: (next: Measure) => void }) {
  return (
    <Segmented<Measure>
      name="measure"
      label="Measure"
      value={value}
      onChange={onChange}
      options={[
        { value: 'balance', label: 'Balance' },
        { value: 'deltaAmount', label: 'Δ Amount' },
        { value: 'deltaPercent', label: 'Δ %' },
      ]}
    />
  )
}
