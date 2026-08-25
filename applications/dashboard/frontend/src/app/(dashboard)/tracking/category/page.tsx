'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { Wallet, Plus, Loader2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { trackingService, type TrackingSet } from '@/services/tracking'
import { extractApiError } from '@/services/api'
import { NameDescriptionModal } from '@/components/tracking/NameDescriptionModal'
import { CategoryTree } from '@/components/tracking/CategoryTree'

export default function TrackingCategoryPage() {
  const queryClient = useQueryClient()
  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const [showCreateSet, setShowCreateSet] = useState(false)
  const [creatingSet, setCreatingSet] = useState(false)
  const [createSetError, setCreateSetError] = useState<string | null>(null)

  const { data: sets = [], isLoading, isError } = useQuery({
    queryKey: ['tracking-sets'],
    queryFn: trackingService.listSets,
    staleTime: 30_000,
  })

  // Default the selection to the first available set once loaded.
  useEffect(() => {
    if (!selectedSetId && sets.length > 0) {
      setSelectedSetId(sets[0].id)
    }
  }, [sets, selectedSetId])

  const handleCreateSet = async (name: string, description: string) => {
    setCreatingSet(true)
    setCreateSetError(null)
    try {
      const created: TrackingSet = await trackingService.createSet({ name, description: description || null })
      setShowCreateSet(false)
      await queryClient.invalidateQueries({ queryKey: ['tracking-sets'] })
      // The backend cascades default categories/sub-categories on creation —
      // selecting the new set immediately triggers the categories query below.
      setSelectedSetId(created.id)
      toast.success(`Tracking set "${created.name}" created`)
    } catch (err) {
      setCreateSetError(extractApiError(err))
    } finally {
      setCreatingSet(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <Wallet className="w-5 h-5 text-brand-400" />
          Tracking — Category
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Manage your financial tracking sets, categories, sub-categories, and tracking items.
        </p>
      </div>

      {/* Tracking Set selector */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="tracking-set-select" className="text-xs font-medium text-ink-secondary shrink-0">
          Tracking Set
        </label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-ink-muted text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sets…
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-loss text-xs">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to load tracking sets.
          </div>
        ) : sets.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No tracking sets yet — create one to get started.
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
          onClick={() => setShowCreateSet(true)}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 ml-auto"
        >
          <Plus className="w-3.5 h-3.5" /> New Tracking Set
        </button>
      </div>

      {/* Category / Sub-category / Item tree */}
      {selectedSetId ? (
        <CategoryTree setId={selectedSetId} />
      ) : !isLoading && sets.length === 0 ? (
        <div className="py-12 text-center text-ink-muted text-sm card">
          Create your first tracking set to start managing categories.
        </div>
      ) : null}

      <AnimatePresence>
        {showCreateSet && (
          <NameDescriptionModal
            title="New Tracking Set"
            loading={creatingSet}
            error={createSetError}
            onConfirm={handleCreateSet}
            onClose={() => { setShowCreateSet(false); setCreateSetError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
