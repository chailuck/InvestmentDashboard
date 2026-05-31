'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Save, FileDown, Copy, CheckCircle2,
  Loader2, AlertTriangle, XCircle, X, BarChart2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { actionPlanService } from '@/services/actionPlan'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'

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
  strategy: string
  customStrategy: string
  fetchingPrice: boolean
  reason: string
  triggered: boolean
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
  reason: '',
  triggered: false,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcRR(buy: number | null, tp: number | null, sl: number | null): number | null {
  if (!buy || !tp || !sl || buy <= sl) return null
  const risk = buy - sl
  if (risk <= 0) return null
  return (tp - buy) / risk
}

function calcPnl(price: number | null, buy: number | null, size: number | null): number | null {
  if (price == null || buy == null || size == null) return null
  return (price - buy) * size
}

function calcPct(price: number | null, buy: number | null): number | null {
  if (price == null || buy == null || buy === 0) return null
  return ((price - buy) / buy) * 100
}

function fmtPnl(v: number | null) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  if (Math.abs(v) >= 1_000_000) return `${sign}${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${sign}${(v / 1_000).toFixed(1)}K`
  return `${sign}${v.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(v: number | null) {
  if (v == null) return ''
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
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

function PnlCell({ pnl, pct, positive }: { pnl: number | null; pct: number | null; positive?: boolean }) {
  const isNull = pnl == null
  const up = positive !== undefined ? positive : (pnl != null && pnl >= 0)
  return (
    <td className="px-2 py-1.5 whitespace-nowrap text-right">
      <div className={cn('text-[11px] font-medium tabular-nums', isNull ? 'text-ink-disabled' : up ? 'text-gain' : 'text-loss')}>
        {fmtPnl(pnl)}
      </div>
      <div className={cn('text-[10px] tabular-nums', isNull ? 'text-ink-disabled' : up ? 'text-gain/70' : 'text-loss/70')}>
        {fmtPct(pct)}
      </div>
    </td>
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

// ── Note panel ────────────────────────────────────────────────────────────────

function NotePanel({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="card p-4 space-y-2">
      <label className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="input w-full text-xs py-2 px-2.5 resize-y leading-relaxed font-mono"
      />
    </div>
  )
}

// ── Input components ──────────────────────────────────────────────────────────

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
  const [setAnalysis, setSetAnalysis] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)
  const [generateText, setGenerateText] = useState<string | null>(null)
  const [analyticsSymbol, setAnalyticsSymbol] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load plan on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    actionPlanService.get(id).then(plan => {
      if (cancelled) return
      setPlanName(plan.name)
      setSetAnalysis(plan.set_analysis ?? '')
      setNotes(plan.notes ?? '')
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
          reason: item.reason ?? '',
          triggered: item.triggered ?? false,
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
        set_analysis: setAnalysis || null,
        notes: notes || null,
        purchase_items: rows.map((r, i) => ({
          sort_order: i,
          stock: r.stock.toUpperCase(),
          current_price: r.current_price,
          size: r.size,
          buy_price: r.buy_price,
          tp: r.tp,
          sl: r.sl,
          strategy: r.strategy === 'OTHERS' ? (r.customStrategy || 'OTHERS') : r.strategy,
          reason: r.reason || null,
          triggered: r.triggered,
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
    const lines = ['STOCK,SIZE,BUY,TP,SL,STRATEGY']
    rows.forEach(r => {
      if (!r.stock) return
      const strat = r.strategy === 'OTHERS' ? r.customStrategy : r.strategy
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
          <table className="w-full text-xs" style={{ minWidth: '1300px' }}>
            <thead>
              <tr className="border-b border-border/50 bg-surface-elevated/40">
                <th className="px-2.5 py-2.5 pl-4 text-left font-semibold text-ink-muted whitespace-nowrap">STOCK</th>
                <th className="px-2.5 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">CURRENT</th>
                <th className="px-2.5 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">SIZE</th>
                <th className="px-2.5 py-2.5 text-right font-semibold text-ink-muted whitespace-nowrap">BUY</th>
                <th className="px-2.5 py-2.5 text-center font-semibold text-brand-400 whitespace-nowrap border-l border-border/30">
                  TP <span className="text-[9px] font-normal text-brand-500/60">editable</span>
                </th>
                <th className="px-2 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                  TP P&L
                  <div className="text-[9px] font-normal text-ink-disabled">Amt / %</div>
                </th>
                <th className="px-2.5 py-2.5 text-center font-semibold text-brand-400 whitespace-nowrap border-l border-border/30">
                  SL <span className="text-[9px] font-normal text-brand-500/60">editable</span>
                </th>
                <th className="px-2 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                  SL P&L
                  <div className="text-[9px] font-normal text-ink-disabled">Amt / %</div>
                </th>
                <th className="px-2.5 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">RR</th>
                <th className="px-2.5 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">STRATEGY</th>
                <th className="px-2.5 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">REASON</th>
                <th className="px-2.5 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                  TRIGGERED
                </th>
                <th className="px-2.5 py-2.5 pr-4 w-[36px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const rr     = calcRR(row.buy_price, row.tp, row.sl)
                const tpPnl  = calcPnl(row.tp, row.buy_price, row.size)
                const tpPct  = calcPct(row.tp, row.buy_price)
                const slPnl  = calcPnl(row.sl, row.buy_price, row.size)
                const slPct  = calcPct(row.sl, row.buy_price)
                return (
                  <tr
                    key={row._key}
                    className={cn(
                      'border-b border-border/25 transition-colors',
                      row.triggered
                        ? 'bg-gain/5 hover:bg-gain/8'
                        : 'hover:bg-surface-elevated/30',
                    )}
                  >
                    {/* STOCK */}
                    <td className="px-2.5 py-1.5 pl-4 w-[110px]">
                      <div className="flex items-center gap-1">
                        <input
                          value={row.stock}
                          onChange={e => updateRow(row._key, { stock: e.target.value })}
                          onBlur={e => fetchPrice(row._key, e.target.value)}
                          className="input text-xs py-1 px-1.5 flex-1 min-w-0 uppercase font-semibold"
                          placeholder="BH"
                        />
                        {row.stock && (
                          <button
                            type="button"
                            onClick={() => setAnalyticsSymbol(row.stock.toUpperCase())}
                            className="btn-icon shrink-0 text-brand-400/60 hover:text-brand-400"
                            title={`Analytics: ${row.stock}`}
                          >
                            <BarChart2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    {/* CURRENT PRICE */}
                    <td className="px-2.5 py-1.5 w-[80px] text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1">
                        {row.fetchingPrice && <Loader2 className="w-3 h-3 animate-spin text-brand-400" />}
                        <span className={row.current_price ? 'text-ink-primary' : 'text-ink-disabled'}>
                          {row.current_price != null ? row.current_price.toFixed(2) : '—'}
                        </span>
                      </div>
                    </td>
                    {/* SIZE */}
                    <td className="px-2.5 py-1.5 w-[80px]">
                      <NumInput value={row.size} onChange={v => updateRow(row._key, { size: v != null ? Math.round(v) : null })} />
                    </td>
                    {/* BUY */}
                    <td className="px-2.5 py-1.5 w-[80px]">
                      <NumInput value={row.buy_price} onChange={v => updateRow(row._key, { buy_price: v })} />
                    </td>
                    {/* TP */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 w-[80px]">
                      <NumInput value={row.tp} onChange={v => updateRow(row._key, { tp: v })} />
                    </td>
                    {/* TP P&L */}
                    <PnlCell pnl={tpPnl} pct={tpPct} positive={tpPnl != null && tpPnl >= 0} />
                    {/* SL */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 w-[80px]">
                      <NumInput value={row.sl} onChange={v => updateRow(row._key, { sl: v })} />
                    </td>
                    {/* SL P&L */}
                    <PnlCell pnl={slPnl} pct={slPct} positive={false} />
                    {/* RR */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 w-[70px] whitespace-nowrap">
                      <RRCell rr={rr} />
                    </td>
                    {/* STRATEGY */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 min-w-[160px]">
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
                            placeholder="Custom…"
                          />
                        )}
                      </div>
                    </td>
                    {/* REASON */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 min-w-[150px]">
                      <input
                        value={row.reason}
                        onChange={e => updateRow(row._key, { reason: e.target.value })}
                        className="input text-xs py-1 px-1.5 w-full"
                        placeholder="Reason…"
                      />
                    </td>
                    {/* TRIGGERED */}
                    <td className="border-l border-border/30 px-2.5 py-1.5 text-center w-[90px]">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={row.triggered}
                          onChange={e => updateRow(row._key, { triggered: e.target.checked })}
                          className="w-4 h-4 rounded accent-brand-500 cursor-pointer"
                        />
                        <span className={cn('text-[11px] font-medium', row.triggered ? 'text-gain' : 'text-ink-disabled')}>
                          {row.triggered ? 'Yes' : 'No'}
                        </span>
                      </label>
                    </td>
                    {/* Delete */}
                    <td className="px-2.5 py-1.5 pr-4 w-[36px]">
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
        RR = (TP − BUY) / (BUY − SL). Triggered rows are highlighted in green.
      </p>

      {/* Notes panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NotePanel
          label="SET Analysis"
          value={setAnalysis}
          onChange={setSetAnalysis}
          placeholder="Market / SET index analysis for this plan…"
        />
        <NotePanel
          label="Note"
          value={notes}
          onChange={setNotes}
          placeholder="Additional notes, reminders, or observations…"
        />
      </div>

      {/* Generate modal */}
      {generateText && (
        <GenerateModal text={generateText} onClose={() => setGenerateText(null)} />
      )}

      {/* Analytics modal */}
      <AnimatePresence>
        {analyticsSymbol && (
          <AnalyticsModal
            symbol={analyticsSymbol}
            assetType="SET"
            onClose={() => setAnalyticsSymbol(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
