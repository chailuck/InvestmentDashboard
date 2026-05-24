'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, ValueFormatterParams, CellClassParams } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { portfolioService } from '@/services/portfolio'
import { useDashboardStore } from '@/store/dashboard'
import { formatCurrency, formatPct, cn } from '@/lib/utils'
import type { Holding, WidgetConfig } from '@/types'

export function HoldingsTableWidget({ config }: { config: WidgetConfig }) {
  const { selectedPortfolioId } = useDashboardStore()
  const [filter, setFilter] = useState('')

  const { data: holdings = [], isLoading } = useQuery({
    queryKey: ['holdings', selectedPortfolioId],
    queryFn: () => portfolioService.getHoldings(selectedPortfolioId ?? 'default'),
    refetchInterval: 30_000,
  })

  const filtered = useMemo(
    () => filter
      ? holdings.filter(h =>
          h.symbol.toLowerCase().includes(filter.toLowerCase()) ||
          h.name.toLowerCase().includes(filter.toLowerCase())
        )
      : holdings,
    [holdings, filter]
  )

  const pnlClass = (value: number) => value >= 0 ? 'text-gain font-semibold' : 'text-loss font-semibold'

  const colDefs: ColDef<Holding>[] = [
    {
      field: 'symbol',
      headerName: 'Symbol',
      width: 90,
      pinned: 'left',
      cellRenderer: (p: any) => (
        <span className="font-bold text-ink-primary font-mono">{p.value}</span>
      ),
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 120,
      cellRenderer: (p: any) => <span className="text-ink-secondary text-xs">{p.value}</span> },
    {
      field: 'quantity',
      headerName: 'Qty',
      width: 80,
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => p.value?.toLocaleString() ?? '-',
    },
    {
      field: 'currentPrice',
      headerName: 'Price',
      width: 100,
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0),
    },
    {
      field: 'dayChangePct',
      headerName: 'Day %',
      width: 90,
      type: 'numericColumn',
      cellRenderer: (p: any) => (
        <span className={pnlClass(p.value ?? 0)}>
          {p.value >= 0 ? '+' : ''}{p.value?.toFixed(2)}%
        </span>
      ),
    },
    {
      field: 'marketValue',
      headerName: 'Mkt Value',
      width: 110,
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0),
    },
    {
      field: 'unrealizedPnl',
      headerName: 'P&L',
      width: 110,
      type: 'numericColumn',
      cellRenderer: (p: any) => (
        <span className={pnlClass(p.value ?? 0)}>
          {p.value >= 0 ? '+' : ''}{formatCurrency(p.value ?? 0)}
        </span>
      ),
    },
    {
      field: 'weight',
      headerName: 'Weight',
      width: 90,
      type: 'numericColumn',
      cellRenderer: (p: any) => (
        <div className="flex items-center gap-2">
          <span className="text-xs">{(p.value * 100).toFixed(1)}%</span>
          <div className="flex-1 h-1 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500/60 rounded-full"
              style={{ width: `${Math.min(p.value * 100 * 2, 100)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      field: 'sector',
      headerName: 'Sector',
      width: 120,
      cellRenderer: (p: any) => (
        <span className="badge-neutral">{p.value}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 py-2 border-b border-border/30">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by symbol or name…"
          className="input py-1.5 text-xs"
        />
      </div>

      {/* Table */}
      <div className="flex-1 ag-theme-alpine-dark">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-8 rounded" />)}
          </div>
        ) : (
          <AgGridReact
            rowData={filtered}
            columnDefs={colDefs}
            rowHeight={40}
            headerHeight={36}
            defaultColDef={{ sortable: true, resizable: true, filter: false }}
            animateRows
            suppressCellFocus
            domLayout="autoHeight"
          />
        )}
      </div>
    </div>
  )
}
