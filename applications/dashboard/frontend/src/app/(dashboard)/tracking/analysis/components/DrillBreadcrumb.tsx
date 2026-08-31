'use client'

import { ChevronRight, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Crumb {
  /** how deep this crumb navigates to when clicked. */
  depth: 0 | 1 | 2 | 3
  label: string
}

/**
 * FR-3 — Lens ▸ Category ▸ Sub-category ▸ Item breadcrumb + an "Up" control.
 * Clicking the lens crumb (depth 0) returns to root; clicking an ancestor
 * crumb drops the deeper keys.
 */
export function DrillBreadcrumb({
  crumbs,
  onNavigate,
  onUp,
}: {
  crumbs: Crumb[]
  onNavigate: (depth: 0 | 1 | 2 | 3) => void
  onUp: () => void
}) {
  const atRoot = crumbs.length <= 1
  return (
    <nav aria-label="Drill path" className="flex items-center gap-1.5 flex-wrap text-xs">
      <button
        type="button"
        onClick={onUp}
        disabled={atRoot}
        className="btn-ghost px-2 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Step up one level"
      >
        <ChevronUp className="w-3.5 h-3.5" /> Up
      </button>
      <ol className="flex items-center gap-1 flex-wrap">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <li key={`${c.depth}-${c.label}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3 text-ink-muted" aria-hidden="true" />}
              {isLast ? (
                <span aria-current="page" className="font-semibold text-ink-primary">{c.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(c.depth)}
                  className="text-brand-400 hover:underline"
                >
                  {c.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <span className={cn('ml-auto text-ink-muted hidden md:inline')}>
        Click a line, band or bar to drill in
      </span>
    </nav>
  )
}
