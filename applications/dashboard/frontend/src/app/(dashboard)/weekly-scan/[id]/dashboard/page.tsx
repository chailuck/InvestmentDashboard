'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, BarChart2,
  Loader2, AlertCircle, Target, Upload, X, Check, ShoppingCart,
} from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  weeklyScanService, COLOR_MARKS, SCAN_STRATEGIES,
  colorMarkMeta, type WeeklyScanItem, type ColorMark,
} from '@/services/weeklyScan'
import { actionPlanService, type PlanSummary, type PurchaseItem } from '@/services/actionPlan'
import { portfolioTrackerService, type SetIndex } from '@/services/portfolioTracker'

// ── Helpers ────────────────────────────────────────────────────────────────────

function pnl(mon: number | null, fri: number | null): number | null {
  if (mon == null || fri == null || mon === 0) return null
  return (fri - mon) / mon * 100
}

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtPrice(v: number | null): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="card px-4 py-3 space-y-0.5">
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{label}</p>
      <p className={cn('text-xl font-bold', accent ?? 'text-ink-primary')}>{value}</p>
      {sub && <p className="text-[11px] text-ink-disabled">{sub}</p>}
    </div>
  )
}

// ── Color distribution chart ───────────────────────────────────────────────────

function ColorDistChart({ items }: { items: WeeklyScanItem[] }) {
  const data = COLOR_MARKS.map(c => ({
    name: c.label,
    value: items.filter(i => i.color_mark === c.value).length,
    color: c.dot.replace('bg-', ''),
  }))
  const pending = items.filter(i => !i.color_mark).length

  const colors = ['#06B6D4', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#334155']
  const allData = [
    ...COLOR_MARKS.map((c, i) => ({ name: c.label, value: data[i].value, itemStyle: { color: colors[i] } })),
    { name: 'Pending', value: pending, itemStyle: { color: '#334155' } },
  ].filter(d => d.value > 0)

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      bottom: 0, textStyle: { color: '#64748b', fontSize: 10 },
      formatter: (name: string) => {
        const d = allData.find(x => x.name === name)
        return `${name} (${d?.value ?? 0})`
      },
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '42%'],
      data: allData,
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
    }],
  }

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-3">Color Distribution</p>
      <ReactECharts option={option} style={{ height: 240 }} opts={{ renderer: 'canvas' }} />
    </div>
  )
}

// ── Strategy distribution chart ────────────────────────────────────────────────

function StrategyDistChart({ items }: { items: WeeklyScanItem[] }) {
  const strategies = SCAN_STRATEGIES.concat(['(none)'])
  const counts = strategies.map(s =>
    s === '(none)'
      ? items.filter(i => !i.strategy).length
      : items.filter(i => i.strategy === s).length
  ).filter((_, i) => {
    const cnt = strategies.map(s =>
      s === '(none)' ? items.filter(x => !x.strategy).length
        : items.filter(x => x.strategy === s).length
    )[i]
    return cnt > 0
  })
  const labels = strategies.filter((_, i) => {
    const s = strategies[i]
    const cnt = s === '(none)' ? items.filter(x => !x.strategy).length
      : items.filter(x => x.strategy === s).length
    return cnt > 0
  })

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 80, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 9 }, splitLine: { lineStyle: { color: '#1a2332' } } },
    yAxis: {
      type: 'category', data: labels,
      axisLabel: { color: '#94a3b8', fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'bar', data: counts, barMaxWidth: 20,
      itemStyle: { color: '#3B82F6', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: '#64748b', fontSize: 10 },
    }],
  }

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-3">Strategy Distribution</p>
      <ReactECharts option={option} style={{ height: 240 }} opts={{ renderer: 'canvas' }} />
    </div>
  )
}

// ── Performance chart ──────────────────────────────────────────────────────────

