'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { analyticsService, type AssetType, type ChartData } from '@/services/analytics'

// ── Constants ─────────────────────────────────────────────────────────────────

export const CHART_INTERVALS = [
  { label: '1H',  value: '1h'  },
  { label: '4H',  value: '4h'  },
  { label: '1D',  value: '1d'  },
  { label: '1W',  value: '1wk' },
] as const

export const CHART_RANGES = [
  { label: '6M',   value: '6mo',  days: 182 },
  { label: '1Y',   value: '1y',   days: 365 },
  { label: '2Y',   value: '2y',   days: 730 },
  { label: '2.5Y', value: '2.5y', days: 912 },
] as const

export type ChartInterval = (typeof CHART_INTERVALS)[number]['value']
export type ChartRange    = (typeof CHART_RANGES)[number]['value']

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns dataZoom start% so the last `days` of data are visible. */
function zoomStartForRange(dates: string[], days: number): number {
  if (!dates.length || days >= 912) return 0
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  // find first bar on or after cutoff
  const idx = dates.findIndex(d => d.slice(0, 10) >= cutoffStr)
  if (idx <= 0) return 0
  return (idx / dates.length) * 100
}

// ── Chart option builder ──────────────────────────────────────────────────────

function buildOption(data: ChartData, logScale: boolean, zoomStart: number) {
  const dates = data.candles.map(c => c.time)
  const ohlc  = data.candles.map(c => [c.open, c.close, c.low, c.high])
  const vols  = data.volume.map(v => ({ value: v.value, itemStyle: { color: v.color } }))
  const rsiVals = data.rsi.map(r => r.value ?? null)
  const stochK  = data.stoch_k.map(s => s.value ?? null)
  const stochD  = data.stoch_d.map(s => s.value ?? null)

  const maxVrvp  = Math.max(...data.vrvp.map(v => v.volume), 1)
  const vrvpData = data.vrvp.map(v => [v.volume / maxVrvp, v.price_high, v.price_low])

  return {
    backgroundColor: '#0d1117',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#374151' } },
      backgroundColor: '#1e293b',
      borderColor: '#2d3748',
      borderWidth: 1,
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      formatter: (params: any[]) => {
        if (!params?.length) return ''
        const lines: string[] = [
          `<div style="font-weight:600;margin-bottom:4px;color:#94a3b8">${params[0].axisValue}</div>`,
        ]
        for (const p of params) {
          if (p.seriesName === 'Price' && Array.isArray(p.data)) {
            const [o, c, l, h] = p.data as number[]
            const col = c >= o ? '#22c55e' : '#ef4444'
            lines.push(`<div style="color:${col}">O&nbsp;${o?.toFixed(2)}&nbsp;&nbsp;H&nbsp;${h?.toFixed(2)}&nbsp;&nbsp;L&nbsp;${l?.toFixed(2)}&nbsp;&nbsp;C&nbsp;${c?.toFixed(2)}</div>`)
          } else if (p.seriesName === 'Volume') {
            lines.push(`<div style="color:#64748b">Vol&nbsp;${Number(p.data?.value ?? p.data).toLocaleString()}</div>`)
          } else if (p.seriesName === 'RSI') {
            lines.push(`<div style="color:#a78bfa">RSI&nbsp;${Number(p.data).toFixed(1)}</div>`)
          } else if (p.seriesName === 'Stoch K') {
            lines.push(`<div style="color:#60a5fa">%K&nbsp;${Number(p.data).toFixed(1)}</div>`)
          } else if (p.seriesName === 'Stoch D') {
            lines.push(`<div style="color:#fb923c">%D&nbsp;${Number(p.data).toFixed(1)}</div>`)
          }
        }
        return lines.join('')
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: [
      // Horizontal inside (mouse-wheel / touch)
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: zoomStart, end: 100 },
      // Horizontal scroll bar at bottom
      {
        type: 'slider',
        xAxisIndex: [0, 1, 2, 3],
        bottom: 2, height: 20,
        start: zoomStart, end: 100,
        handleStyle: { color: '#6366f1' },
        fillerColor: 'rgba(99,102,241,0.12)',
        borderColor: '#2d3748',
        textStyle: { color: '#6b7280', fontSize: 9 },
        labelFormatter: (_: number, val: string) => val?.slice(2) ?? '',
      },
      // Vertical price-axis slider (right side of main chart)
      {
        type: 'slider',
        orient: 'vertical',
        yAxisIndex: 0,
        right: 6, top: 10, bottom: '44%', width: 16,
        handleStyle: { color: '#6366f1' },
        fillerColor: 'rgba(99,102,241,0.12)',
        borderColor: '#2d3748',
        showDetail: false,
      },
    ],
    grid: [
      { left: 60, right: 42, top: 10, bottom: '43%' },
      { left: 60, right: 42, top: '60%', height: '11%' },
      { left: 60, right: 42, top: '74%', height: '9%' },
      { left: 60, right: 42, top: '85%', height: '9%' },
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#2d3748' } }, splitLine: { lineStyle: { color: '#1a2332', type: 'dashed' } } },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#2d3748' } }, splitLine: { show: false } },
      { type: 'category', data: dates, gridIndex: 2, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#2d3748' } }, splitLine: { show: false } },
      { type: 'category', data: dates, gridIndex: 3, axisLabel: { fontSize: 9, color: '#4b5563', interval: 'auto' }, axisLine: { lineStyle: { color: '#2d3748' } }, splitLine: { show: false } },
    ],
    yAxis: [
      {
        type: logScale ? 'log' : 'value',
        ...(logScale ? { logBase: 10 } : { scale: true }),
        gridIndex: 0,
        splitLine: { lineStyle: { color: '#1a2332', type: 'dashed' } },
        axisLabel: {
          color: '#6b7280', fontSize: 10,
          formatter: (v: number) => v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(2) : v.toFixed(3),
        },
        position: 'left',
      },
      { gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      {
        gridIndex: 2, min: 0, max: 100, interval: 50,
        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
        axisLabel: { color: '#6b7280', fontSize: 9 }, position: 'left',
        name: 'RSI', nameTextStyle: { color: '#6b7280', fontSize: 9 }, nameLocation: 'start', nameGap: 4,
      },
      {
        gridIndex: 3, min: 0, max: 100, interval: 50,
        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
        axisLabel: { color: '#6b7280', fontSize: 9 }, position: 'left',
        name: 'Stoch', nameTextStyle: { color: '#6b7280', fontSize: 9 }, nameLocation: 'start', nameGap: 4,
      },
    ],
    series: [
      {
        name: 'Price', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0,
        data: ohlc,
        itemStyle: { color: '#22c55e', color0: '#ef4444', borderColor: '#22c55e', borderColor0: '#ef4444' },
      },
      // VRVP — custom horizontal bars from right edge, growing left
      {
        name: 'VRVP', type: 'custom', xAxisIndex: 0, yAxisIndex: 0,
        data: vrvpData, silent: true, z: 2,
        renderItem: (_params: any, api: any) => {
          const volNorm   = api.value(0)
          const priceHigh = api.value(1)
          const priceLow  = api.value(2)
          // Use last (most recent) date so coord() maps into the visible y-scale
          const lastDate  = dates[dates.length - 1]
          const [, yH] = api.coord([lastDate, priceHigh])
          const [, yL] = api.coord([lastDate, priceLow])
          const { x: cx, y: cy, width: cw, height: ch } = _params.coordSys
          // Clip bar to visible grid area
          const top    = Math.max(Math.min(yH, yL), cy)
          const bottom = Math.min(Math.max(yH, yL), cy + ch)
          if (top >= bottom) return { type: 'rect', shape: { x: 0, y: 0, width: 0, height: 0 } }
          const barW = Math.max(volNorm * cw * 0.18, 1)
          return {
            type: 'rect',
            shape: { x: cx + cw - barW, y: top, width: barW, height: bottom - top },
            style: { fill: 'rgba(99,102,241,0.32)', stroke: 'rgba(99,102,241,0.55)', lineWidth: 0.5 },
          }
        },
      },
      {
        name: 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: vols, barMaxWidth: 6, emphasis: { disabled: true },
      },
      {
        name: 'RSI', type: 'line', xAxisIndex: 2, yAxisIndex: 2,
        data: rsiVals, lineStyle: { color: '#a78bfa', width: 1.5 }, symbol: 'none', connectNulls: false,
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 70 }, { yAxis: 30 }], lineStyle: { color: '#374151', type: 'dashed', width: 1 }, label: { show: false } },
      },
      {
        name: 'Stoch K', type: 'line', xAxisIndex: 3, yAxisIndex: 3,
        data: stochK, lineStyle: { color: '#60a5fa', width: 1.5 }, symbol: 'none', connectNulls: false,
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 80 }, { yAxis: 20 }], lineStyle: { color: '#374151', type: 'dashed', width: 1 }, label: { show: false } },
      },
      {
        name: 'Stoch D', type: 'line', xAxisIndex: 3, yAxisIndex: 3,
        data: stochD, lineStyle: { color: '#fb923c', width: 1.5 }, symbol: 'none', connectNulls: false,
      },
    ],
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  symbol: string
  assetType: AssetType
  interval?: ChartInterval
  onIntervalChange?: (v: ChartInterval) => void
  height?: number
}

