'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { portfolioTrackerService, type SetIndex, type GlobalIndex, type IndexOhlc } from '@/services/portfolioTracker'
import { cn } from '@/lib/utils'
import type { WidgetConfig } from '@/types'

// ── Number formatters ─────────────────────────────────────────────────────────

function fmtValue(v: number | null): string {
  if (v == null) return '—'
  if (Math.abs(v) >= 10_000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1_000)  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtOhlc(v: number): string {
  if (Math.abs(v) >= 10_000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1_000)  return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return v.toFixed(2)
}

// ── "Last 5 days" candlestick ─────────────────────────────────────────────────

function MiniCandle({ ohlc }: { ohlc: IndexOhlc }) {
  const { open, close, high, low } = ohlc
  const up    = close >= open
  const color = up ? '#10B981' : '#EF4444'
  const fillBg = up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'

  const W = 18
  const H = 64
  const PAD = 3
  const range = high - low || 0.001
  const toY   = (p: number) => PAD + ((high - p) / range) * (H - PAD * 2)

  const bodyTop = toY(Math.max(open, close))
  const bodyBot = toY(Math.min(open, close))
  const bodyH   = Math.max(bodyBot - bodyTop, 2)
  const cx      = W / 2

  return (
    <svg width={W} height={H} className="shrink-0" style={{ display: 'block' }}>
      {/* Background track */}
      <rect x={cx - 1} y={PAD} width={2} height={H - PAD * 2} fill="rgba(100,116,139,0.2)" rx={1} />
      {/* High wick */}
      <line x1={cx} y1={PAD} x2={cx} y2={bodyTop} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      {/* Low wick */}
      <line x1={cx} y1={bodyBot} x2={cx} y2={H - PAD} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      {/* Body fill */}
      <rect x={3} y={bodyTop} width={W - 6} height={bodyH} fill={fillBg} rx={2} />
      {/* Body border */}
      <rect x={3} y={bodyTop} width={W - 6} height={bodyH} fill="none" stroke={color} strokeWidth={1.5} rx={2} />
      {/* Open tick */}
      <line x1={0} y1={toY(open)}  x2={cx - 1} y2={toY(open)}  stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      {/* Close tick */}
      <line x1={cx + 1} y1={toY(close)} x2={W} y2={toY(close)} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

// ── OHLC value grid ───────────────────────────────────────────────────────────

function OhlcGrid({ ohlc }: { ohlc: IndexOhlc }) {
  const up = ohlc.close >= ohlc.open
  const rows: [string, number, string][] = [
    ['O', ohlc.open,  'text-ink-muted'],
    ['H', ohlc.high,  'text-gain'],
    ['L', ohlc.low,   'text-loss'],
    ['C', ohlc.close, up ? 'text-gain' : 'text-loss'],
  ]
  return (
    <div className="grid grid-cols-[12px_1fr] gap-x-1 gap-y-0.5">
      {rows.map(([label, val, cls]) => (
        <div key={label} className="contents">
          <span className="text-[9px] font-semibold text-ink-disabled leading-tight">{label}</span>
          <span className={cn('text-[9px] tabular-nums font-mono leading-tight', cls)}>
            {fmtOhlc(val)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Index card ────────────────────────────────────────────────────────────────

interface IndexCardProps {
  name: string
  value: number | null
  change: number | null
  changePct: number | null
  ohlc: IndexOhlc | null
}

function IndexCard({ name, value, change, changePct, ohlc }: IndexCardProps) {
  const up   = (changePct ?? 0) >= 0
  const Icon = up ? TrendingUp : TrendingDown

  const fmtPct = changePct != null
    ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`
    : '—'
  const fmtChg = change != null
    ? `${change >= 0 ? '+' : ''}${Math.abs(change) >= 1 ? change.toFixed(1) : change.toFixed(2)}`
    : null

  const fiveDayChg    = ohlc ? ohlc.close - ohlc.open : null
  const fiveDayPct    = ohlc && ohlc.open ? ((ohlc.close - ohlc.open) / ohlc.open) * 100 : null
  const fiveDayUp     = (fiveDayPct ?? 0) >= 0
  const fmtFivePct    = fiveDayPct != null
    ? `${fiveDayPct >= 0 ? '+' : ''}${fiveDayPct.toFixed(2)}%`
    : null
  const fmtFiveChg    = fiveDayChg != null
    ? `${fiveDayChg >= 0 ? '+' : ''}${Math.abs(fiveDayChg) >= 1 ? fiveDayChg.toFixed(1) : fiveDayChg.toFixed(2)}`
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-elevated rounded-xl flex flex-col gap-0.5 p-2.5 sm:p-3 min-w-0"
    >
      {/* Name + icon */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] sm:text-xs leading-tight font-semibold text-ink-muted uppercase tracking-wider truncate">
          {name}
        </span>
        <Icon className={cn('w-3 h-3 shrink-0', up ? 'text-gain' : 'text-loss')} />
      </div>

      {/* Price info + candle side by side */}
      <div className="flex items-start gap-2 mt-0.5">
        {/* Left: price + changes */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.span
              key={String(value)}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              className="font-bold tabular-nums leading-tight text-sm sm:text-base text-ink-primary block"
            >
              {fmtValue(value)}
            </motion.span>
          </AnimatePresence>

          {/* Daily change */}
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            <span className={cn(
              'text-[10px] font-semibold px-1 py-0.5 rounded tabular-nums',
              up ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss',
            )}>
              {fmtPct}
            </span>
            {fmtChg && (
              <span className={cn('text-[10px] tabular-nums', up ? 'text-gain' : 'text-loss')}>
                {fmtChg}
              </span>
            )}
          </div>

          {/* 5-day change */}
          {fmtFivePct && (
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              <span className="text-[9px] text-ink-disabled">5d</span>
              <span className={cn('text-[10px] font-semibold tabular-nums', fiveDayUp ? 'text-gain' : 'text-loss')}>
                {fmtFivePct}
              </span>
              {fmtFiveChg && (
                <span className={cn('text-[9px] tabular-nums', fiveDayUp ? 'text-gain/70' : 'text-loss/70')}>
                  {fmtFiveChg}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: candle + OHLC */}
        {ohlc && (
          <div className="flex items-start gap-1.5 shrink-0">
            <MiniCandle ohlc={ohlc} />
            <div className="flex flex-col gap-0.5">
              <span className="text-[8px] text-ink-disabled uppercase tracking-wider leading-none">5d</span>
              <OhlcGrid ohlc={ohlc} />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Widget ────────────────────────────────────────────────────────────────────

export function MarketPulseWidget({ config }: { config: WidgetConfig }) {
  const { data: setIndices = [], isLoading: setLoading, dataUpdatedAt: setUpdatedAt } = useQuery<SetIndex[]>({
    queryKey: ['market-set-indices'],
    queryFn:  () => portfolioTrackerService.getSetIndices(),
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const { data: globalIndices = [], isLoading: globalLoading, dataUpdatedAt: globalUpdatedAt } = useQuery<GlobalIndex[]>({
    queryKey: ['market-global-indices'],
    queryFn:  () => portfolioTrackerService.getGlobalIndices(),
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const lastUpdated = useMemo(() => {
    const ts = Math.max(setUpdatedAt ?? 0, globalUpdatedAt ?? 0)
    return ts ? formatDistanceToNowStrict(new Date(ts), { addSuffix: true }) : null
  }, [setUpdatedAt, globalUpdatedAt])

  const isLoading = setLoading && globalLoading

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-36 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-36 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-2 overflow-auto">
      {lastUpdated && (
        <div className="flex justify-end shrink-0">
          <span className="text-[10px] text-ink-disabled">Updated {lastUpdated}</span>
        </div>
      )}

      {setIndices.length > 0 && (
        <div className="space-y-1 shrink-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Thai Market</span>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${setIndices.length}, minmax(0, 1fr))` }}>
            {setIndices.map(idx => (
              <IndexCard key={idx.name} name={idx.name} value={idx.value}
                change={idx.change} changePct={idx.changePct} ohlc={idx.ohlc} />
            ))}
          </div>
        </div>
      )}

      {globalIndices.length > 0 && (
        <div className="space-y-1 shrink-0">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Global Market</span>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${globalIndices.length}, minmax(0, 1fr))` }}>
            {globalIndices.map(idx => (
              <IndexCard key={idx.name} name={idx.name} value={idx.value}
                change={idx.change} changePct={idx.changePct} ohlc={idx.ohlc} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
