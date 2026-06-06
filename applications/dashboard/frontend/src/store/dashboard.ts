import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WidgetConfig } from '@/types'

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'portfolio-summary',         type: 'portfolio_summary',         title: 'Portfolio Summary',         x: 0, y: 0,  w: 12, h: 3, minW: 6, minH: 2 },
  { id: 'trading-history-summary',   type: 'trading_history_summary',   title: 'Trading History (30d)',     x: 0, y: 3,  w: 12, h: 3, minW: 6, minH: 2 },
  { id: 'portfolio-chart',           type: 'portfolio_chart',           title: 'Performance',               x: 0, y: 6,  w: 8,  h: 5, minW: 4, minH: 3 },
  { id: 'allocation',                type: 'allocation_chart',          title: 'Allocation',                x: 8, y: 6,  w: 4,  h: 5, minW: 3, minH: 3 },
  { id: 'holdings',                  type: 'holdings_table',            title: 'Holdings',                  x: 0, y: 11, w: 12, h: 6, minW: 4, minH: 4 },
  { id: 'market-pulse',              type: 'market_pulse',              title: 'Market Pulse',              x: 0, y: 17, w: 12, h: 5, minW: 6, minH: 4 },
  { id: 'scan-heat-tile',            type: 'scan_heat_tile',            title: 'Scan Heat Tile',            x: 0, y: 19, w: 6,  h: 5, minW: 4, minH: 3 },
  { id: 'pnl-waterfall',             type: 'pnl_waterfall',             title: 'P&L by Ticker',             x: 6, y: 19, w: 6,  h: 5, minW: 4, minH: 3 },
]

interface DashboardState {
  widgets: WidgetConfig[]
  editMode: boolean
  selectedPortfolioId: string | null
  setWidgets: (widgets: WidgetConfig[]) => void
  updateWidgetLayout: (layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void
  toggleEditMode: () => void
  setSelectedPortfolio: (id: string | null) => void
  resetLayout: () => void
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      widgets: DEFAULT_WIDGETS,
      editMode: false,
      selectedPortfolioId: null,

      setWidgets: (widgets) => set({ widgets }),

      updateWidgetLayout: (layouts) =>
        set((state) => ({
          widgets: state.widgets.map((w) => {
            const l = layouts.find((l) => l.i === w.id)
            return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w
          }),
        })),

      toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),

      setSelectedPortfolio: (id) => set({ selectedPortfolioId: id }),

      resetLayout: () => set({ widgets: DEFAULT_WIDGETS }),
    }),
    { name: 'dashboard-layout-v6' }
  )
)
