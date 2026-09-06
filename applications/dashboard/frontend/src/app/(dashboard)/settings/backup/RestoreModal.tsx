'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api'
import type { BackupResult } from './page'

/**
 * What the restore is being run against — either a backup file already stored
 * server-side, or a file the admin just picked from their machine.
 */
export type RestoreTarget =
  | { kind: 'file'; filename: string }
  | { kind: 'upload'; file: File }

type RestoreMode = 'skip_if_conflict' | 'replace_all'

/** The exact phrase an admin must type to unlock a destructive replace-all restore. */
const REPLACE_PHRASE = 'REPLACE ALL DATA'

interface ConflictInfo {
  detail: string
  conflicting_tables: { table: string; row_count: number }[]
}

function toNum(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Confirmation modal for a database restore. Replaces the previous blind
 * `window.confirm(...)` calls with an explicit, accessible dialog that:
 *  - forces a choice between a safe (skip-if-conflict) and a destructive
 *    (replace-all) restore, defaulting to safe;
 *  - for replace-all, shows exactly which tables/rows will be wiped and
 *    requires the admin to type `REPLACE ALL DATA` verbatim;
 *  - surfaces the backend's RFC 7807 409 payload (conflicting tables + hint)
 *    inline so the admin can adjust the mode without losing context.
 */
export function RestoreModal({
  target,
  wipeTables,
  onClose,
  onSuccess,
}: {
  target: RestoreTarget
  /** Populated tables in the backend conflict set — shown as the wipe preview for replace-all. */
  wipeTables: { name: string; row_count: number }[]
  onClose: () => void
  onSuccess: (result: BackupResult) => void
}) {
  const [mode, setMode] = useState<RestoreMode>('skip_if_conflict')
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)

  const sourceName = target.kind === 'file' ? target.filename : target.file.name
  const canConfirm =
    !submitting && (mode === 'skip_if_conflict' || confirmText === REPLACE_PHRASE)

  // Escape-to-close, matching the other tracking modals' keyboard behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!canConfirm) return
    setSubmitting(true)
    setErrorMsg(null)
    setConflict(null)
    try {
      const confirmValue = mode === 'replace_all' ? REPLACE_PHRASE : undefined
      let data: BackupResult
      if (target.kind === 'file') {
        const res = await apiClient.post(`/backup/restore/${target.filename}`, {
          mode,
          confirm: confirmValue,
        })
        data = res.data
      } else {
        const form = new FormData()
        form.append('file', target.file)
        // The upload route takes mode/confirm as QUERY params, not form fields.
        let url = `/backup/restore/upload?mode=${mode}`
        if (confirmValue) url += `&confirm=${encodeURIComponent(confirmValue)}`
        const res = await apiClient.post(url, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        data = res.data
      }
      onSuccess(data)
    } catch (e: any) {
      const status = e?.response?.status
      const body = e?.response?.data
      if (status === 409 && body) {
        setConflict({
          detail: body.detail ?? 'Some target tables already contain data.',
          conflicting_tables: Array.isArray(body.conflicting_tables) ? body.conflicting_tables : [],
        })
      } else {
        setErrorMsg(body?.detail ?? 'Restore failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="restore-modal-title" className="text-sm font-semibold text-ink-primary">
            Restore database
          </h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <p className="text-ink-muted">
            Restoring from{' '}
            <span className="font-mono text-ink-secondary break-all">{sourceName}</span>
          </p>

          <fieldset className="space-y-2">
            <legend className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
              Restore mode
            </legend>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="restore-mode"
                value="skip_if_conflict"
                checked={mode === 'skip_if_conflict'}
                onChange={() => setMode('skip_if_conflict')}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-ink-primary">
                  Safe restore — only into empty tables
                </span>
                <span className="block text-ink-muted">
                  Tables that already contain data are left untouched.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="restore-mode"
                value="replace_all"
                checked={mode === 'replace_all'}
                onChange={() => setMode('replace_all')}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-loss">Replace all data (destructive)</span>
                <span className="block text-ink-muted">
                  Every covered table is wiped and reloaded from the backup.
                </span>
              </span>
            </label>
          </fieldset>

          {mode === 'replace_all' && (
            <div className="rounded-xl border border-loss/30 bg-loss/5 p-3 space-y-2">
              <p className="flex items-center gap-1.5 font-semibold text-loss">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                The following data will be permanently deleted
              </p>
              {wipeTables.length > 0 ? (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink-muted">
                  {wipeTables.map(t => (
                    <li key={t.name}>
                      {t.name}: <strong className="text-ink-secondary">{toNum(t.row_count)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-muted">No populated tables detected in the conflict set.</p>
              )}
              <div className="space-y-1 pt-1">
                <label htmlFor="restore-confirm-text" className="block text-ink-secondary">
                  Type <span className="font-mono text-loss">{REPLACE_PHRASE}</span> to confirm
                </label>
                <input
                  id="restore-confirm-text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  autoComplete="off"
                  className="input w-full text-xs"
                />
              </div>
            </div>
          )}

          {conflict && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 space-y-2">
              <p className="font-semibold text-amber-400">{conflict.detail}</p>
              {conflict.conflicting_tables.length > 0 && (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-amber-300">
                  {conflict.conflicting_tables.map(t => (
                    <li key={t.table}>
                      {t.table}: <strong>{toNum(t.row_count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-ink-muted">
                These tables already contain data. Switch to Replace all data, or restore into a
                fresh database.
              </p>
            </div>
          )}

          {errorMsg && (
            <p className="text-loss px-3 py-2 rounded-lg bg-loss/10 border border-loss/20">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canConfirm}
              className={cn(
                'text-sm px-4 py-1.5 rounded-lg border flex items-center gap-2 transition-colors disabled:opacity-50',
                mode === 'replace_all'
                  ? 'bg-loss/15 text-loss border-loss/30 hover:bg-loss/25'
                  : 'bg-brand-500 text-white border-brand-500 hover:bg-brand-600',
              )}
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {mode === 'replace_all' ? 'Replace all data' : 'Restore'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
