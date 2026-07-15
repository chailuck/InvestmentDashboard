'use client'

import { useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft, RefreshCw, Loader2, AlertCircle, Plus, Trash2,
  TrendingUp, TrendingDown, Briefcase, X, ChevronDown, BarChart2,
  ChevronsUp, ChevronUp, ChevronsDown,
  type LucideProps,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  reviewListService, FEELINGS,
  type ReviewItem, type ReviewDetail, type ItemType, type FeelingValue, type ReviewItemIn,
} from '@/services/reviewList'

// ── Formatting helpers ─────────────────────────────────────────────────────────

const fmtDate  = (iso: string | null) => iso ? format(parseISO(iso), 'dd MMM') : '—'
const fmtPrice = (v: number | null) =>
  v != null ? v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtSize  = (v: number | null | undefined) => v != null ? v.toLocaleString() : '—'

function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-ink-disabled">—</span>
  const pos = pct >= 0
  return (
    <span className={cn('font-semibold tabular-nums', pos ? 'text-gain' : 'text-loss')}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

// ── Feeling icon map ─────────────────────────────────────────────────────────

type IconComponent = React.FC<LucideProps>
const FEELING_ICONS: Record<string, IconComponent> = {
  ChevronsUp, ChevronUp, ChevronDown, ChevronsDown,
}

// ── Feeling Picker ────────────────────────────────────────────────────────────

function FeelingPicker({
  value,
  readOnly,
  onChange,
}: {
  value: FeelingValue | null
  readOnly: boolean
  onChange: (v: FeelingValue | null) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-0.1">
      {FEELINGS.map(f => {
        const Icon = FEELING_ICONS[f.iconKey]
        const active = value === f.value
        return (
          <button
            key={f.value}
            disabled={readOnly}
            onClick={() => onChange(active ? null : f.value as FeelingValue)}
            title={f.label}
            className={cn(
              'w-5 h-5 rounded flex items-center justify-center border transition-all',
              active
                ? cn(f.color, f.bg, 'scale-110')
                : cn('border-border/30 text-ink-disabled hover:border-border hover:text-ink-muted hover:scale-110'),
              readOnly && 'opacity-40 cursor-not-allowed pointer-events-none',
            )}
          >
            <Icon className="w-3 h-3" strokeWidth={2.5} />
          </button>
        )
      })}
    </div>
  )
}

// ── Reason Input (auto-save on blur) ──────────────────────────────────────────

function ReasonInput({
  value, placeholder, readOnly, onSave,
}: {
  value: string | null
  placeholder: string
  readOnly: boolean
  onSave: (v: string | null) => void
}) {
  const [local, setLocal] = useState(value ?? '')
  const dirty = useRef(false)

  const handleBlur = () => {
    if (dirty.current) { onSave(local.trim() || null); dirty.current = false }
  }

  return (
    <textarea
      value={local}
      onChange={e => { setLocal(e.target.value); dirty.current = true }}
      onBlur={handleBlur}
      placeholder={readOnly ? '—' : placeholder}
      disabled={readOnly}
      rows={2}
      className={cn(
        'w-full text-xs rounded-lg border border-border/50 bg-surface-elevated/40 px-2 py-1 resize-none',
        'placeholder:text-ink-disabled text-ink-primary focus:outline-none focus:border-brand-500/50 transition-colors',
        readOnly && 'opacity-50 cursor-not-allowed bg-transparent',
      )}
    />
  )
}

// ── Add Item Modal ─────────────────────────────────────────────────────────────

function AddItemModal({ reviewId, onClose, onAdded }: { reviewId: string; onClose: () => void; onAdded: () => void }) {
  const [symbol, setSymbol] = useState('')
  const [itemType, setItemType] = useState<ItemType>('TRADE')
  // Buy leg
  const [buyDate, setBuyDate]   = useState(format(new Date(), 'yyyy-MM-dd'))
  const [buyPrice, setBuyPrice] = useState('')
  const [buySize, setBuySize]   = useState('')
  // Sell leg
  const [sellDate, setSellDate]   = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellSize, setSellSize]   = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!symbol.trim()) return
    setLoading(true)
    try {
      const payload: ReviewItemIn = {
        symbol: symbol.trim().toUpperCase(),
        item_type: itemType,
        buy_date:   buyDate || null,
        buy_price:  buyPrice  ? parseFloat(buyPrice)  : null,
        buy_size:   buySize   ? parseInt(buySize)      : null,
        sell_date:  sellDate  || null,
        sell_price: sellPrice ? parseFloat(sellPrice) : null,
        sell_size:  sellSize  ? parseInt(sellSize)    : null,
      }
      await reviewListService.addItem(reviewId, payload)
      onAdded()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-semibold text-ink-primary">Add Item</h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Symbol + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Symbol</label>
              <input
                autoFocus
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. BH"
                className="input w-full text-sm uppercase"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Type</label>
              <select value={itemType} onChange={e => setItemType(e.target.value as ItemType)} className="input w-full text-sm">
                <option value="TRADE">Trade (Buy/Sell)</option>
                <option value="HOLD">Hold (open position)</option>
              </select>
            </div>
          </div>

          {/* Buy leg */}
          <div>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Buy Leg</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-ink-muted mb-1">Date</label>
                <input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} className="input w-full text-xs" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Price</label>
                <input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0.00" className="input w-full text-xs" />
              </div>
              <div>
                <label className="block text-xs text-ink-muted mb-1">Size</label>
                <input type="number" value={buySize} onChange={e => setBuySize(e.target.value)} placeholder="0" className="input w-full text-xs" />
              </div>
            </div>
          </div>

          {/* Sell leg — only for TRADE */}
          {itemType === 'TRADE' && (
            <div>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Sell Leg (optional)</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-ink-muted mb-1">Date</label>
                  <input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} className="input w-full text-xs" />
                </div>
                <div>
                  <label className="block text-xs text-ink-muted mb-1">Price</label>
                  <input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="0.00" className="input w-full text-xs" />
                </div>
                <div>
                  <label className="block text-xs text-ink-muted mb-1">Size</label>
                  <input type="number" value={sellSize} onChange={e => setSellSize(e.target.value)} placeholder="0" className="input w-full text-xs" />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={submit}
              disabled={!symbol.trim() || loading}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Add
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Trade Row (Part 1) — unified buy + sell legs ───────────────────────────────

function TradeItemRow({
  item, readOnly, onPatch, onDelete,
}: {
  item: ReviewItem
  readOnly: boolean
  onPatch: (id: string, payload: Parameters<typeof reviewListService.patchItem>[2]) => void
  onDelete: (id: string) => void
}) {
  const sellIsWin = item.buy_price != null && item.sell_price != null
    ? item.sell_price >= item.buy_price
    : null

  return (
    <tr className="border-b border-border/20 hover:bg-surface-elevated/20 transition-colors align-top">
      {/* Symbol */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono font-bold text-xs text-ink-primary">{item.symbol}</span>
      </td>
      {/* Current price (Friday close, or Monday open if not yet available) */}
      <td className="px-2 py-2.5 text-xs text-ink-secondary tabular-nums whitespace-nowrap">
        {fmtPrice(item.week_close_price ?? item.week_open_price)}
      </td>
      {/* Buy: Date | Price/Size */}
      <td className="px-2 py-2.5 text-xs text-ink-muted whitespace-nowrap">{fmtDate(item.buy_date)}</td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="space-y-0.5">
          <div className="text-xs text-ink-secondary tabular-nums">{fmtPrice(item.buy_price)}</div>
          <div className="text-[10px] text-ink-muted tabular-nums">×{fmtSize(item.buy_size)}</div>
        </div>
      </td>
      {/* Buy reason + feeling */}
      <td className="px-2 py-2.5 min-w-[176px]">
        <ReasonInput
          value={item.buy_reason}
          placeholder="Why buy?"
          readOnly={readOnly}
          onSave={v => onPatch(item.id, { buy_reason: v })}
        />
      </td>
      <td className="px-2 py-2.5">
        <FeelingPicker value={item.buy_feeling} readOnly={readOnly} onChange={v => onPatch(item.id, { buy_feeling: v })} />
      </td>
      {/* Sell: Date | Price/Size (price coloured by win/loss) */}
      <td className="px-2 py-2.5 text-xs text-ink-muted whitespace-nowrap">{fmtDate(item.sell_date)}</td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        {item.sell_date ? (
          <div className="space-y-0.5">
            <div className={cn(
              'text-xs tabular-nums',
              sellIsWin === null ? 'text-ink-secondary' : sellIsWin ? 'text-gain' : 'text-loss',
            )}>
              {fmtPrice(item.sell_price)}
            </div>
            <div className="text-[10px] text-ink-muted tabular-nums">×{fmtSize(item.sell_size)}</div>
          </div>
        ) : <span className="text-ink-disabled text-xs">—</span>}
      </td>
      {/* Sell reason + feeling */}
      <td className="px-2 py-2.5 min-w-[176px]">
        {item.sell_date ? (
          <ReasonInput
            value={item.sell_reason}
            placeholder="Why sell?"
            readOnly={readOnly}
            onSave={v => onPatch(item.id, { sell_reason: v })}
          />
        ) : <span className="text-ink-disabled text-xs">—</span>}
      </td>
      <td className="px-2 py-2.5">
        {item.sell_date ? (
          <FeelingPicker value={item.sell_feeling} readOnly={readOnly} onChange={v => onPatch(item.id, { sell_feeling: v })} />
        ) : <span className="text-ink-disabled text-xs">—</span>}
      </td>
      {/* Week: Mon open / Fri close / Wk% stacked */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="space-y-0.5 tabular-nums">
          <div className="text-[10px] text-ink-disabled">{fmtPrice(item.week_open_price)}</div>
          <div className="text-[10px] text-ink-secondary">{fmtPrice(item.week_close_price)}</div>
          <PctBadge pct={item.week_change_pct} />
        </div>
      </td>
      {/* Delete */}
      <td className="px-2 py-2.5">
        {!readOnly && (
          <button onClick={() => onDelete(item.id)} className="btn-icon text-loss/60 hover:text-loss" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Hold Row (Part 2) ──────────────────────────────────────────────────────────

function HoldItemRow({
  item, readOnly, onPatch, onDelete,
}: {
  item: ReviewItem
  readOnly: boolean
  onPatch: (id: string, payload: Parameters<typeof reviewListService.patchItem>[2]) => void
  onDelete: (id: string) => void
}) {
  return (
    <tr className="border-b border-border/20 hover:bg-surface-elevated/20 transition-colors align-top">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono font-bold text-xs text-ink-primary">{item.symbol}</span>
      </td>
      {/* Current price */}
      <td className="px-2 py-2.5 text-xs text-ink-secondary tabular-nums whitespace-nowrap">
        {fmtPrice(item.week_close_price ?? item.week_open_price)}
      </td>
      {/* Entry: Date | Price/Size */}
      <td className="px-2 py-2.5 text-xs text-ink-muted whitespace-nowrap">{fmtDate(item.buy_date)}</td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="space-y-0.5">
          <div className="text-xs text-ink-secondary tabular-nums">{fmtPrice(item.buy_price)}</div>
          <div className="text-[10px] text-ink-muted tabular-nums">×{fmtSize(item.buy_size)}</div>
        </div>
      </td>
      {/* Week: Mon open / Fri close / Wk% stacked */}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="space-y-0.5 tabular-nums">
          <div className="text-[10px] text-ink-disabled">{fmtPrice(item.week_open_price)}</div>
          <div className="text-[10px] text-ink-secondary">{fmtPrice(item.week_close_price)}</div>
          <PctBadge pct={item.week_change_pct} />
        </div>
      </td>
      <td className="px-2 py-2.5 min-w-[176px]">
        <ReasonInput
          value={item.buy_reason}
          placeholder="Notes on this hold…"
          readOnly={readOnly}
          onSave={v => onPatch(item.id, { buy_reason: v })}
        />
      </td>
      <td className="px-2 py-2.5">
        <FeelingPicker value={item.buy_feeling} readOnly={readOnly} onChange={v => onPatch(item.id, { buy_feeling: v })} />
      </td>
      <td className="px-2 py-2.5">
        {!readOnly && (
          <button onClick={() => onDelete(item.id)} className="btn-icon text-loss/60 hover:text-loss" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Collapsible section wrapper ────────────────────────────────────────────────

function Section({
  title, icon: Icon, iconColor, count, actions, children,
}: {
  title: string
  icon: React.ElementType
  iconColor: string
  count: number
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="card overflow-hidden">
      <div
        className="px-5 py-4 border-b border-border/50 flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <Icon className={cn('w-4 h-4 shrink-0', iconColor)} />
        <h2 className="text-sm font-semibold text-ink-primary flex-1">{title}</h2>
        <span className="text-xs text-ink-muted">({count})</span>
        {actions && <div onClick={e => e.stopPropagation()}>{actions}</div>}
        <ChevronDown className={cn('w-4 h-4 text-ink-muted transition-transform', expanded && 'rotate-180')} />
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
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

// ── Column header helper ───────────────────────────────────────────────────────

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-2 py-2 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap', className)}>
      {children}
    </th>
  )
}

// ── Group header spanning multiple columns ─────────────────────────────────────

function GroupTH({ children, colSpan, className }: { children: string; colSpan: number; className?: string }) {
  return (
    <th
      colSpan={colSpan}
      className={cn('px-2 py-1 text-center text-[9px] font-semibold uppercase tracking-wider border-b border-border/30', className)}
    >
      {children}
    </th>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const { data: review, isLoading, isError } = useQuery<ReviewDetail>({
    queryKey: ['review-detail', id],
    queryFn: () => reviewListService.get(id),
    staleTime: 30_000,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['review-detail', id] })
    queryClient.invalidateQueries({ queryKey: ['review-list'] })
  }, [queryClient, id])

  const patchMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: Parameters<typeof reviewListService.patchItem>[2] }) =>
      reviewListService.patchItem(id, itemId, payload),
    onSuccess: () => invalidate(),
  })

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => reviewListService.deleteItem(id, itemId),
    onSuccess: () => invalidate(),
  })

  const handleSync = async () => {
    setSyncing(true)
    try { await reviewListService.syncFromPortfolio(id); await invalidate() }
    finally { setSyncing(false) }
  }

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    try { await reviewListService.refreshPrices(id); await invalidate() }
    finally { setRefreshing(false) }
  }

  const handlePatch = useCallback(
    (itemId: string, payload: Parameters<typeof reviewListService.patchItem>[2]) => {
      patchMutation.mutate({ itemId, payload })
    },
    [patchMutation],
  )

  const handleDelete = useCallback(
    (itemId: string) => { deleteMutation.mutate(itemId) },
    [deleteMutation],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-ink-muted text-sm">
        <Loader2 className="w-5 h-5 animate-spin" />Loading review…
      </div>
    )
  }

  if (isError || !review) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-loss text-sm">
        <AlertCircle className="w-5 h-5" />Failed to load review.
      </div>
    )
  }

  const today = new Date()
  const weekEnd = new Date(review.week_end)
  const readOnly = weekEnd < today && weekEnd.toDateString() !== today.toDateString()

  const tradeItems = review.trade_items ?? []
  const holdItems  = review.hold_items  ?? []

  // Open-position suggestions not yet tracked in Part 2
  const trackedSymbols = new Set([...tradeItems, ...holdItems].map(i => i.symbol))
  const pendingOpen = (review.open_suggestions ?? []).filter(s => !trackedSymbols.has(s.symbol))

  const addHoldFromSuggestion = async (s: ReviewDetail['open_suggestions'][0]) => {
    await reviewListService.addItem(id, {
      symbol: s.symbol,
      item_type: 'HOLD',
      buy_price: s.entry_price ?? undefined,
      buy_size: s.position_size ?? undefined,
      source_position_id: s.id,
    })
    invalidate()
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <button
          onClick={() => router.push('/action-plan?tab=plans')}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-primary mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Action Plan
        </button>

        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink-primary">{review.name}</h1>
            <p className="text-xs text-ink-muted mt-0.5">
              {format(parseISO(review.week_start), 'dd MMM yyyy')}
              {' '}–{' '}
              {format(parseISO(review.week_end), 'dd MMM yyyy')}
              {readOnly && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated border border-border/50 text-ink-disabled">
                  Read-only
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRefreshPrices}
              disabled={refreshing}
              className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
              title="Fetch Mon open / Fri close prices from Yahoo Finance"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart2 className="w-3.5 h-3.5" />}
              Refresh Prices
            </button>
            {!readOnly && (
              <>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                  title="Sync trades from DB portfolio"
                >
                  {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Sync from Portfolio
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Item
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Feeling legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Feeling:</span>
        {FEELINGS.map(f => {
          const Icon = FEELING_ICONS[f.iconKey]
          return (
            <span key={f.value} className={cn('flex items-center gap-1 text-[11px]', f.color)}>
              <Icon className="w-3 h-3" strokeWidth={2.5} />
              <span>{f.label}</span>
            </span>
          )
        })}
      </div>

      {/* ── Part 1: Trades ── */}
      <Section
        title="Part 1 — Transactions This Week"
        icon={TrendingUp}
        iconColor="text-brand-400"
        count={tradeItems.length}
      >
        {tradeItems.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-muted">
            No trades yet. Use &ldquo;Sync from Portfolio&rdquo; or &ldquo;Add Item&rdquo; to populate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                {/* Group headers */}
                <tr className="border-b border-border/30">
                  <th className="px-3 py-1" colSpan={2} />
                  <GroupTH colSpan={4} className="text-gain/70">Buy</GroupTH>
                  <GroupTH colSpan={4} className="text-loss/70">Sell</GroupTH>
                  <GroupTH colSpan={1} className="text-brand-400/70">Week</GroupTH>
                  <th className="px-2 py-1 w-8" />
                </tr>
                {/* Column headers */}
                <tr className="border-b border-border/40">
                  <TH className="px-3">Symbol</TH>
                  <TH>Price</TH>
                  <TH>Date</TH><TH>P/Size</TH><TH className="min-w-[176px]">Reason</TH><TH>Feel</TH>
                  <TH>Date</TH><TH>P/Size</TH><TH className="min-w-[176px]">Reason</TH><TH>Feel</TH>
                  <TH>Mon/Fri/Wk%</TH>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {tradeItems.map(item => (
                  <TradeItemRow
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                    onPatch={handlePatch}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Part 2: Open positions (hold) ── */}
      <Section
        title="Part 2 — Open Portfolio (not traded this week)"
        icon={Briefcase}
        iconColor="text-purple-400"
        count={holdItems.length}
        actions={
          !readOnly && pendingOpen.length > 0 ? (
            <div className="relative group">
              <button className="btn-ghost text-xs px-2.5 py-1 flex items-center gap-1">
                <Plus className="w-3 h-3" />
                Add open ({pendingOpen.length})
              </button>
              <div className="absolute right-0 top-full mt-1 z-30 hidden group-hover:block min-w-[180px] bg-surface-card border border-border/60 rounded-xl shadow-xl p-1">
                {pendingOpen.map(s => (
                  <button
                    key={s.id}
                    onClick={() => addHoldFromSuggestion(s)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-elevated rounded-lg transition-colors"
                  >
                    <span className="font-mono font-bold text-ink-primary">{s.symbol}</span>
                    {s.entry_price != null && (
                      <span className="text-ink-muted">@ {s.entry_price.toFixed(2)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : undefined
        }
      >
        {holdItems.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-muted">
            No open positions tracked. Use &ldquo;Add open&rdquo; from your portfolio suggestions.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="px-3 py-1" colSpan={2} />
                  <GroupTH colSpan={2} className="text-gain/70">Entry</GroupTH>
                  <GroupTH colSpan={1} className="text-brand-400/70">Week</GroupTH>
                  <th className="px-2 py-1" colSpan={3} />
                </tr>
                <tr className="border-b border-border/40">
                  <TH className="px-3">Symbol</TH>
                  <TH>Price</TH>
                  <TH>Entry Date</TH><TH>P/Size</TH>
                  <TH>Mon/Fri/Wk%</TH>
                  <TH className="min-w-[176px]">Notes</TH><TH>Feel</TH>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {holdItems.map(item => (
                  <HoldItemRow
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                    onPatch={handlePatch}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddItemModal
            reviewId={id}
            onClose={() => setShowAddModal(false)}
            onAdded={invalidate}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
