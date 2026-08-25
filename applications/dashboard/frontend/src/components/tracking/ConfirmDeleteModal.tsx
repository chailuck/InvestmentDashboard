'use client'

import { motion } from 'framer-motion'
import { Loader2, Trash2 } from 'lucide-react'

/**
 * Generic delete-confirmation modal for the tracking hierarchy. Always
 * surfaces a cascade warning when the entity being deleted can have children
 * (Set → Categories, Category → Sub-categories, Sub-category → Items).
 */
export function ConfirmDeleteModal({
  entityLabel,
  entityName,
  cascadeWarning,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  entityLabel: string
  entityName: string
  cascadeWarning?: string
  loading: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-loss/15 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-loss" />
            </div>
            <div>
              <p id="confirm-delete-title" className="text-sm font-semibold text-ink-primary">Delete {entityLabel}?</p>
              <p className="text-xs text-ink-muted mt-1">
                <span className="font-medium text-ink-secondary">{entityName}</span> will be permanently removed.
              </p>
              {cascadeWarning && (
                <p className="text-xs text-amber-400 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
                  {cascadeWarning}
                </p>
              )}
            </div>
          </div>
          {error && (
            <p className="text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-lg bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
