'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import {
  Plus, Pencil, Trash2, Save, X, Loader2, ChevronDown,
  TrendingUp, TrendingDown, SlidersHorizontal, Wallet,
  ArrowDownToLine, ArrowUpFromLine, RefreshCcw, Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  portfolioService,
  type UserPortfolio,
} from '@/services/portfolio'
import {
  investmentTransactionService,
  type InvestmentTransaction,
  type InvestmentAction,
  INVESTMENT_ACTIONS,
} from '@/services/investmentTransaction'

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayIso = () => format(new Date(), 'yyyy-MM-dd')

function actionMeta(action: InvestmentAction) {
  return INVESTMENT_ACTIONS.find(a => a.value === action)!
}

function ActionBadge({ action }: { action: InvestmentAction }) {
  const meta = actionMeta(action)
  const Icon = action === 'CASH_IN' ? ArrowDownToLine : action === 'CASH_OUT' ? ArrowUpFromLine : RefreshCcw
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
      action === 'CASH_IN'  && 'bg-gain/10 text-gain border-gain/20',
      action === 'CASH_OUT' && 'bg-loss/10 text-loss border-loss/20',
      action === 'ADJUST'   && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    )}>
      <Icon className="w-2.5 h-2.5" />
      {meta.label}
    </span>
  )
}

// ── Portfolio Dropdown ────────────────────────────────────────────────────────

