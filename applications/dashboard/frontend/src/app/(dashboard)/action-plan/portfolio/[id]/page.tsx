'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, FileDown, Copy, CheckCircle2,
  Loader2, X, RefreshCw, AlertCircle, Download, Upload, ClipboardCopy, Database,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { actionPlanService } from '@/services/actionPlan'
import { portfolioTrackerService } from '@/services/portfolioTracker'
import { portfolioDbService } from '@/services/portfolioDb'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'

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

function calcRR(
  tp: number | null,
  entryPrice: number | null,
  sl: number | null,
): number | null {
  if (tp == null || entryPrice == null || sl == null) return null
  const denominator = entryPrice - sl
  if (denominator === 0) return null
  return (tp - entryPrice) / denominator
}

function fmtRR(v: number | null): string {
  if (v == null) return '—'
  return `${v.toFixed(1)}R`
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

// ── Note panel ────────────────────────────────────────────────────────────────

function NotePanel({
  label, value, onChange, placeholder, rows = 6, resizable = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  resizable?: boolean
}) {
  return (
    <div className="bg-surface-card border border-border/60 rounded-xl shadow-card p-4 space-y-2" style={{ overflow: 'visible' }}>
      <label className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full bg-surface-elevated border border-border rounded-lg px-2.5 py-2 text-xs text-ink-primary placeholder:text-ink-muted font-mono leading-relaxed focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30 transition-colors"
        style={{ resize: resizable ? 'vertical' : 'none', minHeight: resizable ? '160px' : undefined }}
      />
    </div>
  )
}

// ── Editable number cell ──────────────────────────────────────────────────────

const AUTO_SAVE_DEBOUNCE_MS = 300

const NumInput = ({
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  onBlur?: () => void
  placeholder?: string
}) => (
  <input
    type="number"
    step="any"
    value={value ?? ''}
    onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
    onBlur={onBlur}
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
  const [aiRecommend, setAiRecommend] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)
  const [copyingPrev, setCopyingPrev] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [syncingDb, setSyncingDb] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [generateText, setGenerateText] = useState<string | null>(null)
  const [analyticsSymbol, setAnalyticsSymbol] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const importRef = useRef<HTMLInputElement>(null)

  // ── Load plan + positions ─────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [plan, posData] = await Promise.all([
        actionPlanService.get(id),
        portfolioTrackerService.getPositions({ status: 'active' }),
      ])
      setPlanName(plan.name)
      setAiRecommend(plan.ai_recommend ?? '')
      setNotes(plan.notes ?? '')

      if (plan.portfolio_items.length === 0) {
        // New plan — seed from current active positions
        setRows((posData.positions ?? []).map((pos: any) => ({
          symbol: (pos.symbol ?? '').toUpperCase(),
          current_price: pos.currentPrice ?? null,
          size: pos.positionSize ?? null,
          entry_price: pos.entryPrice ?? null,
          tp: null,
          sl: null,
          order_size: null,
        })))
      } else {
        // Existing plan — keep saved stock list; only refresh current_price from live data
        const priceMap = new Map(
          (posData.positions ?? []).map((p: any) => [(p.symbol ?? '').toUpperCase(), p.currentPrice ?? null])
        )
        setRows(plan.portfolio_items.map(i => ({
          symbol: i.symbol.toUpperCase(),
          current_price: priceMap.get(i.symbol.toUpperCase()) ?? i.current_price ?? null,
          size: i.size ?? null,
          entry_price: i.entry_price ?? null,
          tp: i.tp ?? null,
          sl: i.sl ?? null,
          order_size: i.order_size ?? null,
        })))
      }
    } catch (e) {
      console.error('Failed to load portfolio plan', e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    return () => {
      clearTimeout(autoSaveTimer.current)
    }
  }, [])

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

  // ── Copy Order Size / TP / SL from previous portfolio plan ───────────────

  const copyFromPreviousPlan = async () => {
    setCopyingPrev(true)
    setCopyMsg(null)
    try {
      const plans = await actionPlanService.list('portfolio', null)
      // plans are sorted newest-first; find the first plan that is not the current one
      const prevPlan = plans.find(p => p.id !== id)
      if (!prevPlan) {
        setCopyMsg('No previous plan found.')
        return
      }

      const prevDetail = await actionPlanService.get(prevPlan.id)

      // Build lookup: symbol → { order_size, tp, sl }
      const prevMap = new Map(
        prevDetail.portfolio_items.map(item => [
          item.symbol.toUpperCase(),
          { order_size: item.order_size, tp: item.tp, sl: item.sl },
        ])
      )

      let copied = 0
      setRows(prev =>
        prev.map(row => {
          // Only copy into rows that have ALL three fields unset (not yet configured)
          if (row.order_size !== null || row.tp !== null || row.sl !== null) {
            return row
          }
          const match = prevMap.get(row.symbol.toUpperCase())
          if (!match) return row
          // Only apply if the previous plan actually had something to copy
          if (match.order_size === null && match.tp === null && match.sl === null) return row
          copied++
          return {
            ...row,
            order_size: match.order_size,
            tp: match.tp,
            sl: match.sl,
          }
        })
      )

      if (copied === 0) {
        setCopyMsg('Nothing to copy — all rows already have values, or no matching symbols.')
      } else {
        setCopyMsg(`Copied values for ${copied} row${copied === 1 ? '' : 's'} from "${prevPlan.name}". Press Save to persist.`)
      }
    } catch {
      setCopyMsg('Failed to load previous plan.')
    } finally {
      setCopyingPrev(false)
      setTimeout(() => setCopyMsg(null), 6000)
    }
  }

  // ── Sync / upsert from DB portfolio ──────────────────────────────────────

  const syncFromDb = async () => {
    setSyncingDb(true)
    setSyncMsg(null)
    try {
      const dbPositions = await portfolioDbService.getPositions('active')
      if (!dbPositions.length) {
        setSyncMsg('No active positions found in the DB portfolio.')
        return
      }

      const dbMap = new Map(dbPositions.map(p => [p.symbol.toUpperCase(), p]))

      // Compute diff against current rows (read directly — avoids stale-counter bug with setRows callback)
      const existingSymbols = new Set(rows.map(r => r.symbol.toUpperCase()))

      const merged: Row[] = rows.map(row => {
        const pos = dbMap.get(row.symbol.toUpperCase())
        if (!pos) return row
        return {
          ...row,
          current_price: pos.currentPrice ?? row.current_price,
          size:          pos.positionSize ?? row.size,
          entry_price:   pos.entryPrice   ?? row.entry_price,
          tp:            pos.tp           ?? row.tp,
          sl:            pos.sl           ?? row.sl,
          order_size:    pos.positionSize ?? row.order_size,
        }
      })

      const newRows: Row[] = dbPositions
        .filter(pos => !existingSymbols.has((pos.symbol ?? '').toUpperCase()))
        .map(pos => ({
          symbol:        (pos.symbol ?? '').toUpperCase(),
          current_price: pos.currentPrice ?? null,
          size:          pos.positionSize ?? null,
          entry_price:   pos.entryPrice   ?? null,
          tp:            pos.tp           ?? null,
          sl:            pos.sl           ?? null,
          order_size:    pos.positionSize ?? null,
        }))

      setRows([...merged, ...newRows])

      const updated = rows.filter(r => dbMap.has(r.symbol.toUpperCase())).length
      const added   = newRows.length
      const parts: string[] = []
      if (updated) parts.push(`${updated} updated`)
      if (added)   parts.push(`${added} added`)
      setSyncMsg(parts.length
        ? `Synced from DB: ${parts.join(', ')}. Press Save to persist.`
        : 'No matching DB positions found.')
    } catch (e: any) {
      setSyncMsg(e?.response?.data?.detail ?? 'Failed to sync from DB portfolio.')
    } finally {
      setSyncingDb(false)
      setTimeout(() => setSyncMsg(null), 8000)
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
        ai_recommend: aiRecommend || null,
        notes: notes || null,
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

  // ── Auto-save on blur ─────────────────────────────────────────────────────

  const handleBlur = useCallback(() => {
    if (saving) return
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      save()
    }, AUTO_SAVE_DEBOUNCE_MS)
  }, [saving, save])

  // ── Export / Restore ──────────────────────────────────────────────────────

  const exportList = () => {
    const text = rows.filter(r => r.symbol.trim()).map(r => r.symbol.trim().toUpperCase()).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${planName.replace(/\s+/g, '_') || 'portfolio_plan'}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const restoreList = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const symbols = (ev.target?.result as string ?? '')
        .split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)
      if (symbols.length === 0) return
      if (!confirm(`Replace all ${rows.length} item(s) with ${symbols.length} symbols from file?`)) return
      setRows(symbols.map(s => ({ symbol: s, current_price: null, size: null, entry_price: null, tp: null, sl: null, order_size: null })))
    }
    reader.readAsText(file)
    e.target.value = ''
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
        <button onClick={() => router.push('/action-plan?tab=plans')} className="btn-icon">
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
            onClick={copyFromPreviousPlan}
            disabled={copyingPrev || saving}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
            title="Copy Order Size, TP, and SL from the previous portfolio plan for unconfigured rows"
          >
            {copyingPrev
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ClipboardCopy className="w-3.5 h-3.5" />
            }
            Copy Prev Plan
          </button>

          <button
            onClick={syncFromDb}
            disabled={syncingDb || saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#818cf8', borderColor: '#818cf855', background: 'rgba(129,140,248,0.07)' }}
            title="Upsert rows from active DB portfolio positions — updates existing, adds new, preserves TP/SL/Order Size"
          >
            {syncingDb
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Database className="w-3.5 h-3.5" />
            }
            Sync from DB
          </button>

          <input ref={importRef} type="file" accept=".txt" className="hidden" onChange={restoreList} />
          <button onClick={exportList}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={() => importRef.current?.click()}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Restore
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

      {/* Copy-from-previous-plan feedback */}
      {copyMsg && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs border',
          copyMsg.startsWith('Failed') || copyMsg.startsWith('No previous')
            ? 'bg-loss/8 border-loss/20 text-loss'
            : copyMsg.startsWith('Nothing')
            ? 'bg-surface-elevated border-border/40 text-ink-muted'
            : 'bg-gain/8 border-gain/20 text-gain',
        )}>
          {copyMsg.startsWith('Failed') || copyMsg.startsWith('No previous')
            ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            : copyMsg.startsWith('Nothing')
            ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          {copyMsg}
        </div>
      )}

      {/* Sync from DB feedback */}
      {syncMsg && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs border',
          syncMsg.startsWith('Failed') || syncMsg.startsWith('No active')
            ? 'bg-loss/8 border-loss/20 text-loss'
            : 'bg-gain/8 border-gain/20 text-gain',
        )}>
          {syncMsg.startsWith('Failed') || syncMsg.startsWith('No active')
            ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          {syncMsg}
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
            <table className="w-full text-xs" style={{ minWidth: '1170px' }}>
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
                  {/* RR — read-only */}
                  <th className="px-3 py-2.5 text-center font-semibold text-ink-muted whitespace-nowrap border-l border-border/30">
                    RR
                    <div className="text-[9px] font-normal text-ink-disabled">TP/SL ratio</div>
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
                  const rr = calcRR(row.tp, row.entry_price, row.sl)

                  return (
                    <tr key={idx} className="border-b border-border/25 hover:bg-surface-elevated/30 transition-colors">
                      {/* SYMBOL */}
                      <td className="px-3 py-2 pl-4">
                        <button
                          type="button"
                          onClick={() => setAnalyticsSymbol(row.symbol)}
                          className="font-semibold text-ink-primary hover:text-brand-400 transition-colors"
                          title={`Analytics: ${row.symbol}`}
                        >
                          {row.symbol}
                        </button>
                      </td>
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
                          onBlur={handleBlur}
                          placeholder="Qty"
                        />
                      </td>

                      {/* TP — editable (border-l) */}
                      <td className="border-l border-border/30 px-2 py-2 w-[90px]">
                        <NumInput
                          value={row.tp}
                          onChange={v => updateRow(idx, { tp: v })}
                          onBlur={handleBlur}
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
                          onBlur={handleBlur}
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

                      {/* RR — read-only (border-l) */}
                      <td className="border-l border-border/30 px-3 py-2 text-center whitespace-nowrap">
                        <span className={cn(
                          'text-xs font-medium tabular-nums',
                          rr == null   ? 'text-ink-disabled'
                          : rr >= 2.0  ? 'text-gain'
                          : rr >= 1.0  ? 'text-warning'
                          :               'text-ink-disabled',
                        )}>
                          {fmtRR(rr)}
                        </span>
                      </td>

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

      {/* Notes panels — vertical, Note first */}
      <div className="space-y-4">
        <NotePanel
          label="Note"
          value={notes}
          onChange={setNotes}
          placeholder="Additional notes, reminders, or observations…"
          rows={4}
        />
        <NotePanel
          label="AI Recommend"
          value={aiRecommend}
          onChange={setAiRecommend}
          placeholder="AI / analyst recommendations for this portfolio plan…"
          rows={10}
          resizable
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
