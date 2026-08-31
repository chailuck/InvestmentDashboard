'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScopedBalanceGrid } from './ScopedBalanceGrid'
import { ScopeFactsStrip } from './ScopeFactsStrip'
import { fmtBalance, NO_DATA_DASH } from '@/lib/tracking-format'
import { lastPopulatedIndex, quarterLabel, type ScopedGrid } from '@/lib/tracking-analysis'
import type { Lens, ViewState } from '../types'

/**
 * §4.9 — collapsible "Scoped Dashboard" card. Owns its collapse state,
 * routes empty / lens-mismatch states by drill depth × lens, renders the
 * scope identity strip, and composes `ScopedBalanceGrid` + `ScopeFactsStrip`.
 * Reacts to `lens` + `drill` + `granularity` + `measure`; ignores `groupBy`
 * and `comparison`. 100% client-side off the already-fetched grid.
 */
export function ScopedDashboardSection({
  scoped,
  viewState,
  subCaption,
  onChange,
  onDrillItem,
}: {
  scoped: ScopedGrid
  viewState: ViewState
  subCaption: string
  onChange: (patch: Partial<ViewState>) => void
  onDrillItem: (itemId: string) => void
}) {
  const depth = scoped.depth
  const perDepthCollapsed = depth === 0
  const collapsed = viewState.scopedDashboardCollapsed ?? perDepthCollapsed
  const toggle = () => onChange({ scopedDashboardCollapsed: !collapsed })

  const switchToGrandTotal = () =>
    onChange({ lens: 'grandTotal', drill: { ...viewState.drill, lens: 'grandTotal' } })

  const contentId = 'scoped-dashboard-body'

  return (
    <section className="card p-0 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-elevated/40 transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-ink-muted" /> : <ChevronDown className="w-4 h-4 text-ink-muted" />}
        <span className="text-sm font-semibold text-ink-primary">Scoped Dashboard</span>
        <span className="ml-auto text-xs text-ink-muted truncate">{subCaption}</span>
      </button>

      {!collapsed && (
        <div id={contentId} className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          {depth === 0 ? (
            <Depth0 scoped={scoped} />
          ) : (
            <>
              <ScopeIdentityStrip scoped={scoped} />
              <Body scoped={scoped} viewState={viewState} onChange={onChange} onDrillItem={onDrillItem} onSwitch={switchToGrandTotal} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

function ScopeIdentityStrip({ scoped }: { scoped: ScopedGrid }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="font-medium text-ink-primary">{scoped.scopeLabel}</span>
      {scoped.itemType && <span className="badge-neutral">{scoped.itemType}</span>}
      {scoped.exclusive && <span className="badge-loss">Exclusive</span>}
      {scoped.depth !== 3 && (
        <span className="text-ink-muted">
          {scoped.inScopeQualifyingCount} in-scope item{scoped.inScopeQualifyingCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

function Depth0({ scoped }: { scoped: ScopedGrid }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Drill into a category, sub-category, or item to populate the Scoped Dashboard.
      </p>
      {scoped.lensStripRows.length > 0 && (
        <table className="text-xs border-collapse">
          <tbody>
            {scoped.lensStripRows.map(r => {
              const idx = lastPopulatedIndex(r.balance)
              const q = idx >= 0 ? scoped.axis[idx] : null
              return (
                <tr key={r.key} className="border-t border-border/30">
                  <td className="px-2 py-1 text-ink-secondary">{r.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink-primary">
                    {idx >= 0 ? fmtBalance(r.balance[idx]) : NO_DATA_DASH}
                  </td>
                  <td className="px-2 py-1 text-ink-muted">{q ? `as of ${quarterLabel(q.year, q.quarter)}` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Body({
  scoped,
  viewState,
  onChange,
  onDrillItem,
  onSwitch,
}: {
  scoped: ScopedGrid
  viewState: ViewState
  onChange: (patch: Partial<ViewState>) => void
  onDrillItem: (itemId: string) => void
  onSwitch: () => void
}) {
  const es = scoped.emptyState

  if (es.kind === 'lensMismatchScope') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-ink-secondary">
          No {es.qualifyingLensLabel} items in this scope. Switch the lens to Grand Total to see all {es.totalItems} item{es.totalItems === 1 ? '' : 's'}.
        </p>
        <button type="button" className="btn-primary text-xs px-3 py-1.5" onClick={onSwitch}>Switch to Grand Total</button>
        {scoped.exclusiveRows.length > 0 && (
          <ScopedBalanceGrid scoped={{ ...scoped, rows: [] }} granularity={viewState.granularity} measure={viewState.measure} onDrillItem={onDrillItem} />
        )}
      </div>
    )
  }

  if (es.kind === 'lensMismatchItem') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-ink-secondary">
          This item (type: {es.itemType}) is not a {es.lensLabel === 'Property' ? 'Property' : 'Non-Property'} item; the {es.lensLabel} lens excludes it.
        </p>
        <button type="button" className="btn-primary text-xs px-3 py-1.5" onClick={onSwitch}>Switch to Grand Total</button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {es.kind === 'exclusiveLeaf' && (
        <p className="text-xs text-warning border border-warning/30 rounded-md p-2">
          This item is exclusive — excluded from all sub-category, category, Property / Non-Property and Grand Total figures. Shown here in isolation.
        </p>
      )}
      {es.kind === 'noPopulatedPeriods' && (
        <p className="text-xs text-ink-muted">No recorded balances for this scope yet.</p>
      )}
      <ScopedBalanceGrid
        scoped={scoped}
        granularity={viewState.granularity}
        measure={viewState.measure}
        onDrillItem={onDrillItem}
      />
      {scoped.depth === 3 && scoped.scopeFacts && (
        <>
          <ScopeFactsStrip facts={scoped.scopeFacts} />
          <p className="text-xs text-ink-muted italic">This scope is a single item; its balance is shown directly.</p>
        </>
      )}
    </div>
  )
}
