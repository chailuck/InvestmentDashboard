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

  const updateRow = (symbol: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r.symbol === symbol ? { ...r, ...patch } : r))

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
        Edit TP, SL, and Order Size, then save.
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-ink-muted text-sm">
            No open positions found. Press <span className="text-brand-400 font-medium">Refresh</span> to load portfolio data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-border/50 bg-surface-elevated/40">
                  {['SYMBOL', 'CURRENT', 'SIZE', 'ENTRY', 'TP', 'SL', 'ORDER SIZE'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'px-3 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap',
                        i === 0 && 'pl-4',
                        i === 6 && 'pr-4',
                        i >= 4 && 'text-brand-400',  // editable columns highlighted
                      )}
                    >
                      {h}
                      {i >= 4 && <span className="ml-1 text-[9px] font-normal text-brand-500/60">editable</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.symbol} className="border-b border-border/25 hover:bg-surface-elevated/30 transition-colors">
                    <td className="px-3 py-2 pl-4 font-semibold text-ink-primary">{row.symbol}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-primary font-medium">
                      {row.current_price != null ? row.current_price.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-secondary">
                      {row.size != null ? row.size.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-secondary">
                      {row.entry_price != null ? row.entry_price.toFixed(2) : '—'}
                    </td>
                    {/* TP — editable */}
                    <td className="px-3 py-2 w-[100px]">
                      <NumInput
                        value={row.tp}
                        onChange={v => updateRow(row.symbol, { tp: v })}
                        placeholder="TP"
                      />
                    </td>
                    {/* SL — editable */}
                    <td className="px-3 py-2 w-[100px]">
                      <NumInput
                        value={row.sl}
                        onChange={v => updateRow(row.symbol, { sl: v })}
                        placeholder="SL"
                      />
                    </td>
                    {/* ORDER SIZE — editable */}
                    <td className="px-3 py-2 pr-4 w-[110px]">
                      <NumInput
                        value={row.order_size}
                        onChange={v => updateRow(row.symbol, { order_size: v != null ? Math.round(v) : null })}
                        placeholder="Qty"
                      />
                    </td>
                  </tr>
                ))}
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
