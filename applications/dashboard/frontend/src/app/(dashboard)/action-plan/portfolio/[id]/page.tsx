'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, FileDown, Copy, CheckCircle2,
  Loader2, X, RefreshCw, AlertCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { actionPlanService } from '@/services/actionPlan'
import { portfolioTrackerService } from '@/services/portfolioTracker'

// ── Row type ──────────────────────────────────────────────────────────────────

interface Row {
  symbol: string
  current_price: number | null
  size: number | null
  entry_price: number | null
  tp: number | null
  sl: number | null
  order_size: number | null
}

// ── Derived calcs ─────────────────────────────────────────────────────────────

function calcPnl(price: number | null, entry: number | null, size: number | null) {
  if (price == null || entry == null || size == null) return null
  return (price - entry) * size
}

function calcPnlPct(price: number | null, entry: number | null) {
  if (price == null || entry == null || entry === 0) return null
  return ((price - entry) / entry) * 100
}

function fmtPnl(v: number | null) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(v: number | null) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

// ── Generate modal ────────────────────────────────────────────────────────────

function GenerateModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-semibold text-ink-primary">Portfolio Action</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                copied
                  ? 'bg-gain/15 text-gain border-gain/30'
                  : 'bg-surface-elevated border-border text-ink-muted hover:text-ink-primary',
              )}
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <pre className="p-5 text-xs font-mono text-ink-secondary whitespace-pre-wrap leading-5 max-h-[60vh] overflow-auto">
          {text}
        </pre>
      </motion.div>
    </div>
  )
}

// ── Editable number cell ──────────────────────────────────────────────────────

const NumInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) => (
  <input
    type="number"
    step="any"
    value={value ?? ''}
    onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
    placeholder={placeholder}
    className="input text-xs py-1 px-1.5 w-full text-right tabular-nums"
  />
)

// ── P&L cell (read-only colored) ──────────────────────────────────────────────

