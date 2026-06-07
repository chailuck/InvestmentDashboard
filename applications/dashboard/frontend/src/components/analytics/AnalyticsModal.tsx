'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { X, Loader2, Save, CheckCircle2, ChevronDown, ChevronUp, Image as ImageIcon, FileText, LineChart as LineChartIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { analyticsService, type AssetType, type PeRatioData } from '@/services/analytics'
import { appConfigService } from '@/services/appConfig'
import { INDICATOR_CONFIG } from '@/config/indicators'
import { EChartsChart, type ChartInterval } from './EChartsChart'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

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
  const [height, setHeight] = useState(480)

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
        body { background: #0d1117; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.6; padding: 16px; overflow: hidden; }
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

    // Expand iframe to full content height — no scrollbar
    const measure = () => {
      const body = iframe.contentDocument?.body
      if (body) setHeight(body.scrollHeight + 32)
    }
    requestAnimationFrame(() => requestAnimationFrame(measure))
  }, [html])

  return (
    <div className="max-h-[72vh] overflow-y-auto rounded-lg border border-border/30"
         style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
      <iframe
        ref={iframeRef}
        className="w-full"
        style={{ height, background: '#0d1117', display: 'block' }}
        sandbox="allow-same-origin"
        title="Analysis log"
      />
    </div>
  )
}

// ── PE ratio line chart (stacked dual-panel, shared time axis) ───────────────

const COMBINED_CHART_H = 600

