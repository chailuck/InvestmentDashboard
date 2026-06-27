'use client'

import { useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronsUp, ChevronUp, ChevronDown, ChevronsDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FEELINGS,
  type FeelingValue,
  type ObjectivePosition,
  objectiveService,
} from '@/services/objective'
import type { ObjectiveListResponse } from '@/services/objective'

// Icon map
const FEEL_ICONS = {
  5: ChevronsUp,
  4: ChevronUp,
  2: ChevronDown,
  1: ChevronsDown,
} as const

const fmtPrice = (v: number | null) =>
  v != null ? v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtDate = (v: string | null) => v ?? '—'
const fmtSize = (v: number | null) => v != null ? v.toLocaleString() : '—'

function calcPnl(
  p: ObjectivePosition,
  currentPrice?: number | null,
): { net: number; pct: number; unrealized?: boolean } | null {
  const isShort = p.direction?.toUpperCase() === 'SHORT'

  // Closed position — realized P&L
  if (p.exit_date != null && p.exit_price != null && p.entry_price != null && p.position_size != null) {
    const diff = isShort ? p.entry_price - p.exit_price : p.exit_price - p.entry_price
    const net = diff * p.position_size
    const pct = p.entry_price !== 0 ? (diff / p.entry_price) * 100 : 0
    return { net: Math.round(net * 100) / 100, pct: Math.round(pct * 100) / 100 }
  }

  // Open position — unrealized P&L
  if (p.exit_date == null && currentPrice != null && p.entry_price != null && p.position_size != null) {
    const diff = isShort ? p.entry_price - currentPrice : currentPrice - p.entry_price
    const net = diff * p.position_size
    const pct = p.entry_price !== 0 ? (diff / p.entry_price) * 100 : 0
    return { net: Math.round(net * 100) / 100, pct: Math.round(pct * 100) / 100, unrealized: true }
  }

  return null
}

interface Props {
  position: ObjectivePosition
  queryKey: readonly unknown[]
  priceMap: Map<string, number | null>
}

