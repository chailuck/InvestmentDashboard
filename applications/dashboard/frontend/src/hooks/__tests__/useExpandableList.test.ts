import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useExpandableList } from '../useExpandableList'

describe('useExpandableList', () => {
  it('shows all items and hasMore=false when fewer than defaultCount items', () => {
    const items = [1, 2, 3]
    const { result } = renderHook(() => useExpandableList(items, 5))

    expect(result.current.visibleItems).toEqual([1, 2, 3])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.isExpanded).toBe(false)
  })

  it('shows all items and hasMore=false when item count exactly equals defaultCount', () => {
    const items = [1, 2, 3, 4, 5]
    const { result } = renderHook(() => useExpandableList(items, 5))

    expect(result.current.visibleItems).toEqual(items)
    expect(result.current.hasMore).toBe(false)
  })

  it('slices to defaultCount and sets hasMore=true when more than defaultCount items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const { result } = renderHook(() => useExpandableList(items, 5))

    expect(result.current.visibleItems).toEqual([1, 2, 3, 4, 5])
    expect(result.current.hasMore).toBe(true)
  })

  it('defaults defaultCount to 5 when not provided', () => {
    const items = Array.from({ length: 8 }, (_, i) => i)
    const { result } = renderHook(() => useExpandableList(items))

    expect(result.current.visibleItems).toHaveLength(5)
    expect(result.current.hasMore).toBe(true)
  })

  it('toggle() expands to show all items, and toggling again collapses back', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const { result } = renderHook(() => useExpandableList(items, 5))

    expect(result.current.isExpanded).toBe(false)

    act(() => result.current.toggle())
    expect(result.current.isExpanded).toBe(true)
    expect(result.current.visibleItems).toEqual(items)

    act(() => result.current.toggle())
    expect(result.current.isExpanded).toBe(false)
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4, 5])
  })

  it('handles an empty array without error', () => {
    const { result } = renderHook(() => useExpandableList<number>([], 5))

    expect(result.current.visibleItems).toEqual([])
    expect(result.current.hasMore).toBe(false)
  })
})