export function EChartsChart({ symbol, assetType, interval = '1d', onIntervalChange, height = 560 }: Props) {
  const [data,     setData]     = useState<ChartData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [logScale, setLogScale] = useState(false)
  const [range,    setRange]    = useState<ChartRange>('1y')
  const echartsRef = useRef<any>(null)

  // Fetch full 2.5Y history on symbol/interval change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    analyticsService.getChartData(symbol, assetType, interval)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Failed to load chart data'); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol, assetType, interval])

  // When range changes (and data is already loaded), dispatch zoom only — no re-fetch
  useEffect(() => {
    if (!data || !echartsRef.current) return
    const chart = echartsRef.current.getEchartsInstance?.()
    if (!chart) return
    const start = zoomStartForRange(data.candles.map(c => c.time), CHART_RANGES.find(r => r.value === range)!.days)
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end: 100 })
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start, end: 100 })
  }, [range, data])

  const zoomStart = useMemo(() => {
    if (!data) return 60
    return zoomStartForRange(data.candles.map(c => c.time), CHART_RANGES.find(r => r.value === range)!.days)
  }, [data, range])

  const option = useMemo(
    () => data ? buildOption(data, logScale, zoomStart) : {},
    [data, logScale, zoomStart],
  )

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Interval */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-disabled mr-1">Interval:</span>
            {CHART_INTERVALS.map(({ label, value }) => (
              <button key={value} onClick={() => onIntervalChange?.(value)}
                className={cn('px-2.5 py-1 text-xs font-semibold rounded border transition-colors',
                  interval === value
                    ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                    : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-border/50" />

          {/* Range (zoom only) */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-disabled mr-1">Range:</span>
            {CHART_RANGES.map(({ label, value }) => (
              <button key={value} onClick={() => setRange(value)}
                className={cn('px-2.5 py-1 text-xs font-semibold rounded border transition-colors',
                  range === value
                    ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                    : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scale toggle */}
        <button onClick={() => setLogScale(v => !v)}
          className={cn('px-2.5 py-1 text-xs font-semibold rounded border transition-colors',
            logScale
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated')}
          title="Toggle log/linear price scale">
          {logScale ? 'Log' : 'Linear'}
        </button>
      </div>

      {/* Chart area */}
      <div className="relative rounded-lg overflow-hidden border border-border/30 bg-[#0d1117]" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-ink-muted text-sm z-10">
            <Loader2 className="w-5 h-5 animate-spin" />Loading chart…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-loss text-sm z-10">{error}</div>
        )}
        {data && (
          <ReactECharts
            ref={echartsRef}
            option={option}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>

      <p className="text-[10px] text-ink-disabled text-right">
        <span className="font-mono text-brand-400/70">{data?.exchange ?? assetType}:{symbol.toUpperCase()}</span>
        {data && <span className="ml-2">{data.candles.length} bars (unadjusted) · VRVP {data.vrvp.length} lvl</span>}
        <span className="ml-2 opacity-40">drag ▕ to adjust price scale</span>
      </p>
    </div>
  )
}
