'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ClipboardList, Plus, Edit2, Trash2, Copy, X, Loader2,
  ShoppingCart, Briefcase, AlertCircle, ScanLine, LayoutDashboard,
  BookOpen, TrendingUp, ChevronRight, ArrowRight, CalendarDays,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { actionPlanService, type PlanSummary, type PlanType, type ViewMonths } from '@/services/actionPlan'
import { weeklyScanService, COLOR_MARKS, type ScanListSummary } from '@/services/weeklyScan'
import { reviewListService, type ReviewSummary } from '@/services/reviewList'
import { WeeklyPlanDashboard } from '@/components/action-plan/WeeklyPlanDashboard'

type ActiveTab = 'plans' | 'weekly-dashboard'

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtDt = (iso: string) => format(new Date(iso), 'dd MMM yy HH:mm')

const VIEW_OPTIONS: { label: string; value: ViewMonths }[] = [
  { label: '3 months', value: 3 },
  { label: '6 months', value: 6 },
  { label: '1 year', value: 12 },
  { label: 'All', value: null },
]

// ── Create / Name Modal ────────────────────────────────────────────────────────

function NameModal({
  title,
  suggestedName,
  loading,
  onConfirm,
  onClose,
}: {
  title: string
  suggestedName: string
  loading: boolean
  onConfirm: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(suggestedName)

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
          <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-ink-muted mb-1.5">Plan name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && onConfirm(name.trim())}
              className="input w-full text-sm"
              placeholder="e.g. 2026-05-30"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">Cancel</button>
            <button
              onClick={() => name.trim() && onConfirm(name.trim())}
              disabled={!name.trim() || loading}
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

// ── Confirm Delete Modal ───────────────────────────────────────────────────────

function DeleteModal({
  planName,
  loading,
  onConfirm,
  onClose,
}: {
  planName: string
  loading: boolean
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
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-loss/15 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-loss" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-primary">Delete plan?</p>
              <p className="text-xs text-ink-muted mt-1">
                <span className="font-medium text-ink-secondary">{planName}</span> will be permanently removed.
              </p>
            </div>
          </div>
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

// ── Symbol badges with hover tooltip ─────────────────────────────────────────

const MAX_VISIBLE = 6

function SymbolBadges({ symbols }: { symbols: string }) {
  if (!symbols) return <span className="text-ink-disabled italic">—</span>

  const all = symbols.split(', ').filter(Boolean)
  const visible = all.slice(0, MAX_VISIBLE)
  const hidden = all.slice(MAX_VISIBLE)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map(sym => (
        <span
          key={sym}
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated border border-border/50 text-ink-secondary"
        >
          {sym}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="relative group cursor-default">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500/10 border border-brand-500/20 text-brand-400">
            +{hidden.length} more
          </span>
          {/* Tooltip balloon */}
          <div className="absolute bottom-full right-0 mb-1.5 z-50 hidden group-hover:block">
            <div className="bg-surface-card border border-border/60 rounded-lg shadow-xl px-3 py-2 whitespace-nowrap">
              <p className="text-[10px] font-semibold text-ink-muted mb-0.5 uppercase tracking-wider">
                All symbols ({all.length})
              </p>
              <p className="text-xs text-ink-primary">
                {all.join(', ')}
              </p>
            </div>
          </div>
        </span>
      )}
    </div>
  )
}

// ── Plan Section (one for purchase, one for portfolio) ────────────────────────

function PlanSection({ type }: { type: PlanType }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [months, setMonths] = useState<ViewMonths>(3)

  // modal states
  const [createModal, setCreateModal] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState<PlanSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PlanSummary | null>(null)
  const [suggestedName, setSuggestedName] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const { data: plans = [], isLoading, isError } = useQuery({
    queryKey: ['action-plans', type, months],
    queryFn: () => actionPlanService.list(type, months),
    staleTime: 30_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['action-plans', type] })

  const openCreate = async () => {
    const name = await actionPlanService.suggestName(type)
    setSuggestedName(name)
    setCreateModal(true)
  }

  const openDuplicate = async (plan: PlanSummary) => {
    const name = await actionPlanService.suggestName(type)
    setSuggestedName(name)
    setDuplicateTarget(plan)
  }

  const handleCreate = async (name: string) => {
    setActionLoading(true)
    try {
      const { id } = await actionPlanService.create(name, type)
      setCreateModal(false)
      await invalidate()
      router.push(`/action-plan/${type}/${id}`)
    } catch {
      // keep modal open
    } finally {
      setActionLoading(false)
    }
  }

  const handleDuplicate = async (name: string) => {
    if (!duplicateTarget) return
    setActionLoading(true)
    try {
      const { id } = await actionPlanService.duplicate(duplicateTarget.id, name)
      setDuplicateTarget(null)
      await invalidate()
      router.push(`/action-plan/${type}/${id}`)
    } catch {
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await actionPlanService.delete(deleteTarget.id)
      setDeleteTarget(null)
      await invalidate()
    } catch {
    } finally {
      setActionLoading(false)
    }
  }

  const Icon = type === 'purchase' ? ShoppingCart : Briefcase
  const title = type === 'purchase' ? 'Purchase Action Plan' : 'Portfolio Action Plan'
  const editorBase = type === 'purchase' ? '/action-plan/purchase' : '/action-plan/portfolio'

  return (
    <div className="card overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-border/50 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
        </div>

        {/* View filter */}
        <div className="flex items-center gap-1">
          {VIEW_OPTIONS.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => setMonths(opt.value)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
                months === opt.value
                  ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                  : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Create button */}
        <button
          onClick={openCreate}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Create new plan
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading plans…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-12 gap-2 text-loss text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load plans.
          </div>
        ) : plans.length === 0 ? (
          <div className="py-12 text-center text-ink-muted text-sm">
            No plans yet. Click <span className="text-brand-400 font-medium">Create new plan</span> to get started.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-ink-muted">
                {['Created', 'Plan Name', 'Symbols', 'Last Modified', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr
                  key={plan.id}
                  className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtDt(plan.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`${editorBase}/${plan.id}`}
                      className="font-semibold text-ink-primary hover:text-brand-400 transition-colors"
                    >
                      {plan.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <SymbolBadges symbols={plan.symbols} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtDt(plan.updated_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`${editorBase}/${plan.id}`}
                        className="btn-icon"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Link>
                      <button
                        onClick={() => openDuplicate(plan)}
                        className="btn-icon"
                        title="Duplicate"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(plan)}
                        className="btn-icon text-loss/70 hover:text-loss"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {createModal && (
          <NameModal
            title={`New ${title}`}
            suggestedName={suggestedName}
            loading={actionLoading}
            onConfirm={handleCreate}
            onClose={() => setCreateModal(false)}
          />
        )}
        {duplicateTarget && (
          <NameModal
            title={`Duplicate — ${duplicateTarget.name}`}
            suggestedName={suggestedName}
            loading={actionLoading}
            onConfirm={handleDuplicate}
            onClose={() => setDuplicateTarget(null)}
          />
        )}
        {deleteTarget && (
          <DeleteModal
            planName={deleteTarget.name}
            loading={actionLoading}
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Weekly Scan summary section ────────────────────────────────────────────────

function WeeklyScanSection() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [createModal, setCreateModal] = useState(false)
  const [suggestedName, setSuggestedName] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ScanListSummary | null>(null)

  const { data: scans = [], isLoading, isError } = useQuery({
    queryKey: ['weekly-scans'],
    queryFn: weeklyScanService.listScans,
    staleTime: 30_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['weekly-scans'] })

  const openCreate = async () => {
    const name = await weeklyScanService.suggestName()
    setSuggestedName(name)
    setCreateModal(true)
  }

  const handleCreate = async (name: string) => {
    setActionLoading(true)
    try {
      const { id } = await weeklyScanService.createScan(name)
      setCreateModal(false)
      await invalidate()
      router.push(`/weekly-scan/${id}`)
    } catch { } finally { setActionLoading(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await weeklyScanService.deleteScan(deleteTarget.id)
      setDeleteTarget(null)
      await invalidate()
    } catch { } finally { setActionLoading(false) }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex items-center gap-3">
        <ScanLine className="w-4 h-4 text-brand-400 shrink-0" />
        <h2 className="text-sm font-semibold text-ink-primary flex-1">Weekly Scans</h2>
        <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New Scan
        </button>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-10 gap-2 text-loss text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load scans.
          </div>
        ) : scans.length === 0 ? (
          <div className="py-10 text-center text-ink-muted text-sm">
            No weekly scans yet. Click <span className="text-brand-400 font-medium">New Scan</span> to get started.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-ink-muted">
                <th className="px-4 py-2.5 text-left font-medium">Created</th>
                <th className="px-4 py-2.5 text-left font-medium">Scan Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Symbols</th>
                {COLOR_MARKS.map(c => (
                  <th key={c.value} className="px-2 py-2.5 text-center font-medium" title={c.label}>
                    <span className={cn('inline-block w-2.5 h-2.5 rounded-full', c.dot)} />
                  </th>
                ))}
                <th className="px-4 py-2.5 text-left font-medium">Modified</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map(scan => (
                <tr key={scan.id} className="border-b border-border/25 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtDt(scan.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/weekly-scan/${scan.id}`}
                      className="font-semibold text-ink-primary hover:text-brand-400 transition-colors font-mono">
                      {scan.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">{scan.total}</td>
                  {COLOR_MARKS.map(c => (
                    <td key={c.value} className="px-2 py-2.5 text-center">
                      {scan.color_counts[c.value] > 0
                        ? <span className={cn('font-semibold', c.text)}>{scan.color_counts[c.value]}</span>
                        : <span className="text-ink-disabled">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtDt(scan.updated_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Link href={`/weekly-scan/${scan.id}/dashboard`} className="btn-icon" title="Dashboard">
                        <LayoutDashboard className="w-3.5 h-3.5" />
                      </Link>
                      <Link href={`/weekly-scan/${scan.id}`} className="btn-icon" title="Open">
                        <Edit2 className="w-3.5 h-3.5" />
                      </Link>
                      <button onClick={() => setDeleteTarget(scan)} className="btn-icon text-loss/70 hover:text-loss" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {createModal && (
          <NameModal
            title="New Weekly Scan"
            suggestedName={suggestedName}
            loading={actionLoading}
            onConfirm={handleCreate}
            onClose={() => setCreateModal(false)}
          />
        )}
        {deleteTarget && (
          <DeleteModal
            planName={deleteTarget.name}
            loading={actionLoading}
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Review List Section ───────────────────────────────────────────────────────

const VIEW_OPTIONS_REVIEW: { label: string; value: number | null }[] = [
  { label: '3 months', value: 3 },
  { label: '6 months', value: 6 },
  { label: 'All', value: null },
]

function ReviewListSection() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [months, setMonths] = useState<number | null>(3)
  const [deleteTarget, setDeleteTarget] = useState<ReviewSummary | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Ensure this week's review exists (auto-create)
  const { data: currentWeek } = useQuery<ReviewSummary>({
    queryKey: ['review-current-week'],
    queryFn: reviewListService.getCurrentWeek,
    staleTime: 5 * 60_000,
  })

  const { data: reviews = [], isLoading, isError } = useQuery<ReviewSummary[]>({
    queryKey: ['review-list', months],
    queryFn: () => reviewListService.list(months),
    staleTime: 30_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['review-list'] })
    queryClient.invalidateQueries({ queryKey: ['review-current-week'] })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await reviewListService.delete(deleteTarget.id)
      setDeleteTarget(null)
      invalidate()
    } finally {
      setActionLoading(false)
    }
  }

  const fmtWeek = (r: ReviewSummary) =>
    `${format(parseISO(r.week_start), 'dd MMM')} – ${format(parseISO(r.week_end), 'dd MMM yyyy')}`

  const today = new Date()
  const isCurrentWeek = (r: ReviewSummary) => {
    const end = new Date(r.week_end)
    return end >= today
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <BookOpen className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-semibold text-ink-primary">Review List</h2>
          {currentWeek && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
              This week: {fmtWeek(currentWeek)}
            </span>
          )}
        </div>

        {/* View filter */}
        <div className="flex items-center gap-1">
          {VIEW_OPTIONS_REVIEW.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => setMonths(opt.value)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
                months === opt.value
                  ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                  : 'text-ink-muted border-border hover:text-ink-primary hover:bg-surface-elevated',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Jump to current week */}
        {currentWeek && (
          <button
            onClick={() => router.push(`/action-plan/review-list/${currentWeek.id}`)}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            This Week's Review
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-10 gap-2 text-loss text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load reviews.
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-10 text-center text-ink-muted text-sm">
            No reviews yet. A review for this week will be auto-created.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-ink-muted">
                <th className="px-4 py-2.5 text-left font-medium">Week</th>
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-center font-medium">
                  <span className="flex items-center justify-center gap-1"><TrendingUp className="w-3 h-3 text-brand-400" />Trades</span>
                </th>
                <th className="px-4 py-2.5 text-center font-medium">
                  <span className="flex items-center justify-center gap-1"><Briefcase className="w-3 h-3 text-purple-400" />Open</span>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Updated</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b border-border/25 hover:bg-surface-elevated/50 transition-colors',
                    isCurrentWeek(r) && 'bg-brand-500/5',
                  )}
                >
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtWeek(r)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/action-plan/review-list/${r.id}`}
                      className={cn(
                        'font-semibold hover:text-brand-400 transition-colors',
                        isCurrentWeek(r) ? 'text-brand-400' : 'text-ink-primary',
                      )}
                    >
                      {r.name}
                      {isCurrentWeek(r) && (
                        <span className="ml-1.5 text-[10px] font-normal text-brand-400/70">current</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.trade_count > 0
                      ? <span className="font-semibold text-brand-400">{r.trade_count}</span>
                      : <span className="text-ink-disabled">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.hold_count > 0
                      ? <span className="font-semibold text-purple-400">{r.hold_count}</span>
                      : <span className="text-ink-disabled">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">
                    {format(parseISO(r.updated_at), 'dd MMM yy HH:mm')}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/action-plan/review-list/${r.id}`}
                        className="btn-icon"
                        title="Open review"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="btn-icon text-loss/70 hover:text-loss"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {deleteTarget && (
          <DeleteModal
            planName={deleteTarget.name}
            loading={actionLoading}
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string; icon: React.ElementType }[] = [
  { id: 'weekly-dashboard', label: 'Weekly Plan Dashboard', icon: CalendarDays },
  { id: 'plans',            label: 'Plans',                icon: ClipboardList },
]

export default function ActionPlanPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('weekly-dashboard')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-brand-400" />
          Action Plan
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Prepare, save, and generate purchase &amp; portfolio trading plans.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border/50">
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-brand-400 text-brand-400'
                  : 'border-transparent text-ink-muted hover:text-ink-primary hover:border-border',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'plans' && (
        <div className="space-y-6">
          <PlanSection type="purchase" />
          <PlanSection type="portfolio" />
          <WeeklyScanSection />
          <ReviewListSection />
        </div>
      )}

      {activeTab === 'weekly-dashboard' && (
        <WeeklyPlanDashboard />
      )}
    </div>
  )
}
