'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Responsive, type Layout } from 'react-grid-layout'
import { motion } from 'framer-motion'
import { LayoutGrid, RotateCcw, Lock, Unlock } from 'lucide-react'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { useDashboardStore } from '@/store/dashboard'
import { PortfolioSummaryWidget } from '@/components/dashboard/PortfolioSummaryWidget'
import { PortfolioChartWidget } from '@/components/dashboard/PortfolioChartWidget'
import { HoldingsTableWidget } from '@/components/dashboard/HoldingsTableWidget'
import { AllocationChartWidget } from '@/components/dashboard/AllocationChartWidget'
import { RiskMetricsWidget } from '@/components/dashboard/RiskMetricsWidget'
import { AIInsightsWidget } from '@/components/dashboard/AIInsightsWidget'
import type { WidgetConfig, WidgetType } from '@/types'
import { cn } from '@/lib/utils'

const WIDGET_MAP: Record<WidgetType, React.ComponentType<{ config: WidgetConfig }>> = {
  portfolio_summary:  PortfolioSummaryWidget,
  portfolio_chart:    PortfolioChartWidget,
  holdings_table:     HoldingsTableWidget,
  allocation_chart:   AllocationChartWidget,
  risk_metrics:       RiskMetricsWidget,
  ai_insights:        AIInsightsWidget,
  market_ticker:      () => null,
  performance_chart:  PortfolioChartWidget,
  watchlist:          () => null,
  news_feed:          () => null,
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement>) {
  const [width, setWidth] = useState(1200)

  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(w)
    })
    ro.observe(ref.current)
    setWidth(ref.current.offsetWidth || 1200)
    return () => ro.disconnect()
  }, [ref])

  return width
}

export default function DashboardPage() {
  const { widgets, editMode, toggleEditMode, updateWidgetLayout, resetLayout } = useDashboardStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(containerRef)

  const saveLayout = useCallback(
    (currentLayout: Layout[]) => {
      updateWidgetLayout(
        currentLayout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
      )
    },
    [updateWidgetLayout]
  )

  const layouts = {
    lg: widgets.map((w) => ({
      i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
      minW: w.minW ?? 2, minH: w.minH ?? 2,
      static: !editMode,
    })),
  }

  return (
    <div ref={containerRef} className="min-h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-ink-muted" />
          <span className="text-sm font-medium text-ink-secondary">
            {editMode ? (
              <span className="text-warning animate-pulse">Edit mode — drag to rearrange</span>
            ) : (
              'Interactive Dashboard'
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {editMode && (
            <button onClick={resetLayout} className="btn-ghost text-xs gap-1.5 py-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              Reset layout
            </button>
          )}
          <button
            onClick={toggleEditMode}
            className={cn('btn-ghost text-xs gap-1.5 py-1.5', editMode && 'text-warning hover:text-warning')}
          >
            {editMode ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            {editMode ? 'Lock layout' : 'Edit layout'}
          </button>
        </div>
      </div>

      {/* Grid */}
      <Responsive
        width={width}
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={60}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        onDragStop={saveLayout}
        onResizeStop={saveLayout}
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".drag-handle"
        useCSSTransforms
      >
        {widgets.map((widget) => {
          const WidgetComponent = WIDGET_MAP[widget.type]
          if (!WidgetComponent) return null

          return (
            <div key={widget.id} className={cn('overflow-hidden', editMode && 'cursor-move')}>
              <WidgetWrapper config={widget} editMode={editMode}>
                <WidgetComponent config={widget} />
              </WidgetWrapper>
            </div>
          )
        })}
      </Responsive>
    </div>
  )
}

function WidgetWrapper({
  config, editMode, children,
}: {
  config: WidgetConfig
  editMode: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'card h-full flex flex-col overflow-hidden',
        editMode && 'ring-1 ring-brand-500/40 ring-offset-1 ring-offset-surface-base'
      )}
    >
      <div className={cn(
        'flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0',
        editMode && 'drag-handle cursor-grab active:cursor-grabbing'
      )}>
        <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">
          {config.title}
        </span>
        {editMode && (
          <div className="flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-border" />
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </motion.div>
  )
}