function PortfolioDropdown({
  portfolios,
  selected,
  onChange,
}: {
  portfolios: UserPortfolio[]
  selected: string | null
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = portfolios.find(p => p.id === selected) ?? portfolios.find(p => p.is_default) ?? portfolios[0]
  if (!current) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-elevated
                   text-sm font-medium text-ink-primary hover:border-brand-500/50 transition-colors"
      >
        <Wallet className="w-3.5 h-3.5 text-brand-400" />
        {current.name}
        {current.is_default && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/15 text-brand-400 font-bold">DEFAULT</span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full mt-1 min-w-[180px] bg-surface-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            onMouseLeave={() => setOpen(false)}
          >
            {portfolios.map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-surface-elevated transition-colors',
                  p.id === current.id && 'bg-brand-500/8 text-brand-400',
                )}
              >
                {p.name}
                {p.is_default && <span className="ml-auto text-[9px] text-brand-400 font-bold">DEFAULT</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Transaction Form ──────────────────────────────────────────────────────────

interface TxFormProps {
  portfolioId: string
  initial?: InvestmentTransaction | null
  onClose: () => void
  onSaved: () => void
}

function TransactionForm({ portfolioId, initial, onClose, onSaved }: TxFormProps) {
  const [date, setDate]       = useState(initial?.date ?? todayIso())
  const [action, setAction]   = useState<InvestmentAction>(initial?.action ?? 'CASH_IN')
  const [amount, setAmount]   = useState(initial ? String(initial.amount) : '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'THB')
  const [note, setNote]       = useState(initial?.note ?? '')
  const [saving, setSaving]   = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { toast.error('Amount must be a positive number'); return }
    setSaving(true)
    try {
      if (initial) {
        await investmentTransactionService.update(initial.id, {
          date, action, amount: amt, currency, note: note || null,
        })
        toast.success('Transaction updated')
      } else {
        await investmentTransactionService.create({
          portfolio_id: portfolioId, date, action, amount: amt, currency, note: note || null,
        })
        toast.success('Transaction created')
      }
      onSaved()
    } catch {
      toast.error('Failed to save transaction')
    } finally { setSaving(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="card p-5 border border-brand-500/20 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">
          {initial ? 'Edit Transaction' : 'New Transaction'}
        </h3>
        <button onClick={onClose} className="text-ink-muted hover:text-ink-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Date */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Date</label>
            <input
              type="date"
              className="input text-sm w-full"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
            />
          </div>

          {/* Action */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Action</label>
            <div className="flex gap-1">
              {INVESTMENT_ACTIONS.map(a => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAction(a.value)}
                  className={cn(
                    'flex-1 py-2 text-[11px] font-medium rounded-lg border transition-colors',
                    action === a.value
                      ? a.value === 'CASH_IN'  ? 'bg-gain/15 text-gain border-gain/30'
                        : a.value === 'CASH_OUT' ? 'bg-loss/15 text-loss border-loss/30'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      : 'border-border text-ink-muted hover:text-ink-primary',
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* Amount */}
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input text-sm w-full"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          {/* Currency */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-secondary">Currency</label>
            <select
              className="input text-sm w-full"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
            >
              {['THB', 'USD', 'HKD', 'BTC'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-secondary">Note <span className="text-ink-disabled">(optional)</span></label>
          <input
            className="input text-sm w-full"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Monthly contribution"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-sm text-ink-muted border border-border rounded-lg hover:text-ink-primary transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="btn-primary flex items-center gap-2 px-4 py-1.5 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {initial ? 'Update' : 'Add'}
          </button>
        </div>
      </form>
    </motion.div>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryBar({
  totalCashIn, totalCashOut, totalAdjust, netInvestment,
}: {
  totalCashIn: number; totalCashOut: number; totalAdjust: number; netInvestment: number
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Cash In',       value: totalCashIn,    icon: ArrowDownToLine, color: 'text-gain',     bg: 'bg-gain/8 border-gain/20' },
        { label: 'Cash Out',      value: totalCashOut,   icon: ArrowUpFromLine, color: 'text-loss',     bg: 'bg-loss/8 border-loss/20' },
        { label: 'Adjustments',   value: totalAdjust,    icon: RefreshCcw,      color: 'text-amber-400',bg: 'bg-amber-500/8 border-amber-500/20' },
        { label: 'Net Investment',value: netInvestment,  icon: Wallet,          color: netInvestment >= 0 ? 'text-brand-400' : 'text-loss', bg: 'bg-brand-500/8 border-brand-500/20' },
      ].map(({ label, value, icon: Icon, color, bg }) => (
        <div key={label} className={cn('card p-4 border', bg)}>
          <div className="flex items-center gap-2 mb-2">
            <Icon className={cn('w-3.5 h-3.5', color)} />
            <span className="text-[11px] text-ink-muted">{label}</span>
          </div>
          <p className={cn('text-lg font-bold font-mono', color)}>{fmt(value)}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvestmentsPage() {
  const queryClient = useQueryClient()
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTx, setEditTx] = useState<InvestmentTransaction | null>(null)
  const [filterAction, setFilterAction] = useState<InvestmentAction | ''>('')
  const [deleting, setDeleting] = useState<string | null>(null)

  // Load portfolios
  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: ['portfolios'],
    queryFn: portfolioService.list,
  })

  // Auto-select default portfolio
  useEffect(() => {
    if (!selectedPortfolioId && portfolios.length > 0) {
      const def = portfolios.find(p => p.is_default) ?? portfolios[0]
      setSelectedPortfolioId(def.id)
    }
  }, [portfolios, selectedPortfolioId])

  const activePortfolioId = selectedPortfolioId
    ?? portfolios.find(p => p.is_default)?.id
    ?? portfolios[0]?.id

  // Load transactions
  const { data: txData, isLoading: loadingTx } = useQuery({
    queryKey: ['investment-transactions', activePortfolioId, filterAction],
    queryFn: () => investmentTransactionService.list({
      portfolio_id: activePortfolioId,
      action: filterAction || undefined,
    }),
    enabled: !!activePortfolioId,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['investment-transactions'] })
    setShowForm(false)
    setEditTx(null)
  }, [queryClient])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    setDeleting(id)
    try {
      await investmentTransactionService.delete(id)
      toast.success('Transaction deleted')
      invalidate()
    } catch {
      toast.error('Failed to delete')
    } finally { setDeleting(null) }
  }

  const transactions = txData?.transactions ?? []
  const summary = txData?.summary

  if (loadingPortfolios) {
    return (
      <div className="p-6 flex items-center gap-3 text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary flex items-center gap-2.5">
            <Wallet className="w-6 h-6 text-brand-400" />
            Investments
          </h1>
          <p className="text-ink-muted text-sm mt-0.5">Track cash flows per portfolio</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {portfolios.length > 0 && (
            <PortfolioDropdown
              portfolios={portfolios}
              selected={activePortfolioId ?? null}
              onChange={setSelectedPortfolioId}
            />
          )}
          <button
            onClick={() => { setEditTx(null); setShowForm(s => !s) }}
            className="btn-primary flex items-center gap-1.5 px-4 py-1.5 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        </div>
      </div>

      {/* New / Edit Form */}
      <AnimatePresence>
        {(showForm || editTx) && activePortfolioId && (
          <TransactionForm
            key={editTx?.id ?? 'new'}
            portfolioId={activePortfolioId}
            initial={editTx}
            onClose={() => { setShowForm(false); setEditTx(null) }}
            onSaved={invalidate}
          />
        )}
      </AnimatePresence>

      {/* Summary */}
      {summary && (
        <SummaryBar
          totalCashIn={summary.total_cash_in}
          totalCashOut={summary.total_cash_out}
          totalAdjust={summary.total_adjust}
          netInvestment={summary.net_investment}
        />
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-ink-muted" />
        <span className="text-xs text-ink-muted">Filter:</span>
        {(['', 'CASH_IN', 'CASH_OUT', 'ADJUST'] as const).map(a => (
          <button
            key={a}
            onClick={() => setFilterAction(a)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-lg border transition-colors',
              filterAction === a
                ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                : 'border-border text-ink-muted hover:text-ink-primary',
            )}
          >
            {a === '' ? 'All' : INVESTMENT_ACTIONS.find(x => x.value === a)?.label ?? a}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <div className="card overflow-hidden">
        {loadingTx ? (
          <div className="p-8 flex items-center justify-center gap-2 text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading transactions…
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No transactions yet.{' '}
            <button onClick={() => setShowForm(true)} className="text-brand-400 hover:underline">
              Add your first one.
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs text-ink-muted">
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">Currency</th>
                <th className="text-left px-4 py-3 font-medium">Note</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {transactions.map(tx => (
                <motion.tr
                  key={tx.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hover:bg-surface-elevated/40 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{tx.date}</td>
                  <td className="px-4 py-3"><ActionBadge action={tx.action} /></td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono font-semibold',
                    tx.action === 'CASH_IN' ? 'text-gain' : tx.action === 'CASH_OUT' ? 'text-loss' : 'text-amber-400',
                  )}>
                    {fmt(tx.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{tx.currency}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted max-w-[200px] truncate">
                    {tx.note ?? <span className="text-ink-disabled">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => { setEditTx(tx); setShowForm(false) }}
                        className="p-1.5 rounded text-ink-disabled hover:text-brand-400 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(tx.id)}
                        disabled={deleting === tx.id}
                        className="p-1.5 rounded text-ink-disabled hover:text-loss transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        {deleting === tx.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Count */}
      {transactions.length > 0 && (
        <p className="text-xs text-ink-disabled text-right">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</p>
      )}
    </div>
  )
}
