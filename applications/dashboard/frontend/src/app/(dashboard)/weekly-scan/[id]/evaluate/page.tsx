'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, X, Loader2, TrendingUp, TrendingDown,
  ChevronRight, Zap, BarChart2, FileText, Target, MoreHorizontal, Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  weeklyScanService, COLOR_MARKS, SCAN_STRATEGIES,
  colorMarkMeta, type WeeklyScan, type WeeklyScanItem, type ColorMark,
} from '@/services/weeklyScan'
import { analyticsService, type AssetType } from '@/services/analytics'
import { EChartsChart, type ChartInterval } from '@/components/analytics/EChartsChart'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ── Strategy icons ────────────────────────────────────────────────────────────

const STRATEGY_META: { value: string; label: string; Icon: React.ElementType; short: string }[] = [
  { value: 'BREAK OUT',          label: 'Break Out',       Icon: Zap,           short: 'BO'  },
  { value: 'BUY ON DIP',         label: 'Buy on Dip',      Icon: TrendingDown,  short: 'DIP' },
  { value: 'แท่งเทียนกลับตัว',      label: 'Candle Rev.',     Icon: BarChart2,     short: 'CAN' },
  { value: 'NEWS',                label: 'News',            Icon: FileText,      short: 'NEWS'},
  { value: 'AJ PAO',             label: 'AJ PAO',          Icon: Target,        short: 'AJP' },
  { value: 'OTHERS',             label: 'Others',          Icon: MoreHorizontal,short: '...' },
]

// ── Queue builder ─────────────────────────────────────────────────────────────

function buildQueue(scan: WeeklyScan, mode: string): WeeklyScanItem[] {
  const items = [...scan.items].sort((a, b) => a.symbol.localeCompare(b.symbol))
  if (mode === 'remaining') return items.filter(i => !i.color_mark)
  if (mode.startsWith('color_')) {
    const color = mode.slice(6) as ColorMark
    return items.filter(i => i.color_mark === color)
  }
  return items
}

// ── Top info bar ──────────────────────────────────────────────────────────────

function TopInfoBar({ symbol }: { symbol: string }) {
  const [info, setInfo] = useState<{ price?: number; change_pct?: number; name?: string } | null>(null)
  useEffect(() => {
    setInfo(null)
    analyticsService.search(symbol, 'SET').then(r => {
      if (r.found) setInfo({ price: r.price, change_pct: r.change_pct, name: r.name })
    }).catch(() => {})
  }, [symbol])

  return (
    <div className="flex items-center gap-3 text-xs min-w-0">
      {info ? (
        <>
          {info.name && <span className="text-ink-muted truncate max-w-[180px] hidden lg:block">{info.name}</span>}
          {info.price != null && <span className="font-mono font-bold text-ink-primary">{info.price.toFixed(2)}</span>}
          {info.change_pct != null && (
            <span className={cn('flex items-center gap-0.5 font-semibold shrink-0', info.change_pct >= 0 ? 'text-gain' : 'text-loss')}>
              {info.change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {info.change_pct >= 0 ? '+' : ''}{info.change_pct.toFixed(2)}%
            </span>
          )}
        </>
      ) : (
        <span className="text-ink-disabled flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />…</span>
      )}
    </div>
  )
}

// ── Analysis block ────────────────────────────────────────────────────────────

function AnalysisBlock({ symbol }: { symbol: string }) {
  const [log,  setLog]  = useState<{ found: boolean; content: string | null; file_type: 'html' | 'md' | null } | null>(null)
  const [fibo, setFibo] = useState<{ found: boolean; image: string | null } | null>(null)
  const [interval, setInterval] = useState<ChartInterval>('1d')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setLog(null); setFibo(null)
    Promise.all([
      analyticsService.getAnalysisLog(symbol).then(setLog),
      analyticsService.getFiboChart(symbol).then(setFibo),
    ])
  }, [symbol])

  useEffect(() => {
    if (log?.file_type === 'html' && log.content && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (!doc) return
      doc.open()
      doc.write(`<html><head><meta charset="UTF-8"><style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#0d1117;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.6;padding:12px}
        h1,h2,h3,h4{color:#f1f5f9;margin:10px 0 5px}h1{font-size:1.1em;border-bottom:1px solid #2d3748;padding-bottom:5px}
        h2{font-size:1em;color:#93c5fd}h3{font-size:.9em;color:#7dd3fc}
        table{width:100%;border-collapse:collapse;margin:6px 0}
        th{background:#1e293b;color:#94a3b8;font-size:11px;text-transform:uppercase;padding:5px 7px;border:1px solid #2d3748;text-align:left}
        td{padding:4px 7px;border:1px solid #1e293b;color:#cbd5e1;font-size:11px}tr:hover td{background:#1e293b}
        p{margin:5px 0}img{max-width:100%;border-radius:4px;border:1px solid #2d3748}
        pre,code{background:#161b22;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-family:monospace;font-size:11px}
      </style></head><body>${log.content}</body></html>`)
      doc.close()
    }
  }, [log])

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <EChartsChart symbol={symbol} assetType={'SET' as AssetType} interval={interval} onIntervalChange={setInterval} height={400} />
      </div>
      {log?.found && (
        <div className="card p-3">
          <p className="text-[10px] text-ink-muted font-semibold uppercase tracking-wider mb-2">Analysis Log</p>
          {log.file_type === 'md'
            ? <div className="prose prose-invert prose-sm max-w-none text-ink-secondary overflow-auto max-h-[280px] p-1
                prose-headings:text-ink-primary prose-h1:text-sm prose-h2:text-xs
                prose-code:bg-surface-elevated prose-code:text-brand-300 prose-code:rounded prose-code:px-1
                prose-a:text-brand-400 prose-strong:text-ink-primary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{log.content!}</ReactMarkdown>
              </div>
            : <iframe ref={iframeRef} className="w-full rounded border border-border/20"
                style={{ height: 280, background: '#0d1117' }} sandbox="allow-same-origin" title="Log" />}
        </div>
      )}
      {fibo?.found && (
        <div className="card p-3">
          <p className="text-[10px] text-ink-muted font-semibold uppercase tracking-wider mb-2">Fibonacci Chart</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fibo.image!} alt="Fibo" className="w-full rounded" />
        </div>
      )}
    </div>
  )
}

