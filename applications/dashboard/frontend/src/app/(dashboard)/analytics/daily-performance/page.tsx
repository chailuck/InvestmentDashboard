'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  TrendingUp,
  RefreshCw,
  AlertCircle,
  History,
  CheckCircle2,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
} from 'lucide-react'
import {
  dailyPerformanceService,
  portfolioCashTransactionService,
  type DailyPerformanceRecord,
  type DailyPerformanceUpdateInput,
  type BackfillResult,
  type PositionChip,
  type CashTransaction,
} from '@/services/dailyPerformance'
import { apiClient } from '@/services/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function subDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function formatAxisNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toFixed(0)
}

function formatXLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Format a position chip label.
 * New format (when buy_price and close_price are available):
 *   SYMBOL (buy/close/+P&L%)   e.g. PTT (35.0/36.5/+4.3%)
 * Fallback for old records without price data:
 *   SYMBOL (+P&L%)
 */
function formatPositionChip(pos: PositionChip): string {
  const sign = pos.pnl_pct >= 0 ? '+' : ''
  const pctStr = `${sign}${pos.pnl_pct.toFixed(1)}%`
  if (pos.buy_price != null && pos.close_price != null) {
    return `${pos.symbol} (${pos.buy_price.toFixed(1)}/${pos.close_price.toFixed(1)}/${pctStr})`
  }
  return `${pos.symbol} (${pctStr})`
}

// ─── Color constants (all inline styles — Tailwind JIT purges dynamic colors) ─

const COLORS = {
  investment: '#3b82f6',
  closedPnl: '#22c55e',
  openPnl: '#a855f7',
  positive: '#22c55e',
  negative: '#ef4444',
  chipPositiveBg: 'rgba(34,197,94,0.15)',
  chipNegativeBg: 'rgba(239,68,68,0.15)',
} as const

// ─── SVG chart constants ───────────────────────────────────────────────────────

const CHART_H = 260
const CHART_PAD = { top: 20, right: 20, bottom: 40, left: 68 } as const

// ─── SVG path builders ────────────────────────────────────────────────────────

interface Point {
  x: number
  y: number
}

function buildAreaPath(points: Point[], baseline: number): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const { x, y } = points[0]
    return `M${(x - 1).toFixed(2)},${baseline.toFixed(2)} L${(x - 1).toFixed(2)},${y.toFixed(2)} L${(x + 1).toFixed(2)},${y.toFixed(2)} L${(x + 1).toFixed(2)},${baseline.toFixed(2)} Z`
  }
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  return `${line} L${last.x.toFixed(2)},${baseline.toFixed(2)} L${first.x.toFixed(2)},${baseline.toFixed(2)} Z`
}

function buildLinePath(points: Point[]): string {
  if (points.length === 0) return ''
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ')
}

// ─── Chart data type ──────────────────────────────────────────────────────────

interface ChartData {
  innerW: number
  innerH: number
  baseline: number
  yOf: (v: number) => number
  xOf: (i: number) => number
  investmentPts: Point[]
  closedPnlPts: Point[]
  openPnlPts: Point[]
  yTicks: number[]
  xLabels: Array<{ i: number; date: string; x: number }>
}

// ─── Sort config type ─────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'
interface SortConfig {
  column: string
  dir: SortDir
}

// ─── Position chips component ─────────────────────────────────────────────────

