'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { TRACKING_ITEM_TYPES, type TrackingItemType } from '@/services/tracking'

/**
 * Minimal item-creation modal: only Name + Type are required up front.
 * The remaining fields (Initial Investment Tracking, Exclusive, description,
 * account name, remark) are edited afterwards on the item detail page.
 */
export function CreateItemModal({
  loading,
  error,
  onConfirm,
  onClose,
}: {
  loading: boolean
  error?: string | null
  onConfirm: (name: string, type: TrackingItemType) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<TrackingItemType>(TRACKING_ITEM_TYPES[0])

  const trimmed = name.trim()
  const canConfirm = trimmed.length > 0 && !loading

  const submit = () => {
    if (!canConfirm) return
    onConfirm(trimmed, type)
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
        aria-labelledby="create-item-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="create-item-modal-title" className="text-sm font-semibold text-ink-primary">New Tracking Item</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="create-item-name" className="block text-xs text-ink-muted mb-1.5">Item name</label>
            <input
              id="create-item-name"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="input w-full text-sm"
            />
          </div>
          <div>
            <label htmlFor="create-item-type" className="block text-xs text-ink-muted mb-1.5">Type</label>
            <select
              id="create-item-type"
              value={type}
              onChange={e => setType(e.target.value as TrackingItemType)}
              className="input w-full text-sm"
            >
              {TRACKING_ITEM_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-ink-disabled">
            You can set Initial Investment Tracking, Exclusive, description, account name and remark
            after creating the item, from its detail page.
          </p>
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