function makeCombinedOption(
  priceData: { date: string; price: number }[],
  peData: { date: string; pe: number }[],
  avg_pe: number | null,
  earningsDates: string[] = [],
  timeline: TimelinePoint[] = [],
) {
  const dates        = priceData.map(d => d.date)
  const priceValues  = priceData.map(d => d.price)
  const tickInterval = Math.max(1, Math.floor(dates.length / 7))

  const peMap    = new Map(peData.map(d => [d.date, d.pe]))
  const peValues = dates.map(d => peMap.get(d) ?? null)

  const firstPrice     = priceValues[0] ?? 1
  const lastPrice      = priceValues[priceValues.length - 1] ?? firstPrice
  const priceLineColor = lastPrice >= firstPrice ? '#10B981' : '#EF4444'
  const priceAreaColor = lastPrice >= firstPrice ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)'

  const validPe      = peValues.filter((v): v is number => v != null)
  const avg          = avg_pe ?? (validPe.length ? validPe.reduce((a, b) => a + b, 0) / validPe.length : 15)
  const lastPe       = validPe[validPe.length - 1] ?? avg
  const expensive    = lastPe > avg * 1.05
  const cheap        = lastPe < avg * 0.95
  const peLineColor  = expensive ? '#EF4444' : cheap ? '#10B981' : '#60A5FA'
  const peAreaColor  = expensive ? 'rgba(239,68,68,0.07)' : cheap ? 'rgba(16,185,129,0.07)' : 'rgba(96,165,250,0.07)'

  // Shared x-axis base (strips use boundaryGap true for bar, charts use false for line)
  const stripAxisBase = {
    type: 'category' as const, data: dates,
    axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
    axisLabel: { show: false }, boundaryGap: true,
  }
  const lineAxisBase = {
    type: 'category' as const, data: dates,
    axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
    boundaryGap: false,
  }

  // Build a timeline map keyed by date for fast tooltip lookup
  const tlMap = new Map(timeline.map(pt => [pt.date, pt]))

  return {
    backgroundColor: 'transparent',
    // 5 grids (top→bottom): Overall | Price chart | Price slope | PE chart | PE slope
    // All grids share the same left so strips and chart plot areas start at the same x position.
    grid: [
      { left: 68, right: 8, top: '1%',  height: '5%'  }, // 0: Overall state
      { left: 68, right: 8, top: '8%',  height: '35%' }, // 1: Price chart
      { left: 68, right: 8, top: '44%', height: '3%'  }, // 2: Price slope
      { left: 68, right: 8, top: '49%', height: '35%' }, // 3: PE chart
      { left: 68, right: 8, top: '85%', height: '3%'  }, // 4: PE slope
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1C2333', borderColor: '#2A3450', borderWidth: 1,
      textStyle: { color: '#E2E8F0', fontSize: 11 },
      formatter: (params: any[]) => {
        const date = params[0]?.name ?? params[0]?.axisValueLabel ?? ''
        const idx  = params[0]?.dataIndex ?? 0
        const pt   = tlMap.get(date) ?? tlMap.get(dates[idx])
        let html = `<div style="color:#94A3B8;font-size:10px;margin-bottom:4px">${date}</div>`
        if (pt) {
          const stateLevel = PE_INDICATOR_LEVELS.find(l => l.key === pt.state)
          html += `<div style="margin-bottom:3px"><span style="color:#94A3B8">State </span><span style="color:${INDICATOR_DOT[pt.state]};font-weight:700">${stateLevel?.label ?? pt.state}</span></div>`
          const peVal  = pt.peChg != null ? `${pt.peChg >= 0 ? '+' : ''}${pt.peChg.toFixed(1)}%` : 'n/a'
          const prcVal = `${pt.priceChg >= 0 ? '+' : ''}${pt.priceChg.toFixed(1)}%`
          html += `<div><span style="color:#94A3B8">PE slope </span><span style="color:${DIR_COLOR[pt.peDir]}">${DIR_ARROW[pt.peDir]} ${peVal}</span></div>`
          html += `<div><span style="color:#94A3B8">Price slope </span><span style="color:${DIR_COLOR[pt.priceDir]}">${DIR_ARROW[pt.priceDir]} ${prcVal}</span></div>`
        }
        for (const p of params) {
          // series 2 = Price line, series 4 = PE line
          if (p.value == null || (p.seriesIndex !== 2 && p.seriesIndex !== 4)) continue
          const isPrice = p.seriesIndex === 2
          const label   = isPrice ? 'Price' : 'P/E'
          const val     = isPrice
            ? Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : `${Number(p.value).toFixed(2)}×`
          html += `<div style="color:#F1F5F9"><span style="color:#94A3B8">${label} </span>${val}</div>`
        }
        return html
      },
    },
    // Grid order: 0=Overall, 1=Price chart, 2=Price slope, 3=PE chart, 4=PE slope
    xAxis: [
      { ...stripAxisBase, gridIndex: 0 },
      { ...lineAxisBase,  gridIndex: 1, axisLabel: { show: false } },
      { ...stripAxisBase, gridIndex: 2 },
      { ...lineAxisBase,  gridIndex: 3, axisLabel: { show: false } },
      { ...stripAxisBase, gridIndex: 4, axisLabel: { show: true, color: '#475569', fontSize: 9, interval: tickInterval, formatter: (v: string) => v.slice(0, 7) } },
    ],
    yAxis: [
      // Strip y-axes: 0–1 scale, no ticks/lines, with side label
      { gridIndex: 0, type: 'value', min: 0, max: 1, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        name: 'Overall', nameLocation: 'middle' as const, nameRotate: 0, nameGap: 50, nameTextStyle: { color: '#475569', fontSize: 8 } },
      // Price chart y-axis
      {
        gridIndex: 1, type: 'value', scale: true,
        name: 'Price', nameTextStyle: { color: '#475569', fontSize: 9 }, nameGap: 4,
        axisLabel: { color: '#475569', fontSize: 9, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v) },
        splitLine: { lineStyle: { color: '#1a2235', type: 'dashed' } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      { gridIndex: 2, type: 'value', min: 0, max: 1, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        name: 'Price slope', nameLocation: 'middle' as const, nameRotate: 0, nameGap: 50, nameTextStyle: { color: '#475569', fontSize: 8 } },
      // PE chart y-axis
      {
        gridIndex: 3, type: 'value', scale: true,
        name: 'P/E', nameTextStyle: { color: '#475569', fontSize: 9 }, nameGap: 4,
        axisLabel: { color: '#475569', fontSize: 9, formatter: (v: number) => `${v}×` },
        splitLine: { lineStyle: { color: '#1a2235', type: 'dashed' } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      { gridIndex: 4, type: 'value', min: 0, max: 1, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        name: 'PE slope', nameLocation: 'middle' as const, nameRotate: 0, nameGap: 50, nameTextStyle: { color: '#475569', fontSize: 8 } },
    ],
    series: [
      // ── Strip 0: Overall state ────────────────────────────────────────────
      {
        type: 'bar', xAxisIndex: 0, yAxisIndex: 0,
        barWidth: '100%', barCategoryGap: '0%', silent: true,
        data: timeline.map(pt => ({ value: 1, itemStyle: { color: INDICATOR_DOT[pt.state] } })),
      },
      // ── Strip 2: Price slope (below price chart) ─────────────────────────
      {
        type: 'bar', xAxisIndex: 2, yAxisIndex: 2,
        barWidth: '100%', barCategoryGap: '0%', silent: true,
        label: {
          show: true, position: 'inside' as const,
          fontSize: 7, fontWeight: 'bold', color: '#1e293b', overflow: 'truncate' as const,
          formatter: (p: any) => {
            const chg: number = p.data.priceChg
            return `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`
          },
        },
        data: timeline.map(pt => ({
          value: 1, priceChg: pt.priceChg,
          itemStyle: { color: DIR_COLOR_LIGHT[pt.priceDir] },
        })),
      },
      // ── Price line chart ──────────────────────────────────────────────────
      {
        name: 'Price', type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        data: priceValues, smooth: 0.4, symbol: 'none',
        lineStyle: { color: priceLineColor, width: 2 },
        areaStyle: { color: priceAreaColor },
        ...(earningsDates.length ? {
          markLine: {
            silent: true, symbol: ['none', 'none'],
            lineStyle: { color: '#F59E0B', type: 'dashed', width: 1, opacity: 0.6 },
            label: { show: true, color: '#F59E0B', fontSize: 8, position: 'insideStartTop', formatter: 'Q' },
            data: earningsDates.map(d => ({ xAxis: d })),
          },
        } : {}),
      },
      // ── Strip 4: PE slope (below PE chart) ───────────────────────────────
      {
        type: 'bar', xAxisIndex: 4, yAxisIndex: 4,
        barWidth: '100%', barCategoryGap: '0%', silent: true,
        label: {
          show: true, position: 'inside' as const,
          fontSize: 7, fontWeight: 'bold', color: '#1e293b', overflow: 'truncate' as const,
          formatter: (p: any) => {
            const chg: number | null = p.data.peChg
            if (chg == null) return '—'
            return `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`
          },
        },
        data: timeline.map(pt => ({
          value: 1, peChg: pt.peChg,
          itemStyle: { color: DIR_COLOR_LIGHT[pt.peDir] },
        })),
      },
      // ── PE line chart ─────────────────────────────────────────────────────
      {
        name: 'P/E', type: 'line', xAxisIndex: 3, yAxisIndex: 3,
        data: peValues, smooth: 0.4, symbol: 'none', connectNulls: false,
        lineStyle: { color: peLineColor, width: 2 },
        areaStyle: { color: peAreaColor },
        markLine: {
          silent: true, symbol: ['none', 'none'],
          data: [
            {
              yAxis: avg,
              lineStyle: { color: '#60A5FA', type: 'dashed', width: 1, opacity: 0.6 },
              label: { show: true, color: '#60A5FA', fontSize: 9, position: 'end', formatter: `Avg ${avg.toFixed(1)}×` },
            },
            ...earningsDates.map(d => ({
              xAxis: d,
              lineStyle: { color: '#F59E0B', type: 'dashed' as const, width: 1, opacity: 0.5 },
              label: { show: true, color: '#F59E0B', fontSize: 7, position: 'insideStartTop' as const, formatter: 'Q' },
            })),
          ],
        },
      },
    ],
  }
}

// ── PE indicator ─────────────────────────────────────────────────────────────

type PeIndicator = 'very_good' | 'good' | 'normal' | 'bad' | 'very_bad'

const PE_INDICATOR_LEVELS: {
  key: PeIndicator
  label: string
  desc: string
  activeColor: string
  activeBg: string
  dot: string
}[] = [
  {
    key: 'very_bad',
    label: 'Very Bad',
    desc: 'PE = 0 · no earnings, or PE ↑ while price ↓',
    activeColor: 'text-loss',
    activeBg: 'bg-loss/12 border-loss/30',
    dot: '#EF4444',
  },
  {
    key: 'bad',
    label: 'Bad',
    desc: 'PE stable + price ↓ · valuation pressure without earnings change',
    activeColor: 'text-orange-400',
    activeBg: 'bg-orange-500/10 border-orange-500/25',
    dot: '#FB923C',
  },
  {
    key: 'normal',
    label: 'Normal',
    desc: 'PE ↑↑ or ↓↓ with price (aligned), or both stable',
    activeColor: 'text-ink-secondary',
    activeBg: 'bg-surface-elevated border-border/50',
    dot: '#94A3B8',
  },
  {
    key: 'good',
    label: 'Good',
    desc: 'Not used in current model',
    activeColor: 'text-brand-400',
    activeBg: 'bg-brand-500/10 border-brand-500/25',
    dot: '#60A5FA',
  },
  {
    key: 'very_good',
    label: 'Very Good',
    desc: 'PE ↑/↓/stable favourable · price not rising against it',
    activeColor: 'text-gain',
    activeBg: 'bg-gain/10 border-gain/25',
    dot: '#10B981',
  },
]

function calcPeIndicator(
  currentPe: number | null,
  rangeAvg: number | null,
  filteredPrice: { price: number }[],
): PeIndicator {
  if (!currentPe || currentPe <= 0.5) return 'very_bad'
  if (!rangeAvg || rangeAvg <= 0) return 'normal'

  const last  = filteredPrice[filteredPrice.length - 1]?.price ?? 0
  const first = filteredPrice[0]?.price ?? last
  const priceChangePct = first ? ((last - first) / first) * 100 : 0
  const peVsAvgPct     = ((currentPe - rangeAvg) / rangeAvg) * 100

  const peLow    = peVsAvgPct < -10   // PE is 10%+ below period avg
  const peHigh   = peVsAvgPct > 10    // PE is 10%+ above period avg
  const priceDown   = priceChangePct < -5   // price fell >5%
  const priceStable = priceChangePct >= -5 && priceChangePct < 10
  const priceHigh   = priceChangePct >= 10  // price rose 10%+

  if (peLow && (priceStable || priceDown)) return 'very_good'
  if (peLow && priceHigh)                  return 'good'
  if (peHigh && priceDown)                 return 'bad'
  return 'normal'
}

const INDICATOR_DOT: Record<PeIndicator, string> = {
  very_bad: '#EF4444',
  bad:      '#FB923C',
  normal:   '#475569',
  good:     '#60A5FA',
  very_good:'#10B981',
}

type PeDir    = 'up' | 'down' | 'stable' | 'zero'
type PriceDir = 'up' | 'down' | 'stable'

const INDICATOR_TABLE: Record<`${PeDir}-${PriceDir}`, PeIndicator> = {
  'up-up':       'normal',
  'up-stable':   'very_good',
  'up-down':     'very_bad',
  'down-up':     'very_good',
  'down-stable': 'very_good',
  'down-down':   'normal',
  'stable-up':   'very_good',
  'stable-stable':'normal',
  'stable-down': 'bad',
  'zero-up':     'very_bad',
  'zero-stable': 'very_bad',
  'zero-down':   'very_bad',
}


function peDirection(chg: number): PeDir {
  const t = INDICATOR_CONFIG.peThreshold
  if (chg > t)  return 'up'
  if (chg < -t) return 'down'
  return 'stable'
}

function priceDirection(chg: number): PriceDir {
  const t = INDICATOR_CONFIG.priceThreshold
  if (chg > t)  return 'up'
  if (chg < -t) return 'down'
  return 'stable'
}

interface TimelinePoint {
  date: string
  state: PeIndicator
  peDir: PeDir
  priceDir: PriceDir
  peChg: number | null   // % vs period average (for PE) or intra-week open→close (for price)
  priceChg: number
}

function computeWeeklyIndicators(
  priceData: { date: string; price: number; open?: number }[],
  peData: { date: string; pe: number; pe_open?: number }[],
  thresholds: { peThreshold: number; priceThreshold: number } = { peThreshold: INDICATOR_CONFIG.peThreshold, priceThreshold: INDICATOR_CONFIG.priceThreshold },
): TimelinePoint[] {
  if (!priceData.length) return []

  const peMap = new Map(peData.map(d => [d.date, d]))

  return priceData.map((d, i) => {
    const peEntry  = peMap.get(d.date)
    const pe       = peEntry?.pe ?? null

    // Price direction: slope from previous week's close → this week's close
    const prevPrice = i > 0 ? priceData[i - 1].price : d.price
    const priceChg  = prevPrice ? ((d.price - prevPrice) / prevPrice) * 100 : 0
    const pt        = thresholds.priceThreshold
    const priceDir: PriceDir = priceChg > pt ? 'up' : priceChg < -pt ? 'down' : 'stable'

    if (!pe || pe <= 0.5) {
      return { date: d.date, state: INDICATOR_TABLE[`zero-${priceDir}`], peDir: 'zero' as PeDir, priceDir, peChg: null, priceChg }
    }

    // PE direction: slope from previous week's PE close → this week's PE close
    const prevPeEntry = i > 0 ? peMap.get(priceData[i - 1].date) : undefined
    const prevPe      = prevPeEntry?.pe ?? pe
    const peChg       = prevPe > 0 ? ((pe - prevPe) / prevPe) * 100 : 0
    const pp          = thresholds.peThreshold
    const peDir: PeDir = peChg > pp ? 'up' : peChg < -pp ? 'down' : 'stable'

    return { date: d.date, state: INDICATOR_TABLE[`${peDir}-${priceDir}`], peDir, priceDir, peChg, priceChg }
  })
}

const DIR_COLOR: Record<PeDir | PriceDir, string> = {
  up: '#10B981', down: '#EF4444', stable: '#475569', zero: '#EF4444',
}
const DIR_COLOR_LIGHT: Record<PeDir | PriceDir, string> = {
  up: '#6EE7B7', down: '#FCA5A5', stable: '#64748B', zero: '#FCA5A5',
}
const DIR_ARROW: Record<PeDir | PriceDir, string> = {
  up: '↑', down: '↓', stable: '→', zero: '—',
}

function PeIndicatorTimeline({ timeline }: { timeline: TimelinePoint[] }) {
  const [hovered, setHovered] = useState<TimelinePoint | null>(null)
  const display = hovered ?? timeline[timeline.length - 1] ?? null

  return (
    <div className="space-y-1.5">
      {/* Header + hover date/state */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-ink-disabled uppercase tracking-wider">Indicator History</span>
        {display && (
          <span className="text-[9px] text-ink-muted tabular-nums">
            {display.date} —{' '}
            <span className="font-semibold" style={{ color: INDICATOR_DOT[display.state] }}>
              {PE_INDICATOR_LEVELS.find(l => l.key === display.state)?.label}
            </span>
            {' · '}
            <span style={{ color: DIR_COLOR[display.peDir] }}>PE {DIR_ARROW[display.peDir]}{display.peChg != null ? ` ${display.peChg >= 0 ? '+' : ''}${display.peChg.toFixed(1)}%` : ''}</span>
            {' · '}
            <span style={{ color: DIR_COLOR[display.priceDir] }}>Price {DIR_ARROW[display.priceDir]} {display.priceChg >= 0 ? '+' : ''}{display.priceChg.toFixed(1)}%</span>
          </span>
        )}
      </div>

      {/* Legend — one row with dot + label + description */}
      <div className="flex items-center gap-4 flex-wrap">
        {PE_INDICATOR_LEVELS.map(({ key, label, desc, dot }) => (
          <div key={key} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
            <span className="text-[9px] font-semibold shrink-0" style={{ color: dot }}>{label}</span>
            <span className="text-[9px] text-ink-disabled">{desc}</span>
          </div>
        ))}
      </div>

      {/* Indicator strip + per-period direction strips */}
      <div className="space-y-px">
        {/* Main state strip */}
        <div className="flex h-5 gap-px rounded-t overflow-hidden">
          {timeline.map(pt => (
            <div
              key={pt.date}
              className="flex-1 min-w-0 cursor-default"
              style={{ backgroundColor: INDICATOR_DOT[pt.state] }}
              onMouseEnter={() => setHovered(pt)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </div>

        {/* PE direction strip */}
        <div className="flex items-center gap-px">
          <span className="text-[8px] text-ink-disabled w-5 shrink-0 text-right pr-1">PE</span>
          <div className="flex h-5 gap-px flex-1 overflow-hidden">
            {timeline.map(pt => {
              const val = pt.peChg != null ? `${pt.peChg >= 0 ? '+' : ''}${pt.peChg.toFixed(1)}%` : 'n/a'
              return (
                <div
                  key={pt.date}
                  className="flex-1 min-w-0 cursor-default relative overflow-hidden"
                  style={{ backgroundColor: DIR_COLOR[pt.peDir], opacity: 0.8 }}
                  title={`${pt.date}  PE slope: ${val}`}
                  onMouseEnter={() => setHovered(pt)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white leading-none select-none whitespace-nowrap">
                    {val}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Price direction strip */}
        <div className="flex items-center gap-px">
          <span className="text-[8px] text-ink-disabled w-5 shrink-0 text-right pr-1">$</span>
          <div className="flex h-5 gap-px flex-1 rounded-b overflow-hidden">
            {timeline.map(pt => {
              const val = `${pt.priceChg >= 0 ? '+' : ''}${pt.priceChg.toFixed(1)}%`
              return (
                <div
                  key={pt.date}
                  className="flex-1 min-w-0 cursor-default relative overflow-hidden"
                  style={{ backgroundColor: DIR_COLOR[pt.priceDir], opacity: 0.8 }}
                  title={`${pt.date}  Price open→close: ${val}`}
                  onMouseEnter={() => setHovered(pt)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white leading-none select-none whitespace-nowrap">
                    {val}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

type PeRange = '2Y' | '1Y' | '6M'
const PE_RANGES: PeRange[] = ['2Y', '1Y', '6M']
const PE_RANGE_DAYS: Record<PeRange, number> = { '2Y': 730, '1Y': 365, '6M': 182 }

function filterByRange<T extends { date: string }>(items: T[], days: number): T[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return items.filter(d => d.date >= cutoffStr)
}

function PeLineChart({ peData }: { peData: PeRatioData }) {
  const { data, price_data = [], earnings_dates = [], current_pe, avg_pe, min_pe, max_pe } = peData
  const [range, setRange] = useState<PeRange>('2Y')

  const { data: globalCfg } = useQuery({ queryKey: ['app-config'], queryFn: appConfigService.get, staleTime: 60_000 })
  const thresholds = {
    peThreshold:    globalCfg?.pe_threshold    ?? INDICATOR_CONFIG.peThreshold,
    priceThreshold: globalCfg?.price_threshold ?? INDICATOR_CONFIG.priceThreshold,
  }

  const filteredPrice = useMemo(
    () => filterByRange(price_data, PE_RANGE_DAYS[range]),
    [price_data, range],
  )
  const filteredPe = useMemo(
    () => filterByRange(data, PE_RANGE_DAYS[range]),
    [data, range],
  )
  const filteredEarnings = useMemo(() => {
    if (!earnings_dates.length) return []
    const cutoff = filteredPrice[0]?.date ?? ''
    return earnings_dates.filter(d => d >= cutoff)
  }, [earnings_dates, filteredPrice])

  const rangeAvg  = useMemo(() => {
    const vals = filteredPe.map(d => d.pe)
    return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : avg_pe
  }, [filteredPe, avg_pe])
  const rangeLow  = useMemo(() => filteredPe.length ? round2(Math.min(...filteredPe.map(d => d.pe))) : min_pe, [filteredPe, min_pe])
  const rangeHigh = useMemo(() => filteredPe.length ? round2(Math.max(...filteredPe.map(d => d.pe))) : max_pe, [filteredPe, max_pe])

  const timeline = useMemo(
    () => computeWeeklyIndicators(filteredPrice, filteredPe, thresholds),
    [filteredPrice, filteredPe, thresholds],
  )

  const option = useMemo(
    () => filteredPrice.length
      ? makeCombinedOption(filteredPrice, filteredPe, rangeAvg, filteredEarnings, timeline)
      : null,
    [filteredPrice, filteredPe, rangeAvg, filteredEarnings, timeline],
  )

  const curColor = current_pe != null && rangeAvg != null
    ? current_pe > rangeAvg * 1.05 ? 'text-loss'
    : current_pe < rangeAvg * 0.95 ? 'text-gain'
    : 'text-ink-primary'
    : 'text-ink-primary'

  const stats = [
    { label: 'Current',       value: current_pe, colorClass: curColor },
    { label: `${range} Avg`,  value: rangeAvg,   colorClass: 'text-ink-primary' },
    { label: `${range} Low`,  value: rangeLow,   colorClass: 'text-ink-primary' },
    { label: `${range} High`, value: rangeHigh,  colorClass: 'text-ink-primary' },
  ]

  return (
    <div className="p-4 space-y-3">
      {/* Stats + range toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid grid-cols-4 gap-2 flex-1">
          {stats.map(({ label, value, colorClass }) => (
            <div key={label} className="bg-surface-elevated rounded-lg px-3 py-2 text-center">
              <div className="text-[9px] text-ink-disabled uppercase tracking-wider mb-0.5">{label}</div>
              <div className={cn('text-sm font-bold tabular-nums', colorClass)}>
                {value != null ? `${value.toFixed(1)}×` : '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PE_RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150',
                range === r
                  ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                  : 'text-ink-muted hover:text-ink-secondary',
              )}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      {timeline.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          {PE_INDICATOR_LEVELS.map(({ key, label, desc, dot }) => (
            <div key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
              <span className="text-[9px] font-semibold shrink-0" style={{ color: dot }}>{label}</span>
              <span className="text-[9px] text-ink-disabled">{desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Unified chart — 3 indicator strips + price + PE, all aligned on same time axis */}
      {option ? (
        <ReactECharts
          option={option}
          style={{ height: COMBINED_CHART_H, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
      ) : (
        <div className="flex items-center justify-center text-ink-disabled text-xs" style={{ height: 200 }}>
          No price data available
        </div>
      )}
    </div>
  )
}

function round2(n: number) { return Math.round(n * 100) / 100 }

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

  const [peRatio, setPeRatio]     = useState<PeRatioData | null>(null)
  const [peLoading, setPeLoading] = useState(false)

  const [note, setNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Load side data on mount
  useEffect(() => {
    setPeLoading(true)
    Promise.all([
      analyticsService.getAnalysisLog(symbol).then(setAnalysisLog),
      analyticsService.getFiboChart(symbol).then(setFiboChart),
      analyticsService.getNote(symbol).then(r => setNote(r.note)),
      analyticsService.getPeRatio(symbol, assetType).then(setPeRatio).finally(() => setPeLoading(false)),
    ])
  }, [symbol, assetType])

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

        {/* Analysis log — expanded for HTML, collapsed for MD */}
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

        {/* Fibo chart — always collapsed, hidden when not found */}
        {fiboChart?.found && (
          <Section title="Fibonacci Chart" icon={ImageIcon} defaultOpen={false}>
            <div className="p-4">
              <p className="text-[10px] text-ink-muted mb-2">{fiboChart.filename}</p>
              <PanZoomImage src={fiboChart.image!} alt="Fibo chart" />
            </div>
          </Section>
        )}

        {/* P/E Ratio chart */}
        <Section title="P/E Ratio (2 Years)" icon={LineChartIcon} defaultOpen>
          {peLoading ? (
            <div className="p-4"><div className="skeleton h-52 rounded-lg" /></div>
          ) : !peRatio?.found ? (
            <div className="flex items-center justify-center h-20 text-sm text-ink-muted">
              No P/E data available for this symbol
            </div>
          ) : (
            <PeLineChart peData={peRatio} />
          )}
        </Section>

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