// ── Eval form ─────────────────────────────────────────────────────────────────

interface EvalForm {
  color_mark: ColorMark | ''
  strategy: string
  buy_price: string
  size: string
  tp: string
  sl: string
  remark: string
}

function emptyForm(item: WeeklyScanItem): EvalForm {
  return {
    color_mark: item.color_mark ?? '',
    strategy:   item.strategy  ?? '',
    buy_price:  item.buy_price?.toString() ?? '',
    size:       item.size?.toString()      ?? '',
    tp:         item.tp?.toString()        ?? '',
    sl:         item.sl?.toString()        ?? '',
    remark:     item.remark               ?? '',
  }
}

interface EvalFormProps {
  form: EvalForm
  onChange: (f: EvalForm) => void
  onSaveClose: () => Promise<void>
  onNext: () => void
  onPrev: () => void
  saving: boolean
  hasPrev: boolean
  hasNext: boolean
  savedFlash: boolean
}

function EvaluationForm({ form, onChange, onSaveClose, onNext, onPrev, saving, hasPrev, hasNext, savedFlash }: EvalFormProps) {
  const set = (key: keyof EvalForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...form, [key]: e.target.value })

  const canSkip = form.color_mark === 'RED' || form.color_mark === 'YELLOW'

  return (
    <div className="flex flex-col overflow-y-auto p-3 space-y-3 h-full">

      {/* Color mark */}
      <div>
        <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Color Mark</label>
        <div className="flex flex-col gap-1">
          {COLOR_MARKS.map(c => (
            <button key={c.value}
              onClick={() => onChange({ ...form, color_mark: form.color_mark === c.value ? '' : c.value as ColorMark })}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all text-left',
                c.bg, c.border, c.text,
                form.color_mark === c.value
                  ? 'ring-2 ring-offset-1 ring-offset-surface-card ring-current opacity-100'
                  : 'opacity-40 hover:opacity-70',
              )}>
              <span className={cn('w-2 h-2 rounded-full shrink-0', c.dot)} />
              <span className="flex-1 leading-none">{c.label}</span>
              {form.color_mark === c.value && <span className="text-[9px] opacity-70">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Strategy — pill buttons with icons */}
      <div>
        <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Strategy</label>
        <div className="flex flex-wrap gap-1">
          {STRATEGY_META.map(({ value, short, Icon }) => (
            <button key={value}
              title={value}
              onClick={() => onChange({ ...form, strategy: form.strategy === value ? '' : value })}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-all',
                form.strategy === value
                  ? 'bg-brand-500/20 text-brand-400 border-brand-500/40'
                  : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
              )}>
              <Icon className="w-3 h-3 shrink-0" />
              {short}
            </button>
          ))}
        </div>
        {form.strategy && (
          <p className="text-[10px] text-brand-400 mt-1">{form.strategy}</p>
        )}
      </div>

      {/* Numeric fields */}
      <div className="grid grid-cols-2 gap-2">
        {([['Buy', 'buy_price'], ['Size', 'size'], ['TP', 'tp'], ['SL', 'sl']] as [string, keyof EvalForm][]).map(([label, key]) => (
          <div key={key}>
            <label className="block text-[10px] text-ink-muted mb-1">{label}</label>
            <input type="number" step="any" value={form[key]} onChange={set(key)}
              className="input w-full text-xs py-1" placeholder="—" />
          </div>
        ))}
      </div>

      {/* Remark */}
      <div className="flex-1 flex flex-col">
        <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Remark</label>
        <textarea value={form.remark} onChange={set('remark')} rows={2}
          className="input w-full text-xs py-1 flex-1" placeholder="Optional…" style={{ resize: 'vertical' }} />
      </div>

      {/* Actions */}
      <div className="space-y-1.5 pt-1 shrink-0">
        {/* Prev / Next — auto-save */}
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={onPrev} disabled={!hasPrev || saving}
            className="flex items-center justify-center gap-1 py-1.5 text-xs font-semibold rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-30">
            <ArrowLeft className="w-3 h-3" /> Prev
          </button>
          <button onClick={onNext} disabled={!hasNext || saving}
            className="flex items-center justify-center gap-1 py-1.5 text-xs font-semibold rounded-lg border border-border text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-30">
            Next <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Skip shortcut for red/yellow */}
        {canSkip && (
          <button onClick={onNext} disabled={!hasNext}
            className="w-full py-1.5 text-[10px] font-semibold rounded-lg border border-border/50 text-ink-disabled hover:text-ink-muted hover:bg-surface-elevated transition-colors disabled:opacity-30">
            Skip to next →
          </button>
        )}

        {/* Save & Close */}
        <button onClick={onSaveClose} disabled={saving}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
            savedFlash
              ? 'bg-gain/20 text-gain border border-gain/30'
              : 'btn-primary',
          )}>
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Save className="w-3.5 h-3.5" />}
          {savedFlash ? 'Saved!' : 'Save & Close'}
        </button>
      </div>
    </div>
  )
}

