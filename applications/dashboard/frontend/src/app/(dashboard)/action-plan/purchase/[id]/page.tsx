'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Save, FileDown, Copy, CheckCircle2,
  Loader2, AlertTriangle, XCircle, X, RefreshCw,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { actionPlanService } from '@/services/actionPlan'

// ── Constants ─────────────────────────────────────────────────────────────────

const STRATEGIES = ['BREAK OUT', 'BUY ON DIP', 'แท่งเทียนกลับตัว', 'NEWS', 'AJ PAO', 'OTHERS'] as const
type StrategyOption = (typeof STRATEGIES)[number]

// ── Row type ──────────────────────────────────────────────────────────────────

interface Row {
  _key: string
  stock: string
  current_price: number | null
  size: number | null
  buy_price: number | null
  tp: number | null
  sl: number | null
  strategy: string        // one of STRATEGIES or free text (when OTHERS)
  customStrategy: string  // extra text input when strategy === 'OTHERS'
  fetchingPrice: boolean
}

let _rowId = 0
const newRow = (): Row => ({
  _key: `r${++_rowId}`,
  stock: '',
  current_price: null,
  size: null,
  buy_price: null,
  tp: null,
  sl: null,
  strategy: 'BREAK OUT',
  customStrategy: '',
  fetchingPrice: false,
})

// ── RR helpers ────────────────────────────────────────────────────────────────

function calcRR(buy: number | null, tp: number | null, sl: number | null): number | null {
  if (!buy || !tp || !sl || buy <= sl) return null
  const reward = tp - buy
  const risk = buy - sl
  if (risk <= 0) return null
  return reward / risk
}

