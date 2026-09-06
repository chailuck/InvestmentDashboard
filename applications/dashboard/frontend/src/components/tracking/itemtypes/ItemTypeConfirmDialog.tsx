'use client'

import { motion } from 'framer-motion'
import { X, Loader2, AlertCircle } from 'lucide-react'

/**
 * Shared confirm dialog for the archive / unarchive / delete flows on the
 * Item Types admin screen. Keeps the body copy at the call site so each flow
 * can state its own consequences (assigned-item count, "totals unaffected",
 * "can't be undone", …).
 */
export function ItemTypeConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  destructive?: boolean
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
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="item-type-confirm-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="item-type-confirm-title" className="text-sm font-semibold text-ink-primary">{title}</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-xs text-ink-secondary leading-relaxed">{body}</div>
          {error && (
            <p className="flex items-center gap-2 text-xs text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={
                destructive
                  ? 'text-sm px-4 py-1.5 rounded-lg bg-loss text-white hover:bg-loss/90 disabled:opacity-50 flex items-center gap-2'
                  : 'btn-primary text-sm px-4 py-1.5 flex items-center gap-2'
              }
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
