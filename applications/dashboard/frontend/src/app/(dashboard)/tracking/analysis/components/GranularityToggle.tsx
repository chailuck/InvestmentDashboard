'use client'

import { Segmented } from './ChartCard'
import type { Granularity } from '../types'

/** FR-4 — Quarterly / Yearly time-granularity toggle. */
export function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity
  onChange: (next: Granularity) => void
}) {
  return (
    <Segmented<Granularity>
      name="granularity"
      label="Time granularity"
      value={value}
      onChange={onChange}
      options={[
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'yearly', label: 'Yearly' },
      ]}
    />
  )
}