function RRCell({ rr }: { rr: number | null }) {
  if (rr === null) return <span className="text-ink-disabled">—</span>
  if (rr >= 3) return (
    <span className="text-gain font-semibold flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3" /> {rr.toFixed(2)}
    </span>
  )
  if (rr >= 1) return (
    <span className="text-amber-400 font-semibold flex items-center gap-1">
      <AlertTriangle className="w-3 h-3" /> {rr.toFixed(2)}
    </span>
  )
  return (
    <span className="text-loss font-semibold flex items-center gap-1">
      <XCircle className="w-3 h-3" /> {rr.toFixed(2)}
    </span>
  )
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
          <h2 className="text-sm font-semibold text-ink-primary">Generated Plan</h2>
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

// ── Editable cell components ──────────────────────────────────────────────────

const NumInput = ({
  value,
  onChange,
  className,
}: {
  value: number | null
  onChange: (v: number | null) => void
  className?: string
}) => (
  <input
    type="number"
    step="any"
    value={value ?? ''}
    onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
    className={cn('input text-xs py-1 px-1.5 w-full text-right tabular-nums', className)}
  />
)

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PurchasePlanEditor() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [planName, setPlanName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)
  const [generateText, setGenerateText] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load plan on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    actionPlanService.get(id).then(plan => {
      if (cancelled) return
      setPlanName(plan.name)
      if (plan.purchase_items.length > 0) {
        setRows(plan.purchase_items.map(item => ({
          _key: `r${++_rowId}`,
          stock: item.stock,
          current_price: item.current_price,
          size: item.size,
          buy_price: item.buy_price,
          tp: item.tp,
          sl: item.sl,
          strategy: item.strategy && STRATEGIES.includes(item.strategy as StrategyOption) ? item.strategy : 'OTHERS',
          customStrategy: item.strategy && !STRATEGIES.includes(item.strategy as StrategyOption) ? item.strategy : '',
          fetchingPrice: false,
        })))
      } else {
        setRows([newRow()])
      }
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [id])

  // ── Row mutation helpers ───────────────────────────────────────────────────

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r))

  const deleteRow = (key: string) =>
    setRows(prev => prev.length > 1 ? prev.filter(r => r._key !== key) : prev)

  const addRow = () => setRows(prev => [...prev, newRow()])

  // ── Stock price fetch on blur ──────────────────────────────────────────────

  const fetchPrice = useCallback(async (key: string, symbol: string) => {
    if (!symbol.trim()) return
    updateRow(key, { fetchingPrice: true })
    const price = await actionPlanService.getStockPrice(symbol.trim())
    updateRow(key, { current_price: price, fetchingPrice: false })
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      await actionPlanService.update(id, {
        name: planName,
        purchase_items: rows.map((r, i) => ({
          sort_order: i,
          stock: r.stock.toUpperCase(),
          current_price: r.current_price,
          size: r.size,
          buy_price: r.buy_price,
          tp: r.tp,
          sl: r.sl,
          strategy: r.strategy === 'OTHERS' ? (r.customStrategy || 'OTHERS') : r.strategy,
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
    const lines = ['STOCK,SIZE,BUY,TP,SL, STRATEGY']
    rows.forEach(r => {
      if (!r.stock) return
      const strat = r.strategy === 'OTHERS' ? (r.customStrategy || 'OTHERS') : r.strategy
      lines.push(`${r.stock.toUpperCase()},${r.size ?? ''},${r.buy_price ?? ''},${r.tp ?? ''},${r.sl ?? ''},${strat}`)
    })
    setGenerateText(lines.join('\n'))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading plan…
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
          <p className="text-[11px] text-ink-muted mt-0.5">Purchase Action Plan</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <FileDown className="w-3.5 h-3.5" />
            Generate
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

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-border/50 bg-surface-elevated/40">
                {['STOCK', 'CURRENT PRICE', 'SIZE', 'BUY', 'TP', 'SL', 'RR', 'STRATEGY', ''].map(h => (
                  <th key={h} className="px-2.5 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap first:pl-4 last:pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const rr = calcRR(row.buy_price, row.tp, row.sl)
                return (
                  <tr key={row._key} className="border-b border-border/25 hover:bg-surface-elevated/30 transition-colors">
                    {/* STOCK */}
                    <td className="px-2.5 py-1.5 pl-4 w-[90px]">
                      <input
                        value={row.stock}
                        onChange={e => updateRow(row._key, { stock: e.target.value })}
                        onBlur={e => fetchPrice(row._key, e.target.value)}
                        className="input text-xs py-1 px-1.5 w-full uppercase font-semibold"
                        placeholder="BH"
                      />
                    </td>
                    {/* CURRENT PRICE */}
                    <td className="px-2.5 py-1.5 w-[110px]">
                      <div className="flex items-center gap-1">
                        {row.fetchingPrice
                          ? <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
                          : null
                        }
                        <span className={cn('tabular-nums', row.current_price ? 'text-ink-primary' : 'text-ink-disabled')}>
                          {row.current_price != null ? row.current_price.toFixed(2) : '—'}
                        </span>
                      </div>
                    </td>
                    {/* SIZE */}
                    <td className="px-2.5 py-1.5 w-[90px]">
                      <NumInput
                        value={row.size}
                        onChange={v => updateRow(row._key, { size: v != null ? Math.round(v) : null })}
                      />
                    </td>
                    {/* BUY */}
                    <td className="px-2.5 py-1.5 w-[90px]">
                      <NumInput value={row.buy_price} onChange={v => updateRow(row._key, { buy_price: v })} />
                    </td>
                    {/* TP */}
                    <td className="px-2.5 py-1.5 w-[90px]">
                      <NumInput value={row.tp} onChange={v => updateRow(row._key, { tp: v })} />
                    </td>
                    {/* SL */}
                    <td className="px-2.5 py-1.5 w-[90px]">
                      <NumInput value={row.sl} onChange={v => updateRow(row._key, { sl: v })} />
                    </td>
                    {/* RR */}
                    <td className="px-2.5 py-1.5 w-[80px] whitespace-nowrap">
                      <RRCell rr={rr} />
                    </td>
                    {/* STRATEGY */}
                    <td className="px-2.5 py-1.5 min-w-[180px]">
                      <div className="flex items-center gap-1">
                        <select
                          value={row.strategy}
                          onChange={e => updateRow(row._key, { strategy: e.target.value })}
                          className="input text-xs py-1 px-1.5 flex-1"
                        >
                          {STRATEGIES.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        {row.strategy === 'OTHERS' && (
                          <input
                            value={row.customStrategy}
                            onChange={e => updateRow(row._key, { customStrategy: e.target.value })}
                            className="input text-xs py-1 px-1.5 flex-1"
                            placeholder="Custom strategy…"
                          />
                        )}
                      </div>
                    </td>
                    {/* Delete */}
                    <td className="px-2.5 py-1.5 pr-4 w-[40px]">
                      <button
                        onClick={() => deleteRow(row._key)}
                        className="btn-icon text-ink-disabled hover:text-loss"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Add row footer */}
        <div className="px-4 py-2.5 border-t border-border/30">
          <button
            onClick={addRow}
            className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add row
          </button>
        </div>
      </div>

      {/* Legend */}
      <p className="text-[11px] text-ink-muted">
        <span className="text-gain font-medium">RR ≥ 3</span> is good.{' '}
        <span className="text-amber-400 font-medium">RR 1–2.9</span> = caution.{' '}
        <span className="text-loss font-medium">RR &lt; 1</span> = not worthwhile.
        RR = (TP − BUY) / (BUY − SL)
      </p>

      {/* Generate modal */}
      {generateText && (
        <GenerateModal text={generateText} onClose={() => setGenerateText(null)} />
      )}
    </div>
  )
}
