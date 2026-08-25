'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'

/**
 * Generic create/rename modal for entities that only need a name + optional
 * description: Tracking Set, Category, Sub-category, and Tracking Item rename.
 * Mirrors the NameModal pattern used on the Action Plan page.
 */
export function NameDescriptionModal({
  title,
  nameLabel = 'Name',
  initialName = '',
  initialDescription = '',
  loading,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  nameLabel?: string
  initialName?: string
  initialDescription?: string
  loading: boolean
  error?: string | null
  onConfirm: (name: string, description: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)

  const trimmed = name.trim()
  const canConfirm = trimmed.length > 0 && !loading

  const submit = () => {
    if (!canConfirm) return
    onConfirm(trimmed, description.trim())
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
        aria-labelledby="name-desc-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="name-desc-modal-title" className="text-sm font-semibold text-ink-primary">{title}</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="name-desc-modal-name" className="block text-xs text-ink-muted mb-1.5">{nameLabel}</label>
            <input
              id="name-desc-modal-name"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="input w-full text-sm"
            />
          </div>
          <div>
            <label htmlFor="name-desc-modal-description" className="block text-xs text-ink-muted mb-1.5">Description (optional)</label>
            <textarea
              id="name-desc-modal-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="input w-full text-sm resize-none"
            />
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
              Confirm
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
