import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WidgetConfig } from '@/types'

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'portfolio-summary', type: 'portfolio_summary',  title: 'Portfolio Summary',    x: 0, y: 0, w: 8, h: 3, minW: 4, minH: 2 },
  { id: 'ai-insights',       type: 'ai_insights',        title: 'AI Insights',          x: 8, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: 'portfolio-chart',   type: 'portfolio_chart',    title: 'Performance',          x: 0, y: 3, w: 8, h: 5, minW: 4, minH: 3 },
  { id: 'allocation',        type: 'allocation_chart',   title: 'Allocation',           x: 8, y: 3, w: 4, h: 5, minW: 3, minH: 3 },
  { id: 'holdings',          type: 'holdings_table',     title: 'Holdings',             x: 0, y: 8, w: 7, h: 6, minW: 4, minH: 4 },
  { id: 'risk-metrics',      type: 'risk_metrics',       title: 'Risk Metrics',         x: 7, y: 8, w: 5, h: 6, minW: 3, minH: 3 },
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
    { name: 'dashboard-layout' }
  )
)
