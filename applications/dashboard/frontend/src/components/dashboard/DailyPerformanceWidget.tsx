'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react'
import { apiClient } from '@/services/api'
import type { WidgetConfig } from '@/types'

interface Portfolio {
  id: string
  name: string
  is_default: boolean
}

interface DailyRecord {
  date: string
  investment: number
  open_pnl: number
  open_pnl_pct: number
  closed_pnl: number
  acc_pnl: number | null
  sold_positions: Array<{ pnl?: number }> | null
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function SignBadge({ value, pct }: { value: number; pct?: number }) {
  const pos = value >= 0
  const color = pos ? '#22c55e' : '#ef4444'
  const Icon = pos ? TrendingUp : TrendingDown
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 3, fontVariantNumeric: 'tabular-nums' }}>
      <Icon size={12} />
      {fmt(value)}
      {pct !== undefined && (
        <span style={{ fontSize: 10, opacity: 0.75 }}>({fmtPct(pct)})</span>
      )}
    </span>
  )
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
      <span style={{ fontSize: 11, color: 'rgba(160,160,160,0.7)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{children}</span>
    </div>
  )
}

export function DailyPerformanceWidget({ config: _config }: { config: WidgetConfig }) {
  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ['portfolios-dp-widget'],
    queryFn: async () => {
      const res = await apiClient.get<Portfolio[]>('/portfolios')
      return res.data
    },
    staleTime: 300_000,
  })

  const defaultPortfolio = portfolios?.find((p) => p.is_default) ?? portfolios?.[0]

  const today = new Date().toISOString().split('T')[0]
  const from = (() => {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })()

  const { data: records, isLoading } = useQuery<DailyRecord[]>({
    queryKey: ['daily-perf-widget', defaultPortfolio?.id],
    queryFn: async () => {
      const res = await apiClient.get<DailyRecord[]>(
        `/daily-performance?portfolio_id=${defaultPortfolio!.id}&from_date=${from}&to_date=${today}`
      )
      return res.data
    },
    enabled: !!defaultPortfolio,
    staleTime: 300_000,
    refetchInterval: 10 * 60_000,
  })

  const latest = records
    ?.slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

  const dailyPnl = latest?.sold_positions?.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0
  const totalPort = latest ? latest.investment + latest.closed_pnl + latest.open_pnl : 0

  return (
    <div className="card p-4 h-full flex flex-col gap-3">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={14} style={{ color: '#f59e0b' }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Daily Performance</span>
        </div>
        {latest && (
          <span style={{ fontSize: 10, color: 'rgba(160,160,160,0.55)', fontFamily: 'monospace' }}>
            {latest.date}
          </span>
        )}
      </div>

      {isLoading || !defaultPortfolio ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'rgba(128,128,128,0.5)' }}>Loading…</span>
        </div>
      ) : !latest ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'rgba(128,128,128,0.5)' }}>No records yet — run a snapshot first.</span>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          {/* Total Port — hero number */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'rgba(160,160,160,0.6)', marginBottom: 2 }}>Total Portfolio Value</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(totalPort)}
            </div>
          </div>

          <div>
            <StatRow label="Investment">
              <span style={{ color: '#3b82f6', fontVariantNumeric: 'tabular-nums' }}>{fmt(latest.investment)}</span>
            </StatRow>
            <StatRow label="Open P&L">
              <SignBadge value={latest.open_pnl} pct={latest.open_pnl_pct} />
            </StatRow>
            <StatRow label="Daily P&L">
              <SignBadge value={dailyPnl} />
            </StatRow>
            <StatRow label="Acc. P&L">
              {latest.acc_pnl != null ? (
                <SignBadge value={latest.acc_pnl} />
              ) : (
                <span style={{ color: 'rgba(128,128,128,0.5)', fontSize: 11 }}>—</span>
              )}
            </StatRow>
          </div>
        </div>
      )}
    </div>
  )
}
