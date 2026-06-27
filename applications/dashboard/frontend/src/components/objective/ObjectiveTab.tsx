'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { objectiveService, type ObjectiveFilter } from '@/services/objective'
import { actionPlanService } from '@/services/actionPlan'
import { ObjectiveFilterBar } from './ObjectiveFilterBar'
import { ObjectiveTable } from './ObjectiveTable'

interface Props {
  portfolioId: string
}

const DEFAULT_FILTER: ObjectiveFilter = '3m'

export function ObjectiveTab({ portfolioId }: Props) {
  const [filter, setFilter] = useState<ObjectiveFilter>(DEFAULT_FILTER)
  const [priceMap, setPriceMap] = useState<Map<string, number | null>>(new Map())
  const [pricesLoading, setPricesLoading] = useState(false)

  const queryKey = ['objective-positions', portfolioId, filter] as const

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => objectiveService.list(portfolioId, filter),
    staleTime: 60_000,
  })

  const positions = data?.items ?? []
  const total = data?.total ?? 0

  const fetchPrices = useCallback(async () => {
    const symbols = [...new Set(positions.map(p => p.symbol).filter(Boolean))]
    if (symbols.length === 0) return

    setPricesLoading(true)
    const results = await Promise.allSettled(
      symbols.map(symbol => actionPlanService.getStockPrice(symbol).then(r => ({ symbol, price: r.price })))
    )
    const map = new Map<string, number | null>()
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map.set(result.value.symbol, result.value.price)
      }
    }
    setPriceMap(map)
    setPricesLoading(false)
  }, [positions])

  const symbolKey = positions.map(p => p.symbol).join(',')
  useEffect(() => {
    fetchPrices()
  // fetchPrices is stable for a given positions array; symbolKey captures symbol identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey, filter])

  return (
    <div className="space-y-4 pt-2">
      <ObjectiveFilterBar
        value={filter}
        onChange={setFilter}
        total={total}
        pricesLoading={pricesLoading}
        onRefresh={fetchPrices}
      />

      {isError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
          Failed to load objective data. Please try again.
        </div>
      )}

      <ObjectiveTable
        positions={positions}
        loading={isLoading}
        queryKey={queryKey}
        priceMap={priceMap}
      />
    </div>
  )
}
