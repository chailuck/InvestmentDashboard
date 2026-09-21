'use client'

import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Shared click-to-sort table header ───────────────────────────────────────
//
// Extracted from `BondsSection` once a second table (the Initial Investment
// Ledger in `tracking/items/[itemId]/page.tsx`) needed the identical
// sortable-column pattern. Generic over the caller's own column-key union so
// each table keeps its own `SortColumn` type and comparators — only the
// presentational header and the asc/desc toggle logic are shared.

export type SortDirection = 'asc' | 'desc'

export interface SortState<TColumn extends string> {
  column: TColumn
  direction: SortDirection
}

/** Active column -> flip direction; a new column -> start ascending. */
export function toggleSortState<TColumn extends string>(
  prev: SortState<TColumn>,
  column: TColumn,
): SortState<TColumn> {
  return prev.column === column
    ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: 'asc' }
}

/**
 * A sortable column header. The `<th>` carries `aria-sort`; the click target is
 * a real `<button>` so keyboard users can operate it. The active column shows a
 * chevron indicating the current direction.
 */
export function SortableHeader<TColumn extends string>({
  column, label, align, sort, onSort,
}: {
  column: TColumn
  label: string
  align: 'left' | 'right'
  sort: SortState<TColumn>
  onSort: (column: TColumn) => void
}) {
  const active = sort.column === column
  return (
    <th
      className={cn('px-3 py-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-ink-secondary transition-colors',
          align === 'right' && 'flex-row-reverse',
          active && 'text-ink-secondary',
        )}
      >
        <span>{label}</span>
        {active && (
          sort.direction === 'asc'
            ? <ChevronUp className="w-3 h-3" aria-hidden="true" />
            : <ChevronDown className="w-3 h-3" aria-hidden="true" />
        )}
      </button>
    </th>
  )
}
