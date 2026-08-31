'use client'

import { Segmented } from './ChartCard'
import type { Lens } from '../types'

/** FR-1 — Grand Total / Property / No Property amount-type lens. */
export function LensSelect({ value, onChange }: { value: Lens; onChange: (next: Lens) => void }) {
  return (
    <Segmented<Lens>
      name="lens"
      label="Amount type lens"
      value={value}
      onChange={onChange}
      options={[
        { value: 'grandTotal', label: 'Grand Total' },
        { value: 'property', label: 'Property' },
        { value: 'nonProperty', label: 'No Property' },
      ]}
    />
  )
}
