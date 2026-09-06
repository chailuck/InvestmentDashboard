'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { trackingService, type ItemType } from '@/services/tracking'

/**
 * Base React-Query key for the configurable item-type list. Every admin
 * mutation invalidates this prefix (`queryClient.invalidateQueries({ queryKey:
 * ITEM_TYPES_QUERY_KEY })`), which also covers the `includeArchived` variants
 * because invalidation matches by key prefix.
 */
export const ITEM_TYPES_QUERY_KEY = ['tracking-item-types'] as const

/**
 * Cached list of configurable tracking-item types. Backed by
 * `GET /tracking/item-types`; the response is short-cache (`Cache-Control:
 * private, max-age=60`) server-side and held here with a ~5-minute `staleTime`
 * since the list is low-churn config data.
 *
 * @param includeArchived when `true`, archived types are returned too — used by
 *   the admin screen and by the item-detail picker so an item's own archived
 *   type stays resolvable/selectable. Each value is cached separately.
 */
export function useItemTypes(includeArchived = false): UseQueryResult<ItemType[]> {
  return useQuery<ItemType[]>({
    queryKey: [...ITEM_TYPES_QUERY_KEY, { includeArchived }],
    queryFn: () => trackingService.listItemTypes(includeArchived),
    staleTime: 5 * 60_000,
  })
}

/** Ascending comparator matching the server order (sortOrder, then label). */
export function bySortOrder(a: ItemType, b: ItemType): number {
  return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
}
