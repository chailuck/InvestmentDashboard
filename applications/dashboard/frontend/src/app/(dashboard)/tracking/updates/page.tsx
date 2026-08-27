'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { RefreshCcw, Plus, Loader2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { trackingService } from '@/services/tracking'
import { updateTrackingService } from '@/services/updateTracking'
import { extractApiError } from '@/services/api'
import { CreateUpdateListModal } from '@/components/tracking/CreateUpdateListModal'

const fmtDate = (iso: string) => format(new Date(iso), 'dd MMM yyyy')

/** Formats `quarter` as "Q3", or the "—" no-data convention used elsewhere on this page. */
const fmtQuarter = (quarter: number | null): string => (quarter != null ? `Q${quarter}` : '—')

/** Formats `year` as-is, or the "—" no-data convention used elsewhere on this page. */
const fmtYear = (year: number | null): string => (year != null ? String(year) : '—')

export default function TrackingUpdatesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const { data: sets = [], isLoading: setsLoading, isError: setsError } = useQuery({
    queryKey: ['tracking-sets'],
    queryFn: trackingService.listSets,
    staleTime: 30_000,
  })

  // Default the selection to the first available set once loaded — mirrors
  // the Category page's selector so the two pages behave identically.
  useEffect(() => {
    if (!selectedSetId && sets.length > 0) {
      setSelectedSetId(sets[0].id)
    }
  }, [sets, selectedSetId])

  const { data: lists = [], isLoading: listsLoading, isError: listsError } = useQuery({
    queryKey: ['tracking-update-lists', selectedSetId],
    queryFn: () => updateTrackingService.listUpdateLists(selectedSetId),
    enabled: !!selectedSetId,
    staleTime: 10_000,
  })

  const handleCreate = async (transactionDate: string, quarter: number | null, year: number | null) => {
    if (!selectedSetId) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await updateTrackingService.createUpdateList(selectedSetId, {
        transactionDate,
        quarter,
        year,
      })
      setShowCreate(false)
      await queryClient.invalidateQueries({ queryKey: ['tracking-update-lists', selectedSetId] })
      toast.success('Update list created')
      router.push(`/tracking/updates/${created.id}`)
    } catch (err) {
      setCreateError(extractApiError(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <RefreshCcw className="w-5 h-5 text-brand-400" />
          Tracking — Updates
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Record periodic balance snapshots for a tracking set and review balance changes over time.
        </p>
      </div>

      {/* Tracking Set selector */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="tracking-set-select" className="text-xs font-medium text-ink-secondary shrink-0">
          Tracking Set
        </label>
        {setsLoading ? (
          <div className="flex items-center gap-2 text-ink-muted text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sets…
          </div>
        ) : setsError ? (
          <div className="flex items-center gap-2 text-loss text-xs">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to load tracking sets.
          </div>
        ) : sets.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No tracking sets yet — create one from the Category page to get started.
          </p>
        ) : (
          <select
            id="tracking-set-select"
            value={selectedSetId}
            onChange={e => setSelectedSetId(e.target.value)}
            className="input text-sm min-w-[220px]"
          >
            {sets.map(set => (
              <option key={set.id} value={set.id}>{set.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowCreate(true)}
          disabled={!selectedSetId}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 ml-auto disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Create New List
        </button>
      </div>

      {/* Update Tracking Lists */}
      {selectedSetId ? (
        listsLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading update lists…
          </div>
        ) : listsError ? (
          <div className="flex items-center justify-center py-10 gap-2 text-loss text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load update lists.
          </div>
        ) : lists.length === 0 ? (
          <div className="py-10 text-center text-ink-muted text-sm card">
            No update lists yet. Click <span className="text-brand-400 font-medium">Create New List</span> to record your first balance update.
          </div>
        ) : (
          <div className="card overflow-hidden divide-y divide-border/40">
            <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-medium text-ink-muted bg-surface-elevated/30">
              <span>Transaction Date</span>
              <span>Quarter</span>
              <span>Year</span>
            </div>
            {lists.map(list => (
              <Link
                key={list.id}
                href={`/tracking/updates/${list.id}`}
                className="grid grid-cols-3 gap-4 px-4 py-3 text-sm hover:bg-surface-elevated/50 transition-colors"
              >
                <span className="text-ink-primary font-medium">{fmtDate(list.transactionDate)}</span>
                <span className="text-ink-secondary">{fmtQuarter(list.quarter)}</span>
                <span className="text-ink-secondary">{fmtYear(list.year)}</span>
              </Link>
            ))}
          </div>
        )
      ) : !setsLoading && sets.length === 0 ? (
        <div className="py-12 text-center text-ink-muted text-sm card">
          Create a tracking set on the Category page before recording updates.
        </div>
      ) : null}

      <AnimatePresence>
        {showCreate && (
          <CreateUpdateListModal
            loading={creating}
            error={createError}
            onConfirm={handleCreate}
            onClose={() => { setShowCreate(false); setCreateError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
