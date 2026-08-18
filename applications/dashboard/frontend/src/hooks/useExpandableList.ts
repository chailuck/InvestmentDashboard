import { useState } from 'react'

/**
 * Generic "show latest N, expand for the rest" list pattern.
 *
 * Used by table/list sections that only want to show the most recent
 * `defaultCount` items by default, with a toggle to reveal the full list.
 *
 * @param items Full source array (already sorted in the desired display order).
 * @param defaultCount Number of items to show when collapsed. Defaults to 5.
 */
export function useExpandableList<T>(items: T[], defaultCount = 5) {
  const [isExpanded, setIsExpanded] = useState(false)
  const visibleItems = isExpanded ? items : items.slice(0, defaultCount)
  const hasMore = items.length > defaultCount
  const toggle = () => setIsExpanded(v => !v)
  return { visibleItems, isExpanded, toggle, hasMore }
}
