'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { X, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { actionPlanService } from '@/services/actionPlan'
import { weeklyScanService } from '@/services/weeklyScan'
import { overallPlanService, type OverallPlanGenerateResponse } from '@/services/overallPlan'
import { extractApiError } from '@/services/api'

// ── Props ─────────────────────────────────────────────────────────────────────

interface GenerateOverallPlanModalProps {
  /**
   * The weekly scan id currently open on the page — becomes the default scan
   * selection. Optional: when omitted (e.g. when launched from the Action
   * Plan page rather than a specific scan's page), the fallback effect below
   * defaults the selection to the most recent scan.
   */
  scanId?: string
  onClose: () => void
  /** Called after a successful generate call, with the full server response. */
  onSuccess: (result: OverallPlanGenerateResponse) => void
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Confirmation modal for the "Generate Overall Plan" action on the Weekly Scan
 * detail page. Pure API trigger — no markdown assembly happens client-side,
 * that logic lives entirely on the backend (`POST /overall-plan/generate`).
 *
 * Two dropdowns (purchase action plan, weekly scan) default to the most
 * recent plan and the scan currently open on the page, respectively — or to
 * the most recent scan when no `scanId` is supplied (e.g. when launched from
 * the Action Plan page). The portfolio is resolved automatically
 * server-side, so there is no portfolio picker here.
 */
export function GenerateOverallPlanModal({ scanId, onClose, onSuccess }: GenerateOverallPlanModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [selectedScanId, setSelectedScanId] = useState(scanId ?? '')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  const { data: plans = [], isLoading: plansLoading, isError: plansError } = useQuery({
    queryKey: ['action-plans', 'purchase'],
    queryFn: () => actionPlanService.list('purchase', null),
    staleTime: 30_000,
  })

  const { data: scans = [], isLoading: scansLoading, isError: scansError } = useQuery({
    queryKey: ['weekly-scan-list'],
    queryFn: () => weeklyScanService.listScans(),
    staleTime: 30_000,
  })

  // Default the purchase plan selection to the most recent plan once loaded.
  // The API returns plans newest-first (relied on elsewhere in this app, e.g.
  // Sidebar / ExportAllModal treat index 0 as "latest"); only sort defensively
  // if that assumption ever turns out to be wrong for a given payload.
  useEffect(() => {
    if (selectedPlanId || plans.length === 0) return
    const newestFirst = [...plans].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    setSelectedPlanId(newestFirst[0].id)
  }, [plans, selectedPlanId])

  // If the scan id from the URL isn't among the loaded scans (edge case —
  // e.g. deleted concurrently), fall back to the most recent scan instead.
  // This also covers the case where no scanId prop was supplied at all
  // (selectedScanId starts as '', which never matches a loaded scan id).
  useEffect(() => {
    if (scans.length === 0) return
    if (scans.some(s => s.id === selectedScanId)) return
    const newestFirst = [...scans].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    setSelectedScanId(newestFirst[0].id)
  }, [scans]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = plansLoading || scansLoading
  const noPlans = !plansLoading && plans.length === 0
  const noScans = !scansLoading && scans.length === 0
  const canGenerate = !generating && !!selectedPlanId && !!selectedScanId && !noPlans && !noScans

  const handleClose = () => {
    if (generating) return // don't allow closing mid-request, matches CloneUserModal convention
    onClose()
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerating(true)
    setError(null)
    try {
      const result = await overallPlanService.generate({
        action_plan_id: selectedPlanId,
        weekly_scan_id: selectedScanId,
      })
      toast.success(`Overall plan generated — ${result.filename}`)
      onSuccess(result)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setGenerating(false)
    }
  }

  // ── Accessibility: focus trap + Escape-to-close ──────────────────────────────

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
        .filter(el => !el.hasAttribute('disabled'))

    // Focus the first focusable element on mount.
    focusables()[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
        return
      }
      if (e.key !== 'Tab') return

      const els = focusables()
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating])

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-overall-plan-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 id="generate-overall-plan-title" className="text-sm font-semibold text-ink-primary flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-400" />
            Generate Overall Plan
          </h2>
          <button onClick={handleClose} className="btn-icon" aria-label="Close" disabled={generating}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-ink-muted">
            Combines a purchase action plan with a weekly scan into one Overall Plan document.
            The portfolio is selected automatically — no need to choose one here.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-ink-muted text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading options…
            </div>
          ) : (plansError || scansError) ? (
            <div className="flex items-start gap-2 text-loss text-xs px-3 py-2.5 rounded-lg bg-loss/10 border border-loss/20">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Failed to load plans or scans. Please close and try again.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="overall-plan-purchase-plan" className="block text-xs font-medium text-ink-secondary mb-1.5">
                  Purchase Action Plan
                </label>
                {noPlans ? (
                  <p className="text-xs text-ink-muted">No purchase plans found. Create one first.</p>
                ) : (
                  <select
                    id="overall-plan-purchase-plan"
                    className="input w-full text-sm"
                    value={selectedPlanId}
                    onChange={e => setSelectedPlanId(e.target.value)}
                    disabled={generating}
                  >
                    {plans.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label htmlFor="overall-plan-weekly-scan" className="block text-xs font-medium text-ink-secondary mb-1.5">
                  Weekly Scan
                </label>
                {noScans ? (
                  <p className="text-xs text-ink-muted">No weekly scans found.</p>
                ) : (
                  <select
                    id="overall-plan-weekly-scan"
                    className="input w-full text-sm"
                    value={selectedScanId}
                    onChange={e => setSelectedScanId(e.target.value)}
                    disabled={generating}
                  >
                    {scans.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-loss text-xs px-3 py-2.5 rounded-lg bg-loss/10 border border-loss/20">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end px-5 py-3 border-t border-border/40 bg-surface-elevated/30">
          <button onClick={handleClose} disabled={generating} className="btn-ghost text-sm px-4 py-1.5 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="btn-primary text-sm px-4 py-1.5 flex items-center gap-2 disabled:opacity-50"
          >
            {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Generate
          </button>
        </div>
      </motion.div>
    </div>
  )
}
