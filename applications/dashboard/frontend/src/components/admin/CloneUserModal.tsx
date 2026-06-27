'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react'
import {
  usersService,
  type ClonePreflightResponse,
  type CloneExecuteResponse,
  type TableCounts,
} from '@/services/users'
import { extractApiError } from '@/services/api'
import type { UserDetail } from '@/types'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABLE_LABELS: Record<keyof TableCounts, string> = {
  portfolios: 'Portfolios',
  holdings: 'Holdings',
  investment_transactions: 'Transactions',
  portfolio_positions_db: 'DB Positions',
  action_plans: 'Action Plans',
  purchase_plan_items: 'Purchase Items',
  portfolio_plan_items: 'Portfolio Items',
  user_scan_configs: 'Scan Configs',
  user_symbol_lists: 'Symbol Lists',
  weekly_scans: 'Weekly Scans',
  weekly_scan_items: 'Scan Items',
  pe_scan_results: 'PE Results',
  symbol_notes: 'Symbol Notes',
  weekly_reviews: 'Weekly Reviews',
  weekly_review_items: 'Review Items',
}

const TABLE_KEYS = Object.keys(TABLE_LABELS) as Array<keyof TableCounts>

type PortfolioModeOption = 'inherit' | 'db' | 'excel'

type Phase = 'select' | 'preflight' | 'confirm' | 'executing' | 'result'