// ── Symbol sidebar ────────────────────────────────────────────────────────────

function SymbolSidebar({
  queue, currentIdx, savedItems, currentForm, onSelect,
}: {
  queue: WeeklyScanItem[]
  currentIdx: number
  savedItems: Record<string, string | null>   // symbol → color_mark
  currentForm: EvalForm
  onSelect: (idx: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Auto-scroll current item into view
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-idx="${currentIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIdx])

  return (
    <div ref={ref} className="overflow-y-auto h-full">
      {queue.map((item, idx) => {
        const colorMark = idx === currentIdx
          ? (currentForm.color_mark || null) as ColorMark | null
          : ((savedItems[item.symbol] !== undefined ? savedItems[item.symbol] : item.color_mark) as ColorMark | null)
        const meta = colorMark ? colorMarkMeta(colorMark) : null
        const isCurrent = idx === currentIdx

        return (
          <button key={item.id} data-idx={idx} onClick={() => onSelect(idx)}
            className={cn(
              'w-full flex items-center gap-1.5 px-2.5 py-2 text-xs transition-colors border-b border-border/20',
              isCurrent ? 'bg-brand-500/15' : 'hover:bg-surface-elevated',
            )}>
            <span className="w-5 text-ink-disabled text-[10px] shrink-0 text-right">{idx + 1}</span>
            {/* Color dot */}
            {meta
              ? <span className={cn('w-2 h-2 rounded-full shrink-0', meta.dot)} />
              : <span className="w-2 h-2 rounded-full shrink-0 border border-border/60" />}
            <span className={cn('font-mono text-left flex-1 truncate', isCurrent ? 'text-brand-400 font-bold' : 'text-ink-secondary')}>
              {item.symbol}
            </span>
            {isCurrent && <ChevronRight className="w-3 h-3 text-brand-400 shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

// ── Main wizard page ──────────────────────────────────────────────────────────

export default function EvaluatePage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const mode = searchParams.get('mode') ?? 'all'

  const [scan,        setScan]        = useState<WeeklyScan | null>(null)
  const [loadingInit, setLoadingInit] = useState(true)
  const [queue,       setQueue]       = useState<WeeklyScanItem[]>([])
  const [idx,         setIdx]         = useState(0)
  const [form,        setForm]        = useState<EvalForm>({ color_mark: '', strategy: '', buy_price: '', size: '', tp: '', sl: '', remark: '' })
  const [saving,      setSaving]      = useState(false)
  const [savedFlash,  setSavedFlash]  = useState(false)
  // Track color marks of saved items so sidebar updates live
  const [savedColors, setSavedColors] = useState<Record<string, string | null>>({})

  useEffect(() => {
    weeklyScanService.getScan(id).then(s => {
      setScan(s)
      const q = buildQueue(s, mode)
      setQueue(q)
      if (q.length > 0) setForm(emptyForm(q[0]))
      setLoadingInit(false)
    }).catch(() => setLoadingInit(false))
  }, [id, mode])

  const currentItem = queue[idx] ?? null

  // When idx changes, load saved state or original
  useEffect(() => {
    if (!currentItem) return
    const cachedColor = savedColors[currentItem.symbol]
    // Re-fetch latest item data to show current saved values
    weeklyScanService.getScan(id).then(s => {
      const fresh = s.items.find(i => i.symbol === currentItem.symbol)
      if (fresh) setForm(emptyForm(fresh))
    }).catch(() => setForm(emptyForm(currentItem)))
  }, [idx]) // eslint-disable-line

  const doSave = useCallback(async () => {
    if (!currentItem) return
    setSaving(true)
    try {
      const payload = {
        color_mark: (form.color_mark || null) as ColorMark | null,
        strategy:   form.strategy   || null,
        buy_price:  form.buy_price  ? parseFloat(form.buy_price)  : null,
        size:       form.size       ? parseInt(form.size)          : null,
        tp:         form.tp         ? parseFloat(form.tp)          : null,
        sl:         form.sl         ? parseFloat(form.sl)          : null,
        remark:     form.remark     || null,
      }
      await weeklyScanService.upsertItem(id, currentItem.symbol, payload)
      setSavedColors(prev => ({ ...prev, [currentItem.symbol]: payload.color_mark }))
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1200)
    } catch { } finally { setSaving(false) }
  }, [id, currentItem, form])

  const goNext = async () => {
    await doSave()
    if (idx < queue.length - 1) setIdx(i => i + 1)
  }

  const goPrev = async () => {
    await doSave()
    if (idx > 0) setIdx(i => i - 1)
  }

  const handleSaveClose = async () => {
    await doSave()
    router.push(`/weekly-scan/${id}`)
  }

  if (loadingInit) return (
    <div className="flex items-center justify-center h-screen gap-2 text-ink-muted">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading…
    </div>
  )

  if (!scan || queue.length === 0) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 text-ink-muted">
      <p className="text-sm">No symbols to evaluate for this mode.</p>
      <button onClick={() => router.push(`/weekly-scan/${id}`)} className="btn-primary text-sm px-4 py-2">
        Back to scan
      </button>
    </div>
  )

  const currentMark = currentItem?.color_mark ? colorMarkMeta(currentItem.color_mark) : null

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 bg-surface-card border-b border-border/50 px-4 py-2 flex items-center gap-3">
        <button onClick={handleSaveClose} className="btn-icon shrink-0" title="Save & close">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="font-bold font-mono text-ink-primary text-sm">{currentItem?.symbol}</span>
          {form.color_mark && (() => {
            const m = colorMarkMeta(form.color_mark as ColorMark)!
            return <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border hidden sm:inline-flex', m.bg, m.text, m.border)}>{m.label}</span>
          })()}
          <span className="text-[10px] text-ink-disabled shrink-0">{idx + 1}/{queue.length}</span>
        </div>
        {currentItem && <TopInfoBar symbol={currentItem.symbol} />}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-ink-muted font-mono hidden md:block">{scan.name}</span>
          <button onClick={goPrev} disabled={idx === 0 || saving} className="btn-icon disabled:opacity-30">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={goNext} disabled={idx === queue.length - 1 || saving} className="btn-icon disabled:opacity-30">
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left 80% — chart + logs */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {currentItem && <AnalysisBlock key={currentItem.symbol} symbol={currentItem.symbol} />}
        </div>

        {/* Right 20% — symbol list + form */}
        <div className="w-[22%] min-w-[220px] max-w-[280px] border-l border-border/50 flex flex-col overflow-hidden">
          {/* Symbol list */}
          <div className="h-[38%] border-b border-border/50 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-muted uppercase tracking-wider border-b border-border/30 shrink-0">
              {queue.length} symbols
            </div>
            <SymbolSidebar
              queue={queue}
              currentIdx={idx}
              savedItems={savedColors}
              currentForm={form}
              onSelect={async (i) => { await doSave(); setIdx(i) }}
            />
          </div>

          {/* Eval form */}
          <div className="flex-1 overflow-hidden">
            <EvaluationForm
              form={form}
              onChange={setForm}
              onSaveClose={handleSaveClose}
              onNext={goNext}
              onPrev={goPrev}
              saving={saving}
              hasPrev={idx > 0}
              hasNext={idx < queue.length - 1}
              savedFlash={savedFlash}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