export function ObjectiveRow({ position, queryKey, priceMap }: Props) {
  const queryClient = useQueryClient()

  // ── reason auto-save on blur ───────────────────────────────────────────────
  const [reasonText, setReasonText] = useState(position.reason ?? '')
  const savedReason = useRef(position.reason ?? '')
  const reasonDirty = useRef(false)

  const handleReasonChange = (v: string) => {
    setReasonText(v)
    reasonDirty.current = true
  }

  const handleReasonBlur = useCallback(async () => {
    if (!reasonDirty.current) return
    // Do NOT clear reasonDirty.current here — clear it only after the patch
    // resolves successfully. Clearing it pre-flight causes silent data loss if
    // the user edits the field again while a save is still in-flight.
    const next = reasonText.trim() || null
    const prev = savedReason.current
    savedReason.current = next ?? ''
    try {
      const updated = await objectiveService.patch(position.id, { reason: next })
      // Mark clean only after confirmed server-side persistence
      reasonDirty.current = false
      queryClient.setQueryData<ObjectiveListResponse>(queryKey as unknown[], (old) =>
        old ? { ...old, items: old.items.map(p => p.id === position.id ? updated : p) } : old,
      )
    } catch {
      toast.error(`Failed to save reason for ${position.symbol}`)
      setReasonText(prev)
      savedReason.current = prev
      // Leave reasonDirty.current = true so the next blur retries the save
    }
  }, [position.id, position.symbol, queryClient, queryKey, reasonText])

  // ── sell reason auto-save on blur ─────────────────────────────────────────────
  const [sellReasonText, setSellReasonText] = useState(position.sell_reason ?? '')
  const savedSellReason = useRef(position.sell_reason ?? '')
  const sellReasonDirty = useRef(false)

  const handleSellReasonChange = (v: string) => {
    setSellReasonText(v)
    sellReasonDirty.current = true
  }

  const handleSellReasonBlur = useCallback(async () => {
    if (!sellReasonDirty.current) return
    const next = sellReasonText.trim() || null
    const prev = savedSellReason.current
    savedSellReason.current = next ?? ''
    try {
      const updated = await objectiveService.patch(position.id, { sell_reason: next })
      sellReasonDirty.current = false
      queryClient.setQueryData<ObjectiveListResponse>(queryKey as unknown[], (old) =>
        old ? { ...old, items: old.items.map(p => p.id === position.id ? updated : p) } : old,
      )
    } catch {
      toast.error(`Failed to save sell reason for ${position.symbol}`)
      setSellReasonText(prev)
      savedSellReason.current = prev
    }
  }, [position.id, position.symbol, queryClient, queryKey, sellReasonText])

  // ── feel immediate save on click ───────────────────────────────────────────
  const [feel, setFeel] = useState<FeelingValue | null>(position.feel)

  const handleFeelClick = useCallback(async (v: FeelingValue) => {
    const next = feel === v ? null : v
    setFeel(next)
    try {
      const updated = await objectiveService.patch(position.id, { feel: next })
      queryClient.setQueryData<ObjectiveListResponse>(queryKey as unknown[], (old) =>
        old ? { ...old, items: old.items.map(p => p.id === position.id ? updated : p) } : old,
      )
    } catch {
      toast.error(`Failed to save feel for ${position.symbol}`)
      setFeel(position.feel)
    }
  }, [feel, position.id, position.symbol, position.feel, queryClient, queryKey])

  // ── sell feel immediate save on click ─────────────────────────────────────────
  const [sellFeel, setSellFeel] = useState<FeelingValue | null>(position.sell_feel)

  const handleSellFeelClick = useCallback(async (v: FeelingValue) => {
    const next = sellFeel === v ? null : v
    setSellFeel(next)
    try {
      const updated = await objectiveService.patch(position.id, { sell_feel: next })
      queryClient.setQueryData<ObjectiveListResponse>(queryKey as unknown[], (old) =>
        old ? { ...old, items: old.items.map(p => p.id === position.id ? updated : p) } : old,
      )
    } catch {
      toast.error(`Failed to save sell feel for ${position.symbol}`)
      setSellFeel(position.sell_feel)
    }
  }, [sellFeel, position.id, position.symbol, position.sell_feel, queryClient, queryKey])

  const hasSell = position.exit_date != null
  const currentPrice = priceMap.get(position.symbol) ?? null
  const pnl = calcPnl(position, currentPrice)

  return (
    <tr className="border-b border-border/20 hover:bg-surface-elevated/20 transition-colors align-top">
      {/* Symbol */}
      <td className="px-3 py-2.5 whitespace-nowrap border-r border-white/20">
        <span className="font-mono font-bold text-xs text-ink-primary">{position.symbol}</span>
        {position.exit_date == null && (
          <span className="ml-1.5 text-[9px] font-semibold text-gain/70 uppercase">Open</span>
        )}
        <div className="text-[10px] text-ink-muted tabular-nums mt-0.5">
          {currentPrice != null ? currentPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
      </td>

      {/* P&L + P&L% (second column) */}
      {(() => {
        if (pnl == null) return (
          <td className="px-2 py-2.5 text-xs text-ink-disabled text-right tabular-nums whitespace-nowrap border-r border-white/20">—</td>
        )
        const cls = pnl.net >= 0 ? 'text-gain' : 'text-loss'
        const unrealized = pnl.unrealized === true
        return (
          <td className={cn('px-2 py-2.5 text-right tabular-nums whitespace-nowrap border-r border-white/20', unrealized && 'opacity-80 italic')}>
            <div className={`text-xs ${cls}`}>
              {unrealized ? '~' : ''}{pnl.net >= 0 ? '+' : ''}{pnl.net.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className={`text-[10px] ${cls}`}>
              {unrealized ? '~' : ''}{pnl.pct >= 0 ? '+' : ''}{pnl.pct.toFixed(2)}%
            </div>
          </td>
        )
      })()}

      {/* Buy Date */}
      <td className="px-2 py-2.5 text-xs text-ink-muted whitespace-nowrap">
        {fmtDate(position.entry_date)}
      </td>

      {/* Buy P/Size */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="space-y-0.5">
          <div className="text-xs text-white tabular-nums">{fmtPrice(position.entry_price)}</div>
          <div className="text-[10px] text-ink-muted tabular-nums">×{fmtSize(position.position_size)}</div>
        </div>
      </td>

      {/* Buy Reason (editable) */}
      <td className="px-2 py-2 min-w-[240px]">
        <textarea
          rows={2}
          value={reasonText}
          onChange={e => handleReasonChange(e.target.value)}
          onBlur={handleReasonBlur}
          placeholder="Why buy?"
          className={cn(
            'w-full text-xs rounded-lg border border-border/50 bg-surface-elevated/40 px-2 py-1 resize-none',
            'placeholder:text-ink-disabled text-ink-primary focus:outline-none focus:border-brand-500/50 transition-colors',
          )}
        />
      </td>

      {/* Buy Feel (editable) */}
      <td className="px-2 py-2.5 border-r border-white/20">
        <div className="grid grid-cols-4 gap-0.1">
          {FEELINGS.map(f => {
            const Icon = FEEL_ICONS[f.value as FeelingValue]
            const active = feel === f.value
            return (
              <button
                key={f.value}
                onClick={() => handleFeelClick(f.value as FeelingValue)}
                title={f.label}
                className={cn(
                  'w-5 h-5 rounded flex items-center justify-center border transition-all',
                  active
                    ? cn(f.color, f.bg, 'scale-110')
                    : 'border-border/30 text-ink-disabled hover:border-border hover:text-ink-muted hover:scale-110',
                )}
              >
                <Icon className="w-3 h-3" strokeWidth={2.5} />
              </button>
            )
          })}
        </div>
      </td>

      {/* Sell Date */}
      <td className="px-2 py-2.5 text-xs text-ink-muted whitespace-nowrap">
        {fmtDate(position.exit_date)}
      </td>

      {/* Sell P/Size */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        {hasSell ? (
          <div className="space-y-0.5">
            <div className={`text-xs tabular-nums ${pnl != null && pnl.net >= 0 ? 'text-gain' : pnl != null ? 'text-loss' : 'text-ink-muted'}`}>{fmtPrice(position.exit_price)}</div>
            <div className="text-[10px] text-ink-muted tabular-nums">×{fmtSize(position.position_size)}</div>
          </div>
        ) : <span className="text-ink-disabled text-xs">—</span>}
      </td>

      {/* Sell Reason (editable) */}
      <td className="px-2 py-2 min-w-[240px]">
        <textarea
          rows={2}
          value={sellReasonText}
          onChange={e => handleSellReasonChange(e.target.value)}
          onBlur={handleSellReasonBlur}
          placeholder="Why sell?"
          className={cn(
            'w-full text-xs rounded-lg border border-border/50 bg-surface-elevated/40 px-2 py-1 resize-none',
            'placeholder:text-ink-disabled text-ink-primary focus:outline-none focus:border-brand-500/50 transition-colors',
          )}
        />
      </td>

      {/* Sell Feel (editable) */}
      <td className="px-2 py-2.5">
        <div className="grid grid-cols-4 gap-0.1">
          {FEELINGS.map(f => {
            const Icon = FEEL_ICONS[f.value as FeelingValue]
            const active = sellFeel === f.value
            return (
              <button
                key={f.value}
                onClick={() => handleSellFeelClick(f.value as FeelingValue)}
                title={f.label}
                className={cn(
                  'w-5 h-5 rounded flex items-center justify-center border transition-all',
                  active
                    ? cn(f.color, f.bg, 'scale-110')
                    : 'border-border/30 text-ink-disabled hover:border-border hover:text-ink-muted hover:scale-110',
                )}
              >
                <Icon className="w-3 h-3" strokeWidth={2.5} />
              </button>
            )
          })}
        </div>
      </td>

    </tr>
  )
}