function sumCounts(counts: TableCounts): number {
  return TABLE_KEYS.reduce((acc, key) => acc + counts[key], 0)
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CloneModalProps {
  sourceUser: UserDetail
  allUsers: UserDetail[]
  onClose: () => void
  onSuccess: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CloneUserModal({
  sourceUser,
  allUsers,
  onClose,
  onSuccess,
}: CloneModalProps) {
  // Phase management
  const [phase, setPhase] = useState<Phase>('select')

  // Select phase state
  const [targetUserId, setTargetUserId] = useState('')
  const [portfolioMode, setPortfolioMode] = useState<PortfolioModeOption>('inherit')
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState('')

  // Preflight result
  const [preflight, setPreflight] = useState<ClonePreflightResponse | null>(null)

  // Result phase state
  const [cloneResult, setCloneResult] = useState<CloneExecuteResponse | null>(null)
  const [cloneError, setCloneError] = useState('')

  // Derived values
  const targetUsers = allUsers.filter((u) => u.id !== sourceUser.id)
  const selectedTarget = allUsers.find((u) => u.id === targetUserId) ?? null

  const resolvedPortfolioModeOverride: 'excel' | 'db' | null =
    portfolioMode === 'inherit' ? null : portfolioMode

  const resolvedPortfolioModeLabel =
    portfolioMode === 'inherit'
      ? preflight
        ? `Inherit from source (${preflight.source_user_name})`
        : 'Inherit from source'
      : portfolioMode === 'db'
        ? 'Database (db)'
        : 'Excel (excel)'

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePreflight() {
    if (!targetUserId) return
    setPreflightError('')
    setPreflightLoading(true)
    try {
      const result = await usersService.clonePreflight(sourceUser.id, targetUserId)
      setPreflight(result)
      setPhase('preflight')
    } catch (err) {
      setPreflightError(extractApiError(err))
    } finally {
      setPreflightLoading(false)
    }
  }

  async function handleExecute() {
    if (!preflight) return
    setPhase('executing')
    setCloneError('')
    try {
      const result = await usersService.cloneExecute(
        sourceUser.id,
        preflight.target_user_id,
        resolvedPortfolioModeOverride,
      )
      setCloneResult(result)
      setPhase('result')
      onSuccess()
    } catch (err) {
      setCloneError(extractApiError(err))
      setPhase('result')
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────────

  function renderSelect() {
    return (
      <>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">Clone User Data</h2>
            <p className="text-sm text-ink-muted mt-0.5">
              Copy all data from{' '}
              <span className="text-ink-secondary font-medium">{sourceUser.name}</span> to
              another user.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {preflightError && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {preflightError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="clone-target-user"
              className="block text-xs font-medium text-ink-secondary mb-1.5"
            >
              Target User
            </label>
            <select
              id="clone-target-user"
              className="input w-full"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {targetUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="clone-portfolio-mode"
              className="block text-xs font-medium text-ink-secondary mb-1.5"
            >
              Portfolio Mode
            </label>
            <select
              id="clone-portfolio-mode"
              className="input w-full"
              value={portfolioMode}
              onChange={(e) => setPortfolioMode(e.target.value as PortfolioModeOption)}
            >
              <option value="inherit">Inherit from source</option>
              <option value="db">Database (db)</option>
              <option value="excel">Excel (excel)</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePreflight}
            disabled={!targetUserId || preflightLoading}
            className="btn-primary flex-1 py-2 text-sm"
          >
            {preflightLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mx-auto" />
            ) : (
              'Check Target'
            )}
          </button>
        </div>
      </>
    )
  }

  function renderPreflight() {
    if (!preflight) return null
    const sourceTotal = sumCounts(preflight.source_counts)
    const targetTotal = sumCounts(preflight.target_existing_counts)

    return (
      <>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-ink-primary">Preflight Check</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Clone from{' '}
          <span className="text-ink-secondary font-medium">{preflight.source_user_name}</span>{' '}
          to{' '}
          <span className="text-ink-secondary font-medium">{preflight.target_user_name}</span>
        </p>

        {preflight.target_has_data && (
          <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Target user already has data. Clone will{' '}
              <strong>APPEND</strong> to existing records — no existing data will be
              deleted.
            </span>
          </div>
        )}

        {/* Comparison table */}
        <div className="overflow-auto rounded-lg border border-border/50 mb-5 max-h-72">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-surface-elevated/50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Category
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Source
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Target (existing)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {TABLE_KEYS.map((key) => {
                const srcCount = preflight.source_counts[key]
                const tgtCount = preflight.target_existing_counts[key]
                const isMuted = srcCount === 0
                const isTargetWarning = tgtCount > 0

                return (
                  <tr
                    key={key}
                    className={cn(
                      'transition-colors',
                      isMuted ? 'opacity-40' : 'hover:bg-surface-elevated/40',
                    )}
                  >
                    <td
                      className={cn(
                        'px-3 py-1.5',
                        isMuted ? 'text-ink-muted' : 'text-ink-secondary',
                      )}
                    >
                      {TABLE_LABELS[key]}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-right tabular-nums',
                        isMuted ? 'text-ink-muted' : 'text-ink-primary font-medium',
                      )}
                    >
                      {srcCount.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-right tabular-nums',
                        isTargetWarning
                          ? 'text-amber-400 font-medium'
                          : isMuted
                            ? 'text-ink-muted'
                            : 'text-ink-secondary',
                      )}
                    >
                      {tgtCount.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-border/50 bg-surface-elevated/50">
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink-primary">
                  {sourceTotal.toLocaleString()}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums font-semibold',
                    targetTotal > 0 ? 'text-amber-400' : 'text-ink-secondary',
                  )}
                >
                  {targetTotal.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase('select')}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setPhase('confirm')}
            className="btn-primary flex-1 py-2 text-sm"
          >
            Proceed with Clone
          </button>
        </div>
      </>
    )
  }

  function renderConfirm() {
    if (!preflight) return null
    const sourceTotal = sumCounts(preflight.source_counts)

    return (
      <>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-ink-primary">Confirm Clone</h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary card */}
        <div className="rounded-lg border border-border/50 bg-surface-elevated/40 p-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">From</span>
            <span className="text-ink-primary font-medium">{preflight.source_user_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">To</span>
            <span className="text-ink-primary font-medium">{preflight.target_user_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Portfolio Mode</span>
            <span className="text-ink-secondary">{resolvedPortfolioModeLabel}</span>
          </div>
          <div className="flex justify-between border-t border-border/40 pt-2 mt-2">
            <span className="text-ink-muted font-medium">Total rows to clone</span>
            <span className="text-ink-primary font-semibold tabular-nums">
              {sourceTotal.toLocaleString()}
            </span>
          </div>
        </div>

        {preflight.target_has_data && (
          <p className="text-loss text-sm mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Warning: Target already has data. This will append additional records.
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecute}
            className="flex-1 py-2 text-sm rounded-lg bg-loss hover:bg-loss/90 text-white font-medium transition-colors"
          >
            Confirm Clone
          </button>
        </div>
      </>
    )
  }

  function renderExecuting() {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-brand-400" />
        <p className="text-sm text-ink-muted">Cloning data, please wait...</p>
      </div>
    )
  }

  function renderResult() {
    const isSuccess = cloneResult !== null

    if (isSuccess) {
      const totalCloned = cloneResult.total_rows_cloned

      return (
        <>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-gain shrink-0" />
              <h2 className="text-lg font-semibold text-ink-primary">Clone Complete</h2>
            </div>
            <button onClick={onClose} className="btn-icon" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-ink-muted mb-4">
            Cloned from{' '}
            <span className="text-ink-secondary font-medium">{cloneResult.source_user_name}</span>{' '}
            to{' '}
            <span className="text-ink-secondary font-medium">{cloneResult.target_user_name}</span>
          </p>

          <div className="overflow-auto rounded-lg border border-border/50 mb-5 max-h-72">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-surface-elevated/50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Rows Cloned
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {TABLE_KEYS.map((key) => {
                  const count = cloneResult.rows_cloned[key]
                  const isMuted = count === 0
                  return (
                    <tr
                      key={key}
                      className={cn(
                        'transition-colors',
                        isMuted ? 'opacity-40' : 'hover:bg-surface-elevated/40',
                      )}
                    >
                      <td
                        className={cn(
                          'px-3 py-1.5',
                          isMuted ? 'text-ink-muted' : 'text-ink-secondary',
                        )}
                      >
                        {TABLE_LABELS[key]}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right tabular-nums',
                          isMuted ? 'text-ink-muted' : 'text-gain font-medium',
                        )}
                      >
                        {count.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t border-border/50 bg-surface-elevated/50">
                <tr>
                  <td className="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gain">
                    {totalCloned.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-primary w-full py-2 text-sm"
          >
            Close
          </button>
        </>
      )
    }

    // Error result
    return (
      <>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-loss shrink-0" />
            <h2 className="text-lg font-semibold text-ink-primary">Clone Failed</h2>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-2 p-3 mb-5 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{cloneError || 'An unexpected error occurred. Please try again.'}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg border border-border text-ink-secondary text-sm hover:bg-surface-elevated transition-colors"
        >
          Close
        </button>
      </>
    )
  }

  // ── Layout ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60"
        onClick={phase === 'executing' ? undefined : onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative card p-6 w-full max-w-lg z-10"
        role="dialog"
        aria-modal="true"
        aria-label="Clone User Data"
      >
        {phase === 'select' && renderSelect()}
        {phase === 'preflight' && renderPreflight()}
        {phase === 'confirm' && renderConfirm()}
        {phase === 'executing' && renderExecuting()}
        {phase === 'result' && renderResult()}
      </motion.div>
    </div>
  )
}