function PerformanceChart({ items, prices }: {
  items: WeeklyScanItem[]
  prices: Record<string, { mon: number | null; fri: number | null }>
}) {
  const withPnl = items
    .map(item => {
      const p = prices[item.symbol]
      const pct = pnl(p?.mon ?? null, p?.fri ?? null)
      return { ...item, pct }
    })
    .filter(i => i.pct !== null)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))

  if (withPnl.length === 0) return (
    <div className="card p-4 flex items-center justify-center h-48 text-ink-muted text-sm gap-2">
      <AlertCircle className="w-4 h-4" /> No price data available for P&L chart.
    </div>
  )

  const colorMap: Record<string, string> = {
    CYAN: '#06B6D4', GREEN: '#22C55E', YELLOW: '#F59E0B',
    RED: '#EF4444', PURPLE: '#A855F7',
  }

  const barColors = withPnl.map(i =>
    i.pct! >= 0
      ? (colorMap[i.color_mark ?? ''] ?? 'rgba(34,197,94,0.7)')
      : 'rgba(239,68,68,0.7)'
  )

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (p: any[]) => `<b>${p[0].axisValue}</b><br/>${fmtPct(p[0].data)}`,
    },
    grid: { left: 55, right: 20, top: 10, bottom: 40 },
    xAxis: {
      type: 'category',
      data: withPnl.map(i => i.symbol),
      axisLabel: { color: '#64748b', fontSize: 9, rotate: 45, interval: 0 },
      axisLine: { lineStyle: { color: '#2d3748' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `${v.toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#1a2332', type: 'dashed' } },
    },
    series: [{
      type: 'bar', data: withPnl.map(i => i.pct!), barMaxWidth: 20,
      itemStyle: { color: (p: any) => barColors[p.dataIndex], borderRadius: [3, 3, 0, 0] },
    }],
  }

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-3">Weekly P&L by Symbol</p>
      <ReactECharts option={option} style={{ height: 280 }} opts={{ renderer: 'canvas' }} />
    </div>
  )
}

// ── Performance table ──────────────────────────────────────────────────────────

function PerformanceTable({ items, prices, monDate, friDate }: {
  items: WeeklyScanItem[]
  prices: Record<string, { mon: number | null; fri: number | null }>
  monDate: string | null
  friDate: string | null
}) {
  const rows = items
    .map(item => {
      const p = prices[item.symbol] ?? { mon: null, fri: null }
      return { ...item, monPrice: p.mon, friPrice: p.fri, pct: pnl(p.mon, p.fri) }
    })
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0
      if (a.pct === null) return 1
      if (b.pct === null) return -1
      return b.pct - a.pct
    })

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">Performance Detail</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-surface-elevated/60 text-ink-muted">
              <th className="px-3 py-2 text-left font-medium">Symbol</th>
              <th className="px-3 py-2 text-left font-medium">Mark</th>
              <th className="px-3 py-2 text-left font-medium">Strategy</th>
              <th className="px-3 py-2 text-right font-medium">
                Mon{monDate ? <span className="ml-1 font-normal text-[10px] text-ink-disabled">{format(new Date(monDate), 'dd MMM')}</span> : ''}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Fri{friDate ? <span className="ml-1 font-normal text-[10px] text-ink-disabled">{format(new Date(friDate), 'dd MMM')}</span> : ''}
              </th>
              <th className="px-3 py-2 text-right font-medium">W-P&L</th>
              <th className="px-3 py-2 text-left font-medium">List</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const meta = row.color_mark ? colorMarkMeta(row.color_mark as ColorMark) : null
              return (
                <tr key={row.id}
                  className={cn('border-b border-border/20 transition-colors',
                    meta ? `${meta.bg.replace('/20', '/5')} hover:${meta.bg.replace('/20', '/10')}` : 'hover:bg-surface-elevated/40')}>
                  <td className="px-3 py-2 font-bold font-mono text-ink-primary">{row.symbol}</td>
                  <td className="px-3 py-2">
                    {meta
                      ? <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', meta.bg, meta.text, meta.border)}>{meta.label}</span>
                      : <span className="text-ink-disabled text-[10px]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">{row.strategy ?? <span className="text-ink-disabled">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{fmtPrice(row.monPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{fmtPrice(row.friPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.pct === null
                      ? <span className="text-ink-disabled">—</span>
                      : <span className={cn('font-semibold', row.pct >= 0 ? 'text-gain' : 'text-loss')}>{fmtPct(row.pct)}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-disabled text-[10px]">{row.list_name ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Bulk export modal (Feature 1) ──────────────────────────────────────────────

function BulkExportModal({ items, onClose }: { items: WeeklyScanItem[]; onClose: () => void }) {
  const candidates = items.filter(i => i.color_mark === 'CYAN' || i.color_mark === 'GREEN')
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [exportedCount, setExportedCount] = useState(0)

  useEffect(() => {
    actionPlanService.list('purchase', null).then(all => {
      setPlans(all)
      if (all.length > 0) setSelectedId(all[0].id)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const confirm = async () => {
    if (!selectedId || candidates.length === 0) return
    setSaving(true)
    try {
      const plan = await actionPlanService.get(selectedId)
      const existing = plan.purchase_items
      const existingSymbols = new Set(existing.map(p => p.stock.toUpperCase()))

      const newItems: Omit<PurchaseItem, 'id'>[] = candidates
        .filter(item => !existingSymbols.has(item.symbol.toUpperCase()))
        .map((item, idx) => ({
          sort_order: existing.length + idx,
          stock: item.symbol,
          current_price: null,
          size: item.size ?? null,
          buy_price: item.buy_price ?? null,
          tp: item.tp ?? null,
          sl: item.sl ?? null,
          strategy: item.strategy ?? null,
          reason: item.remark ?? null,
          triggered: false,
        }))

      await actionPlanService.update(selectedId, {
        purchase_items: [...existing.map(({ id: _id, ...r }) => r), ...newItems],
      })
      setExportedCount(newItems.length)
      setDone(true)
      setTimeout(onClose, 1500)
    } catch { } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-brand-400" />
            Export CYAN + GREEN to Plan
          </h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/8 border border-brand-500/20 text-xs">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
            <span className="text-ink-secondary">Export <strong className="text-ink-primary">{candidates.length}</strong> symbols ({candidates.filter(i => i.color_mark === 'CYAN').length} Cyan, {candidates.filter(i => i.color_mark === 'GREEN').length} Green) · duplicates will be skipped</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-ink-muted text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading plans…</div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-ink-muted">No purchase plans found. Create one first.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">Select a purchase plan:</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {plans.map(p => (
                  <label key={p.id} className={cn('flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                    selectedId === p.id ? 'border-brand-500/50 bg-brand-500/8' : 'border-border hover:border-border-focus')}>
                    <input type="radio" value={p.id} checked={selectedId === p.id}
                      onChange={() => setSelectedId(p.id)} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink-primary truncate">{p.name}</p>
                      <p className="text-[10px] text-ink-muted">{format(new Date(p.created_at), 'dd MMM yyyy')}</p>
                    </div>
                    {selectedId === p.id && <Check className="w-3.5 h-3.5 text-brand-400 ml-auto shrink-0" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 text-gain text-xs px-3 py-2 rounded-lg bg-gain/10 border border-gain/20">
              <Check className="w-3.5 h-3.5" />
              {exportedCount > 0
                ? `Added ${exportedCount} new symbol${exportedCount !== 1 ? 's' : ''} to plan!`
                : 'All symbols already in plan — nothing added.'}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={confirm}
              disabled={!selectedId || saving || done || candidates.length === 0 || plans.length === 0}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2 disabled:opacity-40">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Upload className="w-3.5 h-3.5" />
              Export {candidates.length}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Review tab — pick performance chart (Feature 2) ───────────────────────────

function ReviewTab({ items, prices, weekPrices }: {
  items: WeeklyScanItem[]
  prices: Record<string, { mon: number | null; fri: number | null }>
  weekPrices: { mon_date: string | null; fri_date: string | null } | null
}) {
  const [set50Pct, setSet50Pct] = useState<number | null>(null)
  const [set50Loading, setSet50Loading] = useState(true)

  useEffect(() => {
    portfolioTrackerService.getSetIndices().then(indices => {
      const set50 = indices.find(i => i.name === 'SET50' || i.name === 'SET 50')
      setSet50Pct(set50?.changePct ?? null)
    }).catch(() => {}).finally(() => setSet50Loading(false))
  }, [])

  const picks = useMemo(() => {
    return items
      .filter(i => i.color_mark === 'CYAN' || i.color_mark === 'GREEN')
      .map(item => {
        const p = prices[item.symbol]
        const ret = (p?.mon && p?.fri && p.mon !== 0)
          ? (p.fri - p.mon) / p.mon * 100
          : null
        return { symbol: item.symbol, color_mark: item.color_mark, ret }
      })
      .filter(i => i.ret !== null)
      .sort((a, b) => (b.ret ?? 0) - (a.ret ?? 0))
  }, [items, prices])

  const accuracy = picks.length > 0
    ? Math.round(picks.filter(p => (p.ret ?? 0) >= 0).length / picks.length * 100)
    : null

  const chartOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (p: any[]) => `<b>${p[0].axisValue}</b><br/>${p[0].data >= 0 ? '+' : ''}${p[0].data.toFixed(2)}%`,
    },
    grid: { left: 55, right: 20, top: 10, bottom: 60 },
    xAxis: {
      type: 'category',
      data: picks.map(p => p.symbol),
      axisLabel: { color: '#64748b', fontSize: 9, rotate: 45, interval: 0 },
      axisLine: { lineStyle: { color: '#2d3748' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `${v.toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#1a2332', type: 'dashed' } },
    },
    series: [{
      type: 'bar',
      data: picks.map(p => ({
        value: p.ret,
        itemStyle: { color: (p.ret ?? 0) >= 0 ? '#22C55E' : '#EF4444', borderRadius: [3, 3, 0, 0] },
      })),
      barMaxWidth: 28,
    }],
  }), [picks])

  if (picks.length === 0) return (
    <div className="card p-8 flex flex-col items-center justify-center gap-3 text-center">
      <AlertCircle className="w-8 h-8 text-ink-disabled" />
      <p className="text-sm text-ink-muted">No CYAN/GREEN picks with price data available for this week.</p>
      <p className="text-xs text-ink-disabled">Prices are fetched from the week dates in the scan name.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Picks Reviewed"
          value={String(picks.length)}
          sub="CYAN + GREEN with prices"
        />
        <StatCard
          label="Accuracy"
          value={accuracy !== null ? `${accuracy}%` : '—'}
          sub={`${picks.filter(p => (p.ret ?? 0) >= 0).length} positive of ${picks.length}`}
          accent={accuracy !== null ? (accuracy >= 50 ? 'text-gain' : 'text-loss') : undefined}
        />
        <StatCard
          label="Best Pick"
          value={picks[0]?.symbol ?? '—'}
          sub={picks[0] ? `+${picks[0].ret!.toFixed(2)}%` : undefined}
          accent="text-gain"
        />
        <StatCard
          label="SET50 This Week"
          value={set50Loading ? '…' : (set50Pct !== null ? `${set50Pct >= 0 ? '+' : ''}${set50Pct.toFixed(2)}%` : '—')}
          sub="Benchmark reference"
          accent={set50Pct !== null ? (set50Pct >= 0 ? 'text-gain' : 'text-loss') : undefined}
        />
      </div>

      {/* Week return bar chart */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">
            CYAN/GREEN Pick Returns
            {weekPrices?.mon_date && weekPrices?.fri_date && (
              <span className="ml-2 text-[10px] text-ink-disabled font-normal">
                {format(new Date(weekPrices.mon_date), 'dd MMM')} – {format(new Date(weekPrices.fri_date), 'dd MMM yyyy')}
              </span>
            )}
          </p>
          {set50Pct !== null && (
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border',
              set50Pct >= 0
                ? 'text-gain bg-gain/10 border-gain/20'
                : 'text-loss bg-loss/10 border-loss/20',
            )}>
              <span>SET50</span>
              <span>{set50Pct >= 0 ? '+' : ''}{set50Pct.toFixed(2)}%</span>
            </div>
          )}
        </div>
        <ReactECharts option={chartOption} style={{ height: 300 }} opts={{ renderer: 'canvas' }} />
      </div>

      {/* Pick table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">Pick Detail</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-surface-elevated/60 text-ink-muted">
              <th className="px-3 py-2 text-left font-medium">Symbol</th>
              <th className="px-3 py-2 text-left font-medium">Mark</th>
              <th className="px-3 py-2 text-right font-medium">Mon Open</th>
              <th className="px-3 py-2 text-right font-medium">Fri Close</th>
              <th className="px-3 py-2 text-right font-medium">W-Return</th>
              <th className="px-3 py-2 text-right font-medium">vs SET50</th>
            </tr>
          </thead>
          <tbody>
            {picks.map(pick => {
              const p = prices[pick.symbol]
              const meta = pick.color_mark ? colorMarkMeta(pick.color_mark as ColorMark) : null
              const diff = (pick.ret !== null && set50Pct !== null) ? pick.ret - set50Pct : null
              return (
                <tr key={pick.symbol} className="border-b border-border/20 hover:bg-surface-elevated/40">
                  <td className="px-3 py-2 font-bold font-mono text-ink-primary">{pick.symbol}</td>
                  <td className="px-3 py-2">
                    {meta
                      ? <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', meta.bg, meta.text, meta.border)}>{meta.label}</span>
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{p?.mon?.toFixed(2) ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{p?.fri?.toFixed(2) ?? '—'}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums font-semibold', (pick.ret ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                    {pick.ret !== null ? `${pick.ret >= 0 ? '+' : ''}${pick.ret.toFixed(2)}%` : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right tabular-nums text-[10px]', diff === null ? 'text-ink-disabled' : diff >= 0 ? 'text-gain' : 'text-loss')}>
                    {diff !== null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ScanDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const defaultTabApplied = useRef(false)
  const [dashTab, setDashTab] = useState<'overview' | 'review'>('overview')
  const [showExportModal, setShowExportModal] = useState(false)

  const { data: scan, isLoading: scanLoading, refetch: refetchScan } = useQuery({
    queryKey: ['weekly-scan', id],
    queryFn: () => weeklyScanService.getScan(id),
    staleTime: 30_000,
  })

  const { data: weekPrices, isLoading: pricesLoading, refetch: refetchPrices } = useQuery({
    queryKey: ['weekly-scan-prices', id],
    queryFn: () => weeklyScanService.getWeekPrices(id),
    staleTime: 5 * 60_000,
    enabled: !!scan,
  })

  const loading = scanLoading || pricesLoading

  // Derive list tabs
  const listTabs = useMemo(() => {
    if (!scan) return []
    return [...new Set(scan.items.map(i => i.list_name).filter((n): n is string => !!n))]
  }, [scan])

  // Auto-select first list tab on initial load
  useEffect(() => {
    if (!defaultTabApplied.current && listTabs.length > 0) {
      setActiveTab(listTabs[0])
      defaultTabApplied.current = true
    }
  }, [listTabs.length]) // eslint-disable-line

  // Items filtered by active tab
  const filteredItems = useMemo(() => {
    if (!scan) return []
    return activeTab === null ? scan.items : scan.items.filter(i => i.list_name === activeTab)
  }, [scan, activeTab])

  const prices = weekPrices?.prices ?? {}

  // Aggregate stats
  const stats = useMemo(() => {
    if (!filteredItems.length) return null
    const evaluated  = filteredItems.filter(i => i.color_mark).length
    const withPrices = filteredItems.filter(i => prices[i.symbol]?.mon && prices[i.symbol]?.fri)
    const pnlValues  = withPrices
      .map(i => pnl(prices[i.symbol].mon, prices[i.symbol].fri))
      .filter((v): v is number => v !== null)
    const avgPnl    = pnlValues.length ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length : null
    const bestItem  = withPrices.reduce<WeeklyScanItem | null>((best, item) => {
      const p = pnl(prices[item.symbol].mon, prices[item.symbol].fri)
      if (p === null) return best
      const bp = best ? pnl(prices[best.symbol].mon, prices[best.symbol].fri) : null
      return bp === null || p > bp ? item : best
    }, null)
    const topStrategy = (() => {
      const cnt: Record<string, number> = {}
      filteredItems.forEach(i => { if (i.strategy) cnt[i.strategy] = (cnt[i.strategy] ?? 0) + 1 })
      return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    })()
    return { evaluated, total: filteredItems.length, avgPnl, bestItem, topStrategy }
  }, [filteredItems, prices])

  const refresh = () => { refetchScan(); refetchPrices() }

  if (scanLoading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading dashboard…
    </div>
  )

  if (!scan) return (
    <div className="flex items-center justify-center h-64 gap-2 text-loss">
      <AlertCircle className="w-5 h-5" /> Scan not found.
    </div>
  )

  const cyanGreenCount = filteredItems.filter(i => i.color_mark === 'CYAN' || i.color_mark === 'GREEN').length

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/action-plan')} className="btn-icon">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-brand-400 shrink-0" />
            <h1 className="text-lg font-bold text-ink-primary font-mono truncate">{scan.name}</h1>
          </div>
          <p className="text-xs text-ink-muted mt-0.5 ml-7">
            Dashboard · {scan.items.length} symbols ·{' '}
            {weekPrices?.mon_date && weekPrices?.fri_date
              ? `Week ${format(new Date(weekPrices.mon_date), 'dd MMM')} – ${format(new Date(weekPrices.fri_date), 'dd MMM yyyy')}`
              : 'No week date'}
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="btn-icon disabled:opacity-40" title="Refresh data">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
        {/* Feature 1 — Bulk export button */}
        <button
          onClick={() => setShowExportModal(true)}
          disabled={cyanGreenCount === 0}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-30"
          title="Export CYAN and GREEN picks to a purchase plan">
          <Upload className="w-3.5 h-3.5" />
          Export {cyanGreenCount} to Plan
        </button>
        <button onClick={() => router.push(`/weekly-scan/${id}`)}
          className="text-xs px-3 py-1.5 rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors">
          Open Scan
        </button>
      </div>

      {/* Feature 2 — Dashboard tab switcher */}
      <div className="flex items-center gap-1 border-b border-border/40">
        {(['overview', 'review'] as const).map(tab => (
          <button key={tab} onClick={() => setDashTab(tab)}
            className={cn(
              'px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px',
              dashTab === tab
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-ink-muted hover:text-ink-primary',
            )}>
            {tab === 'overview' ? 'Overview' : 'Review'}
          </button>
        ))}
      </div>

      {/* Symbol list tabs */}
      {listTabs.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setActiveTab(null)}
            className={cn('px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
              activeTab === null
                ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
            All <span className="ml-1 text-[10px] opacity-60">{scan.items.length}</span>
          </button>
          {listTabs.map(name => (
            <button key={name} onClick={() => setActiveTab(name)}
              className={cn('px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                activeTab === name
                  ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                  : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
              {name} <span className="ml-1 text-[10px] opacity-60">{scan.items.filter(i => i.list_name === name).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Feature 2 — Review tab content */}
      {dashTab === 'review' ? (
        <ReviewTab items={filteredItems} prices={prices} weekPrices={weekPrices ?? null} />
      ) : (
        <>
          {/* Stat cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Total Symbols"
                value={String(stats.total)}
                sub={`${stats.evaluated} evaluated`}
              />
              <StatCard
                label="Evaluated"
                value={`${Math.round(stats.evaluated / stats.total * 100)}%`}
                sub={`${stats.total - stats.evaluated} pending`}
                accent={stats.evaluated === stats.total ? 'text-gain' : 'text-ink-primary'}
              />
              <StatCard
                label="Avg Weekly P&L"
                value={fmtPct(stats.avgPnl)}
                sub={pricesLoading ? 'loading prices…' : `${Object.values(prices).filter(p => p.mon && p.fri).length} symbols with prices`}
                accent={stats.avgPnl === null ? undefined : stats.avgPnl >= 0 ? 'text-gain' : 'text-loss'}
              />
              <StatCard
                label="Best Performer"
                value={stats.bestItem?.symbol ?? '—'}
                sub={stats.bestItem
                  ? fmtPct(pnl(prices[stats.bestItem.symbol]?.mon ?? null, prices[stats.bestItem.symbol]?.fri ?? null))
                  : undefined}
                accent="text-gain"
              />
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ColorDistChart items={filteredItems} />
            <StrategyDistChart items={filteredItems} />
          </div>

          {/* Performance bar chart */}
          <PerformanceChart items={filteredItems} prices={prices} />

          {/* Performance detail table */}
          <PerformanceTable
            items={filteredItems}
            prices={prices}
            monDate={weekPrices?.mon_date ?? null}
            friDate={weekPrices?.fri_date ?? null}
          />
        </>
      )}

      {/* Feature 1 — Bulk export modal */}
      <AnimatePresence>
        {showExportModal && (
          <BulkExportModal items={filteredItems} onClose={() => setShowExportModal(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
