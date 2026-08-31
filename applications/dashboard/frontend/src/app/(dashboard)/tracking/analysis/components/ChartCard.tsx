'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Card shell for every Analysis chart / section: title, optional subtitle and
 * right-slot (toggles / steppers), the dark `card` surface, and an
 * `overflow-x:auto` wrapper so wide content scrolls inside the card rather
 * than the page body (NFR-4).
 */
export function ChartCard({
  title,
  subtitle,
  right,
  children,
  className,
  bodyClassName,
  as: Heading = 'h2',
  id,
}: {
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'h2' | 'h3'
  id?: string
}) {
  return (
    <section className={cn('card p-4 space-y-3', className)} id={id}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Heading className="text-sm font-semibold text-ink-primary">{title}</Heading>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {right && <div className="flex items-center gap-2 flex-wrap shrink-0">{right}</div>}
      </div>
      <div className={cn('w-full overflow-x-auto', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Small reusable segmented button group used by the control-bar selectors. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabledOptions,
  name,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  disabledOptions?: T[]
  name: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border/60 overflow-hidden">
      {options.map(opt => {
        const active = opt.value === value
        const disabled = disabledOptions?.includes(opt.value) ?? false
        return (
          <button
            key={opt.value}
            type="button"
            name={name}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
              active ? 'bg-brand-500/20 text-ink-primary' : 'text-ink-secondary hover:text-ink-primary hover:bg-surface-elevated',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
