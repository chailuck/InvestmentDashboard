'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { X, Loader2, Save, CheckCircle2, ChevronDown, ChevronUp, Image as ImageIcon, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { analyticsService, type AssetType } from '@/services/analytics'
import { EChartsChart, type ChartInterval } from './EChartsChart'

// ── Section collapser ─────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border/40 hover:bg-surface-elevated/40 transition-colors"
      >
        <Icon className="w-4 h-4 text-brand-400 shrink-0" />
        <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wider flex-1 text-left">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-ink-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Pan / zoom image viewer ───────────────────────────────────────────────────

function PanZoomImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const clampScale = (s: number) => Math.min(Math.max(s, 0.25), 10)

  const applyTransform = useCallback((s: number, ox: number, oy: number) => {
    if (imgRef.current) {
      imgRef.current.style.transform =
        `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) scale(${s})`
    }
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale(prev => {
      const next = clampScale(prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
      setOffset(o => { applyTransform(next, o.x, o.y); return o })
      return next
    })
  }, [applyTransform])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    last.current = { x: e.clientX, y: e.clientY }
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    setOffset(prev => {
      const next = { x: prev.x + e.clientX - last.current.x, y: prev.y + e.clientY - last.current.y }
      last.current = { x: e.clientX, y: e.clientY }
      setScale(s => { applyTransform(s, next.x, next.y); return s })
      return next
    })
  }, [applyTransform])

  const stopDrag = useCallback(() => {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }, [])

  const lastPinchDist = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) last.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDist.current = Math.hypot(dx, dy)
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1) {
      setOffset(prev => {
        const next = { x: prev.x + e.touches[0].clientX - last.current.x, y: prev.y + e.touches[0].clientY - last.current.y }
        last.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        setScale(s => { applyTransform(s, next.x, next.y); return s })
        return next
      })
    }
    if (e.touches.length === 2 && lastPinchDist.current != null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      setScale(prev => {
        const next = clampScale(prev * dist / lastPinchDist.current!)
        setOffset(o => { applyTransform(next, o.x, o.y); return o })
        lastPinchDist.current = dist
        return next
      })
    }
  }

  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); applyTransform(1, 0, 0) }
  useEffect(() => { applyTransform(1, 0, 0) }, []) // eslint-disable-line

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <span className="text-[10px] text-ink-disabled mr-1">{Math.round(scale * 100)}% · scroll to zoom · drag to pan</span>
        <button onClick={() => { const s = clampScale(scale * 1.3); setScale(s); applyTransform(s, offset.x, offset.y) }}
          className="btn-ghost text-xs px-2.5 py-1">+ Zoom in</button>
        <button onClick={() => { const s = clampScale(scale / 1.3); setScale(s); applyTransform(s, offset.x, offset.y) }}
          className="btn-ghost text-xs px-2.5 py-1">− Zoom out</button>
        <button onClick={reset} className="btn-ghost text-xs px-2.5 py-1">Reset</button>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-border/30 bg-surface-elevated"
        style={{ height: 500, touchAction: 'none', cursor: 'grab' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => { lastPinchDist.current = null }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            maxWidth: 'none', width: '100%', userSelect: 'none',
            transform: 'translate(-50%, -50%) scale(1)',
            transformOrigin: 'center center',
          }}
        />
      </div>
    </div>
  )
}

// ── Analysis log — markdown renderer ─────────────────────────────────────────

