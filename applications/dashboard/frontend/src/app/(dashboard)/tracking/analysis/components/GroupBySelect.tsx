'use client'

import type { GroupByDim } from '../types'

const LABELS: Record<GroupByDim, string> = {
  category: 'Category',
  subCategory: 'Sub-category',
  item: 'Item',
  itemType: 'Item type',
}

/**
 * FR-2 — group-by dimension. A native `<select>` whose options are limited to
 * those allowed at the current drill depth (§4.4). Disabled entirely at a
 * leaf node (single series).
 */
export function GroupBySelect({
  value,
  allowed,
  onChange,
  disabled,
}: {
  value: GroupByDim
  allowed: GroupByDim[]
  onChange: (next: GroupByDim) => void
  disabled?: boolean
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
      <span className="shrink-0">Group by</span>
      <select
        className="input text-xs py-1 min-w-[130px]"
        value={value}
        disabled={disabled || allowed.length === 0}
        onChange={e => onChange(e.target.value as GroupByDim)}
        aria-label="Group by dimension"
      >
        {allowed.map(opt => (
          <option key={opt} value={opt}>{LABELS[opt]}</option>
        ))}
        {allowed.length === 0 && <option value={value}>—</option>}
      </select>
    </label>
  )
}