function PositionChips({ positions }: { positions: PositionChip[] | null | undefined }) {
  if (!positions || positions.length === 0) {
    return (
      <span style={{ color: 'rgba(128,128,128,0.4)', fontSize: 11 }} aria-label="None">
        &mdash;
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {positions.map((pos, j) => (
        <span
          key={`${pos.symbol}-${j}`}
          style={{
            display: 'block',
            backgroundColor: pos.pnl >= 0 ? COLORS.chipPositiveBg : COLORS.chipNegativeBg,
            color: pos.pnl >= 0 ? COLORS.positive : COLORS.negative,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
          title={`${pos.symbol}: P&L ${formatPct(pos.pnl_pct)}`}
        >
          {formatPositionChip(pos)}
        </span>
      ))}
    </div>
  )
}

// ─── Sort header component ────────────────────────────────────────────────────

function SortTh({
  label,
  column,
  sortConfig,
  onSort,
  className = '',
}: {
  label: string
  column: string
  sortConfig: SortConfig
  onSort: (col: string) => void
  className?: string
}) {
  const isActive = sortConfig.column === column
  return (
    <th
      scope="col"
      className={`py-2 px-3 border-b border-border ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 text-left text-xs font-medium text-ink-muted whitespace-nowrap hover:text-ink-primary transition-colors"
        aria-sort={isActive ? (sortConfig.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span
          style={{
            opacity: isActive ? 0.85 : 0.25,
            fontSize: 9,
            lineHeight: 1,
            marginTop: 1,
          }}
        >
          {isActive && sortConfig.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-9 rounded animate-pulse"
          style={{ backgroundColor: 'rgba(128,128,128,0.08)' }}
        />
      ))}
    </div>
  )
}

// ─── Portfolio types ──────────────────────────────────────────────────────────

interface Portfolio {
  id: string
  name: string
  is_default: boolean
}

const PRESETS: Array<{ label: string; months: number }> = [
  { label: '1M', months: 1 },
  { label: '2M', months: 2 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
]

// ─── Edit field type ──────────────────────────────────────────────────────────

type EditField = 'investment' | 'closed_pnl' | 'open_pnl'
const EDIT_FIELDS: Array<[EditField, string]> = [
  ['investment', 'Investment'],
  ['closed_pnl', 'Closed P&L'],
  ['open_pnl', 'Open P&L'],
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyPerformancePage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [records, setRecords] = useState<DailyPerformanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [runningSnapshot, setRunningSnapshot] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Date filter state ────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => subDays(getToday(), 60))
  const [dateTo, setDateTo] = useState<string>(getToday)

  // ── Sort state ───────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'date', dir: 'desc' })

  // ── Chart state ──────────────────────────────────────────────────────────────
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // ── Portfolio state ──────────────────────────────────────────────────────────
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null)
  const [portfoliosLoading, setPortfoliosLoading] = useState(true)

  // ── Backfill state ────────────────────────────────────────────────────────────
  const [runningBackfill, setRunningBackfill] = useState(false)
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false)
  const [backfillMessage, setBackfillMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  // ── Per-row delete state ─────────────────────────────────────────────────────
  const [deletingRowDate, setDeletingRowDate] = useState<string | null>(null)

  // ── Edit record modal state ──────────────────────────────────────────────────
  const [editingRecord, setEditingRecord] = useState<DailyPerformanceRecord | null>(null)
  const [editFieldValues, setEditFieldValues] = useState<Record<EditField, string>>({
    investment: '',
    closed_pnl: '',
    open_pnl: '',
  })
  const [editSaving, setEditSaving] = useState(false)

  // ── Cash transactions panel state ────────────────────────────────────────────
  const [showCashPanel, setShowCashPanel] = useState(false)
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([])
  const [cashLoading, setCashLoading] = useState(false)
  const [showAddCashForm, setShowAddCashForm] = useState(false)
  const [addCashForm, setAddCashForm] = useState({ date: getToday(), amount: '', note: '' })
  const [addCashSaving, setAddCashSaving] = useState(false)
  const [editingTxId, setEditingTxId] = useState<string | null>(null)
  const [editTxForm, setEditTxForm] = useState({ amount: '', note: '' })
  const [editTxSaving, setEditTxSaving] = useState(false)

  // ── ResizeObserver for responsive chart ──────────────────────────────────────
  useEffect(() => {
    const el = chartContainerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Fetch portfolios on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await apiClient.get<Portfolio[]>('/portfolios')
        if (cancelled) return
        setPortfolios(data)
        const def = data.find((p) => p.is_default) ?? data[0]
        if (def) setSelectedPortfolioId(def.id)
      } catch {
        if (!cancelled) setError('Failed to load portfolios. Please refresh the page.')
      } finally {
        if (!cancelled) setPortfoliosLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!selectedPortfolioId) return
    setLoading(true)
    setError(null)
    try {
      const data = await dailyPerformanceService.getRecords(selectedPortfolioId, dateFrom, dateTo)
      setRecords(data)
    } catch {
      setError('Failed to load daily performance data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [selectedPortfolioId, dateFrom, dateTo])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ── Cash transactions fetch ───────────────────────────────────────────────────
  const fetchCashTransactions = useCallback(async () => {
    if (!selectedPortfolioId) return
    setCashLoading(true)
    try {
      const data = await portfolioCashTransactionService.list(selectedPortfolioId)
      setCashTransactions(data)
    } catch {
      setError('Failed to load cash transactions.')
    } finally {
      setCashLoading(false)
    }
  }, [selectedPortfolioId])

  useEffect(() => {
    if (showCashPanel) {
      fetchCashTransactions()
    }
  }, [showCashPanel, fetchCashTransactions])

  // ── Sorted records (for table only; chart always uses chronological order) ───
  const sortedRecords = useMemo<DailyPerformanceRecord[]>(() => {
    return [...records].sort((a, b) => {
      let aVal: string | number
      let bVal: string | number
      switch (sortConfig.column) {
        case 'investment':    aVal = a.investment;    bVal = b.investment;    break
        case 'closed_pnl':   aVal = a.closed_pnl;    bVal = b.closed_pnl;    break
        case 'closed_pct':   aVal = a.closed_pnl_pct; bVal = b.closed_pnl_pct; break
        case 'open_pnl':     aVal = a.open_pnl;      bVal = b.open_pnl;      break
        case 'open_pct':     aVal = a.open_pnl_pct;  bVal = b.open_pnl_pct;  break
        default:             aVal = a.date;           bVal = b.date;          break
      }
      if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [records, sortConfig])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const toggleSort = (column: string) => {
    setSortConfig(prev =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'desc' },
    )
  }

  const handleRunNow = async () => {
    if (!selectedPortfolioId) return
    setRunningSnapshot(true)
    setError(null)
    try {
      await dailyPerformanceService.runSnapshot(selectedPortfolioId)
      await fetchData()
    } catch {
      setError('Snapshot failed. Please try again.')
    } finally {
      setRunningSnapshot(false)
    }
  }

  const handleBackfillConfirm = async () => {
    if (!selectedPortfolioId) return
    setShowBackfillConfirm(false)
    setRunningBackfill(true)
    setBackfillMessage(null)
    setError(null)
    try {
      const result: BackfillResult = await dailyPerformanceService.backfill(selectedPortfolioId)
      setBackfillMessage({
        type: 'success',
        text: `Backfill complete: ${result.processed} days processed, ${result.skipped} skipped, ${result.errors} errors.`,
      })
      if (result.start_date) {
        setDateFrom(result.start_date)
      } else {
        await fetchData()
      }
    } catch {
      setBackfillMessage({
        type: 'error',
        text: 'Backfill failed. Please check the server logs and try again.',
      })
    } finally {
      setRunningBackfill(false)
    }
  }

  const applyPreset = (months: number) => {
    const today = getToday()
    const from = new Date(today + 'T00:00:00')
    from.setMonth(from.getMonth() - months)
    setDateFrom(from.toISOString().split('T')[0])
    setDateTo(today)
  }

  // ── Delete row ───────────────────────────────────────────────────────────────

  const handleDeleteRow = async (record: DailyPerformanceRecord) => {
    if (!selectedPortfolioId) return
    if (!window.confirm(`Delete performance record for ${record.date}?`)) return
    setDeletingRowDate(record.date)
    try {
      await dailyPerformanceService.deleteRecord(record.date, selectedPortfolioId)
      await fetchData()
    } catch {
      setError('Failed to delete record. Please try again.')
    } finally {
      setDeletingRowDate(null)
    }
  }

  // ── Edit record modal ────────────────────────────────────────────────────────

  const handleOpenEdit = (record: DailyPerformanceRecord) => {
    setEditingRecord(record)
    setEditFieldValues({
      investment: String(record.investment),
      closed_pnl: String(record.closed_pnl),
      open_pnl: String(record.open_pnl),
    })
  }

  const handleEditSave = async () => {
    if (!editingRecord || !selectedPortfolioId) return
    setEditSaving(true)
    try {
      const update: DailyPerformanceUpdateInput = {}
      const inv = parseFloat(editFieldValues.investment)
      const cpnl = parseFloat(editFieldValues.closed_pnl)
      const opnl = parseFloat(editFieldValues.open_pnl)
      if (!isNaN(inv)) update.investment = inv
      if (!isNaN(cpnl)) update.closed_pnl = cpnl
      if (!isNaN(opnl)) update.open_pnl = opnl
      await dailyPerformanceService.updateRecord(selectedPortfolioId, editingRecord.date, update)
      await fetchData()
      setEditingRecord(null)
    } catch {
      setError('Failed to save changes. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Cash transaction handlers ────────────────────────────────────────────────

  const handleAddCashTx = async () => {
    if (!selectedPortfolioId) return
    const amount = parseFloat(addCashForm.amount)
    if (!addCashForm.date || isNaN(amount)) return
    setAddCashSaving(true)
    try {
      await portfolioCashTransactionService.create({
        portfolio_id: selectedPortfolioId,
        date: addCashForm.date,
        amount,
        note: addCashForm.note || undefined,
      })
      setAddCashForm({ date: getToday(), amount: '', note: '' })
      setShowAddCashForm(false)
      await fetchCashTransactions()
    } catch {
      setError('Failed to add cash transaction.')
    } finally {
      setAddCashSaving(false)
    }
  }

  const handleStartEditTx = (tx: CashTransaction) => {
    setEditingTxId(tx.id)
    setEditTxForm({ amount: String(tx.amount), note: tx.note ?? '' })
  }

  const handleSaveTx = async () => {
    if (!editingTxId) return
    const amount = parseFloat(editTxForm.amount)
    if (isNaN(amount)) return
    setEditTxSaving(true)
    try {
      await portfolioCashTransactionService.update(editingTxId, {
        amount,
        note: editTxForm.note || undefined,
      })
      setEditingTxId(null)
      await fetchCashTransactions()
    } catch {
      setError('Failed to update cash transaction.')
    } finally {
      setEditTxSaving(false)
    }
  }

  const handleDeleteTx = async (id: string) => {
    if (!window.confirm('Delete this cash transaction?')) return
    try {
      await portfolioCashTransactionService.delete(id)
      await fetchCashTransactions()
    } catch {
      setError('Failed to delete cash transaction.')
    }
  }

  // ── Chart computations (memoized; uses chronological `records` array) ────────
  const chartData = useMemo((): ChartData | null => {
    if (records.length === 0 || containerWidth === 0) return null

    const innerW = containerWidth - CHART_PAD.left - CHART_PAD.right
    const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom

    const allValues = records.flatMap((r) => [r.investment, r.closed_pnl, r.open_pnl])
    const dataMin = Math.min(0, ...allValues)
    const dataMax = Math.max(...allValues)
    const range = Math.max(dataMax - dataMin, 1)
    const yMin = dataMin - range * 0.05
    const yMax = dataMax + range * 0.1
    const yRange = yMax - yMin

    const xOf = (i: number): number =>
      CHART_PAD.left +
      (records.length > 1 ? (i / (records.length - 1)) * innerW : innerW / 2)

    const yOf = (v: number): number =>
      CHART_PAD.top + innerH - ((v - yMin) / yRange) * innerH

    const rawBaseline = yOf(0)
    const baseline = Math.max(
      CHART_PAD.top,
      Math.min(CHART_PAD.top + innerH, rawBaseline),
    )

    const investmentPts = records.map((r, i) => ({ x: xOf(i), y: yOf(r.investment) }))
    const closedPnlPts = records.map((r, i) => ({ x: xOf(i), y: yOf(r.closed_pnl) }))
    const openPnlPts = records.map((r, i) => ({ x: xOf(i), y: yOf(r.open_pnl) }))

    const tickCount = 5
    const yTicks = Array.from(
      { length: tickCount },
      (_, i) => yMin + (i / (tickCount - 1)) * yRange,
    )

    const labelStep = Math.max(1, Math.ceil(records.length / 8))
    const seen = new Set<number>()
    const xLabels: Array<{ i: number; date: string; x: number }> = []
    records.forEach((r, i) => {
      if (i % labelStep === 0 || i === records.length - 1) {
        if (!seen.has(i)) {
          seen.add(i)
          xLabels.push({ i, date: r.date, x: xOf(i) })
        }
      }
    })

    return { innerW, innerH, baseline, yOf, xOf, investmentPts, closedPnlPts, openPnlPts, yTicks, xLabels }
  }, [records, containerWidth])

  // ── SVG hover ────────────────────────────────────────────────────────────────
  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!chartData || records.length === 0) return
      const svgRect = e.currentTarget.getBoundingClientRect()
      const mouseX = e.clientX - svgRect.left - CHART_PAD.left
      const step =
        records.length > 1 ? chartData.innerW / (records.length - 1) : chartData.innerW
      const idx = Math.max(0, Math.min(records.length - 1, Math.round(mouseX / step)))
      setHoverIndex(idx)
    },
    [chartData, records.length],
  )

  const handleSvgMouseLeave = useCallback(() => {
    setHoverIndex(null)
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const today = getToday()

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-brand-400" aria-hidden="true" />
            Daily Performance
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Historical P&amp;L and investment activity by day
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowBackfillConfirm(true)}
            disabled={runningBackfill || runningSnapshot || loading}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded border border-border text-ink-secondary hover:text-ink-primary hover:border-brand-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-live="polite"
            aria-busy={runningBackfill}
          >
            <History className={`w-4 h-4 ${runningBackfill ? 'animate-spin' : ''}`} aria-hidden="true" />
            {runningBackfill ? 'Generating…' : 'Backfill History'}
          </button>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={runningSnapshot || loading || runningBackfill}
            className="btn-primary flex items-center gap-1.5 text-sm"
            aria-live="polite"
            aria-busy={runningSnapshot}
          >
            <RefreshCw className={`w-4 h-4 ${runningSnapshot ? 'animate-spin' : ''}`} aria-hidden="true" />
            {runningSnapshot ? 'Running…' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="flex items-center gap-2 rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: 'rgba(239,68,68,0.35)',
            backgroundColor: 'rgba(239,68,68,0.07)',
            color: COLORS.negative,
          }}
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Backfill result banner ────────────────────────────────────────────── */}
      {backfillMessage && (
        <div
          className="flex items-center gap-2 rounded-md border px-4 py-3 text-sm"
          style={
            backfillMessage.type === 'success'
              ? { borderColor: 'rgba(34,197,94,0.35)', backgroundColor: 'rgba(34,197,94,0.07)', color: COLORS.positive }
              : { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.07)', color: COLORS.negative }
          }
          role="alert"
          aria-live="assertive"
        >
          {backfillMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          )}
          <span className="flex-1">{backfillMessage.text}</span>
          <button
            type="button"
            onClick={() => setBackfillMessage(null)}
            className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Section 1: Date range filter ──────────────────────────────────────── */}
      <section aria-labelledby="filter-heading" className="card p-4">
        <h2 id="filter-heading" className="sr-only">Date range filter</h2>
        <div className="flex flex-wrap items-center gap-3">
          {!portfoliosLoading && portfolios.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor="dp-portfolio" className="text-xs text-ink-muted whitespace-nowrap">Portfolio</label>
              <select
                id="dp-portfolio"
                value={selectedPortfolioId ?? ''}
                onChange={(e) => setSelectedPortfolioId(e.target.value)}
                className="input text-sm px-2 py-1.5"
                aria-label="Select portfolio"
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="dp-date-from" className="text-xs text-ink-muted whitespace-nowrap">From</label>
            <input
              id="dp-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              max={dateTo}
              className="input text-sm px-2 py-1.5"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="dp-date-to" className="text-xs text-ink-muted whitespace-nowrap">To</label>
            <input
              id="dp-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              min={dateFrom}
              max={today}
              className="input text-sm px-2 py-1.5"
            />
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Quick date presets">
            {PRESETS.map(({ label, months }) => (
              <button
                key={label}
                type="button"
                onClick={() => applyPreset(months)}
                className="text-xs px-2.5 py-1 rounded border border-border text-ink-secondary hover:text-ink-primary hover:border-brand-400 transition-colors"
                aria-label={`Last ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
          {loading && records.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-ink-muted ml-auto">
              <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
              Refreshing
            </span>
          )}
        </div>
      </section>

      {/* ── Section 2: Stacked area chart ─────────────────────────────────────── */}
      <section aria-labelledby="chart-heading" className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 id="chart-heading" className="text-sm font-semibold text-ink-primary">Performance Chart</h2>
          <div className="flex items-center gap-4 text-xs text-ink-muted" role="list" aria-label="Chart legend">
            {(
              [
                { label: 'Investment', color: COLORS.investment },
                { label: 'Closed P&L', color: COLORS.closedPnl },
                { label: 'Open P&L', color: COLORS.openPnl },
              ] as const
            ).map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1.5" role="listitem">
                <span className="inline-block w-3 rounded-full" style={{ height: '2px', backgroundColor: color }} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </div>
        <div
          ref={chartContainerRef}
          className="w-full relative"
          style={{ height: `${CHART_H}px` }}
          role="img"
          aria-label="Daily performance chart"
        >
          {(loading || portfoliosLoading) && records.length === 0 ? (
            <div className="flex items-center justify-center h-full" aria-busy="true">
              <RefreshCw className="w-6 h-6 animate-spin text-ink-muted" aria-hidden="true" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-ink-muted text-center max-w-xs">
                No data for selected period. Click &lsquo;Run Now&rsquo; to generate today&apos;s snapshot.
              </p>
            </div>
          ) : chartData ? (
            <svg
              width={containerWidth}
              height={CHART_H}
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={handleSvgMouseLeave}
              style={{ display: 'block', cursor: 'crosshair' }}
              aria-hidden="true"
            >
              {chartData.yTicks.map((tick, i) => {
                const y = chartData.yOf(tick)
                return (
                  <g key={i}>
                    <line x1={CHART_PAD.left} y1={y} x2={containerWidth - CHART_PAD.right} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
                    <text x={CHART_PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                      {formatAxisNumber(tick)}
                    </text>
                  </g>
                )
              })}
              <line x1={CHART_PAD.left} y1={chartData.baseline} x2={containerWidth - CHART_PAD.right} y2={chartData.baseline} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
              {chartData.xLabels.map(({ i, date, x }) => (
                <text key={i} x={x} y={CHART_H - CHART_PAD.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.45}>
                  {formatXLabel(date)}
                </text>
              ))}
              <path d={buildAreaPath(chartData.investmentPts, chartData.baseline)} fill={COLORS.investment} fillOpacity={0.12} stroke="none" />
              <path d={buildAreaPath(chartData.closedPnlPts, chartData.baseline)} fill={COLORS.closedPnl} fillOpacity={0.18} stroke="none" />
              <path d={buildAreaPath(chartData.openPnlPts, chartData.baseline)} fill={COLORS.openPnl} fillOpacity={0.12} stroke="none" />
              <path d={buildLinePath(chartData.investmentPts)} fill="none" stroke={COLORS.investment} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              <path d={buildLinePath(chartData.closedPnlPts)} fill="none" stroke={COLORS.closedPnl} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              <path d={buildLinePath(chartData.openPnlPts)} fill="none" stroke={COLORS.openPnl} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

              {hoverIndex !== null && hoverIndex >= 0 && hoverIndex < records.length && (() => {
                const record = records[hoverIndex]
                const px = chartData.investmentPts[hoverIndex].x
                const py_inv = chartData.investmentPts[hoverIndex].y
                const py_closed = chartData.closedPnlPts[hoverIndex].y
                const py_open = chartData.openPnlPts[hoverIndex].y
                const tooltipW = 178
                const tooltipH = 94
                const margin = 10
                const tooltipX = px + tooltipW + margin > containerWidth - CHART_PAD.right ? px - tooltipW - margin : px + margin
                const tooltipY = CHART_PAD.top + 2
                return (
                  <g>
                    <line x1={px} y1={CHART_PAD.top} x2={px} y2={CHART_PAD.top + chartData.innerH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4,3" />
                    <circle cx={px} cy={py_inv} r={3.5} fill={COLORS.investment} />
                    <circle cx={px} cy={py_closed} r={3.5} fill={COLORS.closedPnl} />
                    <circle cx={px} cy={py_open} r={3.5} fill={COLORS.openPnl} />
                    <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} rx={5} ry={5} fill="#1a1d23" fillOpacity={0.97} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                    <text x={tooltipX + 10} y={tooltipY + 16} fontSize={11} fontWeight={600} fill="currentColor" opacity={0.85}>{record.date}</text>
                    <circle cx={tooltipX + 14} cy={tooltipY + 33} r={3} fill={COLORS.investment} />
                    <text x={tooltipX + 24} y={tooltipY + 37} fontSize={10} fill={COLORS.investment}>{formatNumber(record.investment)}</text>
                    <text x={tooltipX + 100} y={tooltipY + 37} fontSize={10} fill="currentColor" opacity={0.42}>Invest</text>
                    <circle cx={tooltipX + 14} cy={tooltipY + 53} r={3} fill={COLORS.closedPnl} />
                    <text x={tooltipX + 24} y={tooltipY + 57} fontSize={10} fill={COLORS.closedPnl}>{formatNumber(record.closed_pnl)}</text>
                    <text x={tooltipX + 100} y={tooltipY + 57} fontSize={10} fill="currentColor" opacity={0.42}>Closed P&L</text>
                    <circle cx={tooltipX + 14} cy={tooltipY + 73} r={3} fill={COLORS.openPnl} />
                    <text x={tooltipX + 24} y={tooltipY + 77} fontSize={10} fill={COLORS.openPnl}>{formatNumber(record.open_pnl)}</text>
                    <text x={tooltipX + 100} y={tooltipY + 77} fontSize={10} fill="currentColor" opacity={0.42}>Open P&L</text>
                  </g>
                )
              })()}
            </svg>
          ) : null}
        </div>
      </section>

      {/* ── Section 3: Data table ──────────────────────────────────────────────── */}
      <section aria-labelledby="table-heading" className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="table-heading" className="text-sm font-semibold text-ink-primary">
            Daily Records
            {records.length > 0 && (
              <span className="ml-2 text-xs text-ink-muted font-normal">({records.length} rows)</span>
            )}
          </h2>
        </div>

        {(loading || portfoliosLoading) && records.length === 0 ? (
          <SkeletonRows />
        ) : records.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-8">
            No records found for the selected date range.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              aria-label="Daily performance records"
            >
              <thead>
                <tr>
                  <SortTh label="Date"       column="date"        sortConfig={sortConfig} onSort={toggleSort} />
                  <SortTh label="Investment"  column="investment"  sortConfig={sortConfig} onSort={toggleSort} />
                  <SortTh label="Closed P&L"  column="closed_pnl"  sortConfig={sortConfig} onSort={toggleSort} />
                  <SortTh label="Closed %"    column="closed_pct"  sortConfig={sortConfig} onSort={toggleSort} />
                  <SortTh label="Open P&L"    column="open_pnl"    sortConfig={sortConfig} onSort={toggleSort} />
                  <SortTh label="Open %"      column="open_pct"    sortConfig={sortConfig} onSort={toggleSort} />
                  <th scope="col" className="py-2 px-3 text-left text-xs font-medium text-ink-muted border-b border-border whitespace-nowrap">
                    Open Positions
                  </th>
                  <th scope="col" className="py-2 px-3 text-left text-xs font-medium text-ink-muted border-b border-border whitespace-nowrap">
                    Purchased
                  </th>
                  <th scope="col" className="py-2 px-3 text-left text-xs font-medium text-ink-muted border-b border-border whitespace-nowrap">
                    Sold
                  </th>
                  <th scope="col" className="py-2 px-3 text-left text-xs font-medium text-ink-muted border-b border-border whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid rgba(128,128,128,0.08)' }}
                  >
                    {/* Date */}
                    <td className="py-2.5 px-3 text-ink-secondary whitespace-nowrap font-mono text-xs">
                      {record.date}
                    </td>

                    {/* Investment */}
                    <td className="py-2.5 px-3 text-ink-primary tabular-nums">
                      {formatNumber(record.investment)}
                    </td>

                    {/* Closed P&L */}
                    <td
                      className="py-2.5 px-3 tabular-nums"
                      style={{ color: record.closed_pnl >= 0 ? COLORS.positive : COLORS.negative }}
                    >
                      {formatNumber(record.closed_pnl)}
                    </td>

                    {/* Closed % */}
                    <td
                      className="py-2.5 px-3 whitespace-nowrap tabular-nums"
                      style={{ color: record.closed_pnl_pct >= 0 ? COLORS.positive : COLORS.negative }}
                    >
                      {formatPct(record.closed_pnl_pct)}
                    </td>

                    {/* Open P&L */}
                    <td
                      className="py-2.5 px-3 tabular-nums"
                      style={{ color: record.open_pnl >= 0 ? COLORS.positive : COLORS.negative }}
                    >
                      {formatNumber(record.open_pnl)}
                    </td>

                    {/* Open % */}
                    <td
                      className="py-2.5 px-3 whitespace-nowrap tabular-nums"
                      style={{ color: record.open_pnl_pct >= 0 ? COLORS.positive : COLORS.negative }}
                    >
                      {formatPct(record.open_pnl_pct)}
                    </td>

                    {/* Open Positions chips */}
                    <td className="py-2.5 px-3">
                      <PositionChips positions={record.open_positions} />
                    </td>

                    {/* Purchased chips */}
                    <td className="py-2.5 px-3">
                      <PositionChips positions={record.purchased_positions} />
                    </td>

                    {/* Sold chips */}
                    <td className="py-2.5 px-3">
                      <PositionChips positions={record.sold_positions} />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(record)}
                          className="text-ink-muted hover:text-ink-primary transition-colors"
                          aria-label={`Edit record for ${record.date}`}
                          title="Edit record"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(record)}
                          disabled={deletingRowDate === record.date}
                          className="text-ink-muted transition-colors disabled:opacity-40"
                          style={{ color: deletingRowDate === record.date ? undefined : undefined }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = COLORS.negative }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '' }}
                          aria-label={`Delete record for ${record.date}`}
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section 4: Cash Transactions management panel ─────────────────────── */}
      <section className="card" aria-labelledby="cash-panel-heading">
        <button
          type="button"
          id="cash-panel-heading"
          onClick={() => setShowCashPanel((p) => !p)}
          className="w-full flex items-center justify-between p-4 text-sm font-semibold text-ink-primary hover:text-brand-400 transition-colors"
          aria-expanded={showCashPanel}
          aria-controls="cash-panel-body"
        >
          <span>Manage Investment Records</span>
          {showCashPanel ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </button>

        {showCashPanel && (
          <div id="cash-panel-body" className="px-4 pb-4 space-y-3 border-t border-border pt-3">
            <p className="text-xs text-ink-muted">
              Record cash deposits and withdrawals. The cumulative total on any given date
              is used as the &ldquo;Investment&rdquo; figure on daily snapshots.
              Positive = deposit, negative = withdrawal.
            </p>

            {/* Add button / form */}
            {!showAddCashForm ? (
              <button
                type="button"
                onClick={() => setShowAddCashForm(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-border text-ink-secondary hover:text-ink-primary hover:border-brand-400 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Add Transaction
              </button>
            ) : (
              <div
                className="flex flex-wrap items-end gap-2 p-3 rounded-md"
                style={{ backgroundColor: 'rgba(128,128,128,0.05)' }}
              >
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-ink-muted">Date</label>
                  <input
                    type="date"
                    value={addCashForm.date}
                    onChange={(e) => setAddCashForm((p) => ({ ...p, date: e.target.value }))}
                    className="input text-xs px-2 py-1.5"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-ink-muted">Amount</label>
                  <input
                    type="number"
                    placeholder="e.g. 100000"
                    value={addCashForm.amount}
                    onChange={(e) => setAddCashForm((p) => ({ ...p, amount: e.target.value }))}
                    className="input text-xs px-2 py-1.5 w-32"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-ink-muted">Note (optional)</label>
                  <input
                    type="text"
                    placeholder="Initial deposit"
                    value={addCashForm.note}
                    onChange={(e) => setAddCashForm((p) => ({ ...p, note: e.target.value }))}
                    className="input text-xs px-2 py-1.5 w-40"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCashTx}
                    disabled={addCashSaving || !addCashForm.date || !addCashForm.amount}
                    className="btn-primary text-xs py-1.5"
                  >
                    {addCashSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddCashForm(false)}
                    className="text-xs px-2.5 py-1.5 rounded border border-border text-ink-secondary hover:text-ink-primary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Transactions table */}
            {cashLoading ? (
              <div className="text-xs text-ink-muted py-4 text-center">Loading…</div>
            ) : cashTransactions.length === 0 ? (
              <p className="text-xs text-ink-muted py-4 text-center">
                No cash transactions recorded. Add your first deposit above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse" aria-label="Cash transactions">
                  <thead>
                    <tr>
                      {['Date', 'Amount', 'Note', ''].map((h) => (
                        <th
                          key={h}
                          className="py-2 px-3 text-left font-medium text-ink-muted border-b border-border whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cashTransactions.map((tx) =>
                      editingTxId === tx.id ? (
                        <tr key={tx.id} style={{ borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                          <td className="py-2 px-3 font-mono text-ink-secondary">{tx.date}</td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              value={editTxForm.amount}
                              onChange={(e) => setEditTxForm((p) => ({ ...p, amount: e.target.value }))}
                              className="input text-xs px-2 py-1 w-28"
                              autoFocus
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={editTxForm.note}
                              onChange={(e) => setEditTxForm((p) => ({ ...p, note: e.target.value }))}
                              className="input text-xs px-2 py-1 w-36"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={handleSaveTx}
                                disabled={editTxSaving}
                                className="btn-primary text-xs py-0.5 px-2"
                              >
                                {editTxSaving ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTxId(null)}
                                className="text-xs px-2 py-0.5 rounded border border-border text-ink-secondary hover:text-ink-primary transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={tx.id} style={{ borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                          <td className="py-2 px-3 font-mono text-ink-secondary">{tx.date}</td>
                          <td
                            className="py-2 px-3 tabular-nums"
                            style={{ color: tx.amount >= 0 ? COLORS.positive : COLORS.negative }}
                          >
                            {tx.amount >= 0 ? '+' : ''}
                            {tx.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2 px-3 text-ink-secondary">{tx.note ?? '—'}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditTx(tx)}
                                className="text-ink-muted hover:text-ink-primary transition-colors"
                                aria-label="Edit transaction"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTx(tx.id)}
                                className="text-ink-muted transition-colors"
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = COLORS.negative }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '' }}
                                aria-label="Delete transaction"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Backfill confirmation modal ────────────────────────────────────────── */}
      {showBackfillConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="backfill-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowBackfillConfirm(false) }}
        >
          <div className="card p-6 max-w-md w-full space-y-4">
            <h3
              id="backfill-confirm-title"
              className="text-base font-semibold text-ink-primary flex items-center gap-2"
            >
              <History className="w-4 h-4 text-brand-400" aria-hidden="true" />
              Backfill Historical Data
            </h3>
            <p className="text-sm text-ink-secondary leading-relaxed">
              This will <strong>DELETE all existing records</strong> for this portfolio and
              regenerate them from scratch using your current position history and cash
              transactions. It may take 30–60 seconds.
            </p>
            <p className="text-xs text-ink-muted">
              This operation cannot be undone. Any manual edits to existing records will be lost.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowBackfillConfirm(false)}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="text-sm px-3 py-2 rounded border border-border text-ink-secondary hover:text-ink-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBackfillConfirm}
                className="btn-primary text-sm"
                style={{ backgroundColor: COLORS.negative, borderColor: COLORS.negative }}
              >
                Delete &amp; Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Backfill in-progress overlay ──────────────────────────────────────── */}
      {runningBackfill && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          aria-live="assertive"
          aria-label="Generating historical data"
        >
          <div className="card px-8 py-6 flex flex-col items-center gap-3 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-brand-400" aria-hidden="true" />
            <p className="text-sm font-medium text-ink-primary">Generating historical data…</p>
            <p className="text-xs text-ink-muted max-w-xs">
              Fetching prices and computing snapshots. This may take up to 60 seconds.
            </p>
          </div>
        </div>
      )}

      {/* ── Edit record modal ─────────────────────────────────────────────────── */}
      {editingRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-record-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingRecord(null) }}
        >
          <div className="card p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="edit-record-title" className="text-base font-semibold text-ink-primary">
                Edit Record — <span className="font-mono">{editingRecord.date}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="text-ink-muted hover:text-ink-primary transition-colors"
                aria-label="Close edit modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {EDIT_FIELDS.map(([field, label]) => (
                <div key={field} className="flex items-center gap-3">
                  <label className="text-xs text-ink-muted w-24 shrink-0">{label}</label>
                  <input
                    type="number"
                    value={editFieldValues[field]}
                    onChange={(e) =>
                      setEditFieldValues((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    className="input text-sm px-2 py-1.5 flex-1"
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              Percentage columns are recomputed automatically from the updated values.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="text-sm px-3 py-2 rounded border border-border text-ink-secondary hover:text-ink-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                disabled={editSaving}
                className="btn-primary text-sm"
              >
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