function AnalysisLogMd({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-ink-secondary leading-relaxed
      prose-headings:text-ink-primary prose-h1:text-base prose-h2:text-sm prose-h3:text-xs
      prose-table:text-xs prose-th:bg-surface-elevated prose-th:text-ink-muted
      prose-td:border-border/40 prose-th:border-border/40
      prose-code:bg-surface-elevated prose-code:text-brand-300 prose-code:rounded prose-code:px-1
      prose-a:text-brand-400 prose-strong:text-ink-primary overflow-auto max-h-[520px] p-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

// ── Analysis log renderer — themed iframe ─────────────────────────────────────

function AnalysisLogView({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    const themed = `
      <html><head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.6; padding: 16px; }
        h1,h2,h3,h4 { color: #f1f5f9; margin: 12px 0 6px; }
        h1 { font-size: 1.2em; border-bottom: 1px solid #2d3748; padding-bottom: 6px; }
        h2 { font-size: 1.05em; color: #93c5fd; }
        h3 { font-size: 0.95em; color: #7dd3fc; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th { background: #1e293b; color: #94a3b8; font-size: 11px; text-transform: uppercase; padding: 6px 8px; border: 1px solid #2d3748; text-align: left; }
        td { padding: 5px 8px; border: 1px solid #1e293b; color: #cbd5e1; font-size: 12px; }
        tr:hover td { background: #1e293b; }
        .positive, .up, .gain { color: #22c55e !important; }
        .negative, .down, .loss { color: #ef4444 !important; }
        a { color: #60a5fa; text-decoration: none; }
        p { margin: 6px 0; }
        img { max-width: 100%; border-radius: 4px; border: 1px solid #2d3748; }
        pre, code { background: #161b22; border: 1px solid #2d3748; border-radius: 4px; padding: 2px 6px; font-family: monospace; font-size: 11px; }
        [style*="background: white"], [style*="background: #fff"], [style*="background-color: white"], [style*="background-color: #fff"] { background: #161b22 !important; color: #e2e8f0 !important; }
        [style*="color: black"], [style*="color: #000"] { color: #e2e8f0 !important; }
      </style>
      </head><body>${html}</body></html>
    `
    doc.open()
    doc.write(themed)
    doc.close()
  }, [html])

  return (
    <iframe
      ref={iframeRef}
      className="w-full rounded-lg border border-border/30"
      style={{ height: 480, background: '#0d1117' }}
      sandbox="allow-same-origin"
      title="Analysis log"
    />
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  symbol: string
  assetType: AssetType
  onClose: () => void
}

export function AnalyticsModal({ symbol, assetType, onClose }: Props) {
  const [interval, setInterval] = useState<ChartInterval>('1d')

  const [analysisLog, setAnalysisLog] = useState<{
    found: boolean; content: string | null; filename: string | null; file_type: 'html' | 'md' | null
  } | null>(null)
  const [fiboChart, setFiboChart] = useState<{
    found: boolean; image: string | null; filename: string | null
  } | null>(null)

  const [note, setNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load side data on mount
  useEffect(() => {
    Promise.all([
      analyticsService.getAnalysisLog(symbol).then(setAnalysisLog),
      analyticsService.getFiboChart(symbol).then(setFiboChart),
      analyticsService.getNote(symbol).then(r => setNote(r.note)),
    ])
  }, [symbol])

  const saveNote = async () => {
    setNoteSaving(true)
    try {
      await analyticsService.saveNote(symbol, assetType, note)
      setNoteSaved(true)
      clearTimeout(noteSaveTimer.current)
      noteSaveTimer.current = setTimeout(() => setNoteSaved(false), 2500)
    } finally {
      setNoteSaving(false)
    }
  }

  const assetBadgeColor = assetType === 'SET'
    ? 'text-brand-400 border-brand-500/30 bg-brand-500/10'
    : assetType === 'CRYPTO'
      ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      : 'text-purple-400 border-purple-500/30 bg-purple-500/10'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ duration: 0.2 }}
        className="w-[80vw] my-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="card px-5 py-3 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-ink-primary">{symbol.toUpperCase()}</span>
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', assetBadgeColor)}>
                  {assetType}
                </span>
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Candlestick · RSI · Stochastic · VRVP
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        {/* Chart */}
        <div className="card p-4">
          <EChartsChart
            symbol={symbol}
            assetType={assetType}
            interval={interval}
            onIntervalChange={setInterval}
            height={560}
          />
        </div>

        {/* Analysis log — open by default for HTML, collapsed for MD */}
        {analysisLog?.found && (
          <Section title="Analysis Log" icon={FileText} defaultOpen={analysisLog.file_type === 'html'}>
            <div className="p-4">
              <p className="text-[10px] text-ink-muted mb-3">{analysisLog.filename}</p>
              {analysisLog.file_type === 'md'
                ? <AnalysisLogMd content={analysisLog.content!} />
                : <AnalysisLogView html={analysisLog.content!} />
              }
            </div>
          </Section>
        )}

        {/* Fibo chart */}
        {fiboChart?.found && (
          <Section title="Fibonacci Chart" icon={ImageIcon}>
            <div className="p-4">
              <p className="text-[10px] text-ink-muted mb-2">{fiboChart.filename}</p>
              <PanZoomImage src={fiboChart.image!} alt="Fibo chart" />
            </div>
          </Section>
        )}

        {/* Symbol notes */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">Note</label>
            <button
              onClick={saveNote}
              disabled={noteSaving}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                noteSaved
                  ? 'bg-gain/15 text-gain border-gain/30'
                  : 'bg-surface-elevated border-border text-ink-muted hover:text-ink-primary',
              )}
            >
              {noteSaving ? <Loader2 className="w-3 h-3 animate-spin" />
                : noteSaved ? <CheckCircle2 className="w-3 h-3" />
                : <Save className="w-3 h-3" />}
              {noteSaved ? 'Saved' : 'Save note'}
            </button>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={`Notes for ${symbol.toUpperCase()}…`}
            rows={5}
            className="input w-full text-xs py-2 px-2.5 leading-relaxed font-mono"
            style={{ resize: 'vertical' }}
          />
        </div>
      </motion.div>
    </div>
  )
}
