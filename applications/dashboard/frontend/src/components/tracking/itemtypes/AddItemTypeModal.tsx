'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { slugPreview } from './slug'

const MAX_LABEL = 100
const COUNTS_AS_PROPERTY = 'counts_as_property'

/**
 * Add-custom-type modal (§F.2). Label is live-validated for blank / length /
 * case-insensitive duplicate against the existing labels. The only assignable
 * capability offered is `counts_as_property`; `bond_register` is never shown.
 * The generated slug is a read-only preview — the server assigns the real one.
 */
export function AddItemTypeModal({
  existingLabels,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  /** All current type labels (any archive state) — for the duplicate check. */
  existingLabels: string[]
  loading: boolean
  error?: string | null
  onConfirm: (input: { label: string; capabilities: string[] }) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [countsAsProperty, setCountsAsProperty] = useState(false)

  const normalized = label.trim().toLowerCase()
  const dupSet = useMemo(
    () => new Set(existingLabels.map(l => l.trim().toLowerCase())),
    [existingLabels],
  )

  const validationError =
    label.trim().length === 0
      ? 'Label is required.'
      : label.trim().length > MAX_LABEL
      ? `Label must be ${MAX_LABEL} characters or fewer.`
      : dupSet.has(normalized)
      ? 'A type with this label already exists.'
      : null

  const canConfirm = !validationError && !loading
  const slug = slugPreview(label)

  const submit = () => {
    if (!canConfirm) return
    onConfirm({
      label: label.trim(),
      capabilities: countsAsProperty ? [COUNTS_AS_PROPERTY] : [],
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-type-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="add-item-type-title" className="text-sm font-semibold text-ink-primary">Add custom item type</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="add-item-type-label" className="block text-xs text-ink-muted mb-1.5">Label</label>
            <input
              id="add-item-type-label"
              autoFocus
              value={label}
              maxLength={MAX_LABEL + 20}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              aria-invalid={!!validationError}
              aria-describedby="add-item-type-slug add-item-type-error"
              className="input w-full text-sm"
            />
            <p id="add-item-type-slug" className="text-[11px] text-ink-disabled mt-1 font-mono">
              slug: {slug ? slug : <span className="italic font-sans">generated on save</span>}
            </p>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={countsAsProperty}
              onChange={e => setCountsAsProperty(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-border bg-surface-elevated accent-brand-500"
            />
            <span className="text-xs text-ink-secondary">
              Counts as property
              <span className="block text-[11px] text-ink-disabled">
                Items of this type are included in the dashboard Property total and the Analysis Property lens.
              </span>
            </span>
          </label>

          {(validationError || error) && (
            <p id="add-item-type-error" className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">
              {error ?? validationError}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={submit}
              disabled={!canConfirm}
              className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Add type
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
