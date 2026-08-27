'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { format } from 'date-fns'

const todayIso = () => format(new Date(), 'yyyy-MM-dd')

/**
 * Create-modal for a new Update Tracking List: a Transaction Date (required,
 * defaults to today), an optional Quarter (Q1-Q4), and an optional Year.
 * Quarter and year are independently settable/clearable fields (not a single
 * free-text label) matching the `quarter`/`year` shape on
 * `UpdateTrackingListInput` — see the `formatQuarterYear` helper on the
 * `[listId]` detail page for how these are later rendered as a combined
 * "Q3 2026"-style string. Kept as its own small component rather than
 * adapting NameDescriptionModal, whose name+description shape doesn't fit
 * these fields and is shared by the Category page — changing it risks that
 * page's behavior.
 */
export function CreateUpdateListModal({
  loading,
  error,
  onConfirm,
  onClose,
}: {
  loading: boolean
  error?: string | null
  onConfirm: (transactionDate: string, quarter: number | null, year: number | null) => void
  onClose: () => void
}) {
  const [transactionDate, setTransactionDate] = useState(todayIso())
  const [quarter, setQuarter] = useState<number | null>(null)
  const [year, setYear] = useState<number | null>(null)

  const canConfirm = transactionDate.trim().length > 0 && !loading

  const submit = () => {
    if (!canConfirm) return
    onConfirm(transactionDate, quarter, year)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-update-list-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="create-update-list-title" className="text-sm font-semibold text-ink-primary">New Update List</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="create-update-list-date" className="block text-xs text-ink-muted mb-1.5">
              Transaction Date
            </label>
            <input
              id="create-update-list-date"
              type="date"
              autoFocus
              value={transactionDate}
              onChange={e => setTransactionDate(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="input w-full text-sm"
              required
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="create-update-list-quarter" className="block text-xs text-ink-muted mb-1.5">
                Quarter (optional)
              </label>
              <select
                id="create-update-list-quarter"
                value={quarter ?? ''}
                onChange={e => setQuarter(e.target.value === '' ? null : Number(e.target.value))}
                className="input w-full text-sm"
              >
                <option value="">—</option>
                <option value="1">Q1</option>
                <option value="2">Q2</option>
                <option value="3">Q3</option>
                <option value="4">Q4</option>
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="create-update-list-year" className="block text-xs text-ink-muted mb-1.5">
                Year (optional)
              </label>
              <input
                id="create-update-list-year"
                type="number"
                value={year ?? ''}
                onChange={e => setYear(e.target.value === '' ? null : Number(e.target.value))}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="e.g. 2026"
                className="input w-full text-sm"
              />
            </div>
          </div>
          {error && (
            <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={submit}
              disabled={!canConfirm}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