function PnlCell({ value, pct }: { value: number | null; pct: number | null }) {
  const isNull = value == null
  const up = value != null && value >= 0
  return (
    <td className="px-2 py-2 tabular-nums text-right whitespace-nowrap">
      <div className={cn('text-[11px] font-medium', isNull ? 'text-ink-disabled' : up ? 'text-gain' : 'text-loss')}>
        {fmtPnl(value)}
      </div>
      <div className={cn('text-[10px]', isNull ? 'text-ink-disabled' : up ? 'text-gain/70' : 'text-loss/70')}>
        {fmtPct(pct)}
      </div>
    </td>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioPlanEditor() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [planName, setPlanName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)
  const [generateText, setGenerateText] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // ── Load plan + positions ─────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [plan, posData] = await Promise.all([
        actionPlanService.get(id),
        portfolioTrackerService.getPositions({ status: 'active' }),
      ])
      setPlanName(plan.name)

      // Build a lookup map from saved plan items: symbol → { tp, sl, order_size }
      const savedMap = new Map(
        plan.portfolio_items.map(i => [i.symbol.toUpperCase(), i])
      )

      // Merge: positions drive the base data; saved items supply TP/SL/order_size
      const merged: Row[] = (posData.positions ?? []).map((pos: any) => {
        const sym = (pos.symbol ?? '').toUpperCase()
        const saved = savedMap.get(sym)
        return {
          symbol: sym,
          current_price: pos.currentPrice ?? null,
          size: pos.positionSize ?? null,
          entry_price: pos.entryPrice ?? null,
          tp: saved?.tp ?? null,
          sl: saved?.sl ?? null,
          order_size: saved?.order_size ?? null,
        }
      })
      setRows(merged)
    } catch (e) {
      console.error('Failed to load portfolio plan', e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  // ── Refresh portfolio (copy Excel + reload) ───────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      await portfolioTrackerService.refresh()
      await loadData()
      setRefreshMsg('Portfolio data refreshed.')
    } catch (e: any) {
      setRefreshMsg(e?.response?.data?.detail ?? 'Refresh failed.')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(null), 4000)
    }
  }

  // ── Row update ────────────────────────────────────────────────────────────

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      await actionPlanService.update(id, {
        name: planName,
        portfolio_items: rows.map((r, i) => ({
          sort_order: i,
          symbol: r.symbol,
          current_price: r.current_price,
          size: r.size,
          entry_price: r.entry_price,
          tp: r.tp,
          sl: r.sl,
          order_size: r.order_size,
        })),
      })
      setSaveMsg('ok')
    } catch {
      setSaveMsg('err')
    } finally {
      setSaving(false)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  const generate = () => {
    const lines = ['PORTFOLIO ACTION PLAN', 'STOCK,TP,SL,ORDER SIZE']
    rows.forEach(r => {
      if (!r.symbol) return
      lines.push(`${r.symbol},${r.tp ?? ''},${r.sl ?? ''},${r.order_size ?? ''}`)
    })
    setGenerateText(lines.join('\n'))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading portfolio plan…
      </div>
    )
  }

  // Column header groups
  const headers = [
    { label: 'SYMBOL',      span: 1, editable: false },
    { label: 'CURRENT',     span: 1, editable: false },
    { label: 'SIZE',        span: 1, editable: false },
    { label: 'ENTRY',       span: 1, editable: false },
    { label: 'CURRENT P&L', span: 2, editable: false, sub: 'Amt / %' },
    { label: 'ORDER SIZE',  span: 1, editable: true  },
    { label: 'TP',          span: 1, editable: true  },
    { label: 'TP P&L',      span: 2, editable: false, sub: 'Amt / %' },
    { label: 'SL',          span: 1, editable: true  },
    { label: 'SL P&L',      span: 2, editable: false, sub: 'Amt / %' },
    { label: 'REMAINING',   span: 1, editable: false, sub: 'Order Size' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/action-plan')} className="btn-icon">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <input
            value={planName}
            onChange={e => setPlanName(e.target.value)}
            className="input text-base font-semibold py-1 px-2 w-full max-w-xs"
            placeholder="Plan name"
          />
          <p className="text-[11px] text-ink-muted mt-0.5">Portfolio Action Plan</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh portfolio data */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
            title="Re-copy Excel and reload positions"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>

          <button
            onClick={generate}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <FileDown className="w-3.5 h-3.5" />
            Generate PortAction
          </button>

          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>

          {saveMsg === 'ok' && (
            <span className="text-xs text-gain flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {saveMsg === 'err' && (
            <span className="text-xs text-loss">Save failed</span>
          )}
        </div>
      </div>

      {/* Refresh status */}
      {refreshMsg && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs border',
          refreshMsg.includes('failed') || refreshMsg.includes('Failed')
            ? 'bg-loss/8 border-loss/20 text-loss'
            : 'bg-gain/8 border-gain/20 text-gain',
        )}>
          {refreshMsg.includes('failed') || refreshMsg.includes('Failed')
            ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          {refreshMsg}
        </div>
      )}

      {/* Info */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/8 border border-brand-500/20 text-brand-400 text-xs">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Position data (Symbol, Price, Size, Entry) is pulled live from the portfolio tracker.
        Edit Order Size, TP, and SL, then save.
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-ink-muted text-sm">
            No open positions found. Press <span className="text-brand-400 font-medium">Refresh</span> to load portfolio data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="border-b border-border/50 bg-surface-elevated/40">
                  {/* SYMBOL */}
                  <th className="px-3 py-2.5 pl-4 text-left font-semibold text-ink-muted whitespace-nowrap">SYMBOL</th>
                  {/* CURRENT */}
                  <th className="px-3 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">CURRENT</th>
                  {/* SIZE */}
                  <th className="px-3 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">SIZE</th>
                  {/* ENTRY */}
                  <th className="px-3 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">ENTRY</th>
                  {/* CURRENT P&L (2 sub-cols) */}
                  <th colSpan={2} className="px-2 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                    CURRENT P&L
                    <div className="text-[9px] font-normal text-ink-disabled">Amt / %</div>
                  </th>
                  {/* ORDER SIZE — editable */}
                  <th className="px-3 py-2.5 text-center font-semibold text-brand-400 whitespace-nowrap border-l border-border/30">
                    ORDER SIZE
                    <span className="ml-1 text-[9px] font-normal text-brand-500/60">editable</span>
                  </th>
                  {/* TP — editable */}
                  <th className="px-3 py-2.5 text-center font-semibold text-brand-400 whitespace-nowrap border-l border-border/30">
                    TP
                    <span className="ml-1 text-[9px] font-normal text-brand-500/60">editable</span>
                  </th>
                  {/* TP P&L (2 sub-cols) */}
                  <th colSpan={2} className="px-2 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                    TP P&L
                    <div className="text-[9px] font-normal text-ink-disabled">Amt / %</div>
                  </th>
                  {/* SL — editable */}
                  <th className="px-3 py-2.5 text-center font-semibold text-brand-400 whitespace-nowrap border-l border-border/30">
                    SL
                    <span className="ml-1 text-[9px] font-normal text-brand-500/60">editable</span>
                  </th>
                  {/* SL P&L (2 sub-cols) */}
                  <th colSpan={2} className="px-2 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                    SL P&L
                    <div className="text-[9px] font-normal text-ink-disabled">Amt / %</div>
                  </th>
                  {/* REMAINING ORDER SIZE */}
                  <th className="px-3 py-2.5 pr-4 text-right font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                    REMAINING
                    <div className="text-[9px] font-normal text-ink-disabled">Order Size</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const curPnl    = calcPnl(row.current_price, row.entry_price, row.size)
                  const curPnlPct = calcPnlPct(row.current_price, row.entry_price)
                  const tpPnl     = calcPnl(row.tp, row.entry_price, row.size)
                  const tpPnlPct  = calcPnlPct(row.tp, row.entry_price)
                  const slPnl     = calcPnl(row.sl, row.entry_price, row.size)
                  const slPnlPct  = calcPnlPct(row.sl, row.entry_price)
                  const remaining = row.order_size != null && row.size != null
                    ? row.order_size - row.size
                    : null

                  return (
                    <tr key={idx} className="border-b border-border/25 hover:bg-surface-elevated/30 transition-colors">
                      {/* SYMBOL */}
                      <td className="px-3 py-2 pl-4 font-semibold text-ink-primary">{row.symbol}</td>
                      {/* CURRENT */}
                      <td className="px-3 py-2 tabular-nums text-ink-primary font-medium text-right">
                        {row.current_price != null ? row.current_price.toFixed(2) : '—'}
                      </td>
                      {/* SIZE */}
                      <td className="px-3 py-2 tabular-nums text-ink-secondary text-right">
                        {row.size != null ? row.size.toLocaleString() : '—'}
                      </td>
                      {/* ENTRY */}
                      <td className="px-3 py-2 tabular-nums text-ink-secondary text-right">
                        {row.entry_price != null ? row.entry_price.toFixed(2) : '—'}
                      </td>
                      {/* CURRENT P&L (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 tabular-nums text-right whitespace-nowrap">
                        <div className={cn('text-[11px] font-medium', curPnl == null ? 'text-ink-disabled' : curPnl >= 0 ? 'text-gain' : 'text-loss')}>
                          {fmtPnl(curPnl)}
                        </div>
                        <div className={cn('text-[10px]', curPnlPct == null ? 'text-ink-disabled' : curPnlPct >= 0 ? 'text-gain/70' : 'text-loss/70')}>
                          {fmtPct(curPnlPct)}
                        </div>
                      </td>
                      {/* placeholder for 2nd P&L sub-col (merged above with colSpan=2, so this is the right half) */}
                      <td className="w-0 p-0" />

                      {/* ORDER SIZE — editable (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 w-[100px]">
                        <NumInput
                          value={row.order_size}
                          onChange={v => updateRow(idx, { order_size: v != null ? Math.round(v) : null })}
                          placeholder="Qty"
                        />
                      </td>

                      {/* TP — editable (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 w-[90px]">
                        <NumInput
                          value={row.tp}
                          onChange={v => updateRow(idx, { tp: v })}
                          placeholder="TP"
                        />
                      </td>
                      {/* TP P&L (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 tabular-nums text-right whitespace-nowrap">
                        <div className={cn('text-[11px] font-medium', tpPnl == null ? 'text-ink-disabled' : tpPnl >= 0 ? 'text-gain' : 'text-loss')}>
                          {fmtPnl(tpPnl)}
                        </div>
                        <div className={cn('text-[10px]', tpPnlPct == null ? 'text-ink-disabled' : tpPnlPct >= 0 ? 'text-gain/70' : 'text-loss/70')}>
                          {fmtPct(tpPnlPct)}
                        </div>
                      </td>
                      <td className="w-0 p-0" />

                      {/* SL — editable (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 w-[90px]">
                        <NumInput
                          value={row.sl}
                          onChange={v => updateRow(idx, { sl: v })}
                          placeholder="SL"
                        />
                      </td>
                      {/* SL P&L (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 tabular-nums text-right whitespace-nowrap">
                        <div className={cn('text-[11px] font-medium', slPnl == null ? 'text-ink-disabled' : slPnl >= 0 ? 'text-gain' : 'text-loss')}>
                          {fmtPnl(slPnl)}
                        </div>
                        <div className={cn('text-[10px]', slPnlPct == null ? 'text-ink-disabled' : slPnlPct >= 0 ? 'text-gain/70' : 'text-loss/70')}>
                          {fmtPct(slPnlPct)}
                        </div>
                      </td>
                      <td className="w-0 p-0" />

                      {/* REMAINING ORDER SIZE (border-l) */}
                      <td className="border-l border-border/30 px-3 py-2 pr-4 tabular-nums text-right whitespace-nowrap">
                        {remaining == null ? (
                          <span className="text-ink-disabled">—</span>
                        ) : (
                          <span className={cn('font-medium', remaining > 0 ? 'text-brand-400' : remaining < 0 ? 'text-warning' : 'text-ink-muted')}>
                            {remaining > 0 ? '+' : ''}{remaining.toLocaleString()}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate modal */}
      {generateText && (
        <GenerateModal text={generateText} onClose={() => setGenerateText(null)} />
      )}
    </div>
  )
}
