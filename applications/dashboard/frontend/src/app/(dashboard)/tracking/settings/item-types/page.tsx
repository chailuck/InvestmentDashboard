'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, AlertCircle, Loader2, Tags } from 'lucide-react'
import toast from 'react-hot-toast'
import { trackingService, type ItemType } from '@/services/tracking'
import { extractApiError } from '@/services/api'
import { useItemTypes, ITEM_TYPES_QUERY_KEY, bySortOrder } from '@/hooks/useItemTypes'
import { useAuthStore } from '@/store/auth'
import { RoleGuard } from '@/components/ui/RoleGuard'
import { ItemTypeRow } from '@/components/tracking/itemtypes/ItemTypeRow'
import { AddItemTypeModal } from '@/components/tracking/itemtypes/AddItemTypeModal'
import { ItemTypeConfirmDialog } from '@/components/tracking/itemtypes/ItemTypeConfirmDialog'

const ADMIN_LIST_KEY: unknown[] = [...ITEM_TYPES_QUERY_KEY, { includeArchived: true }]

/** Every query surface that embeds an item-type label / capability. */
const RELATED_KEYS: readonly (readonly unknown[])[] = [
  ITEM_TYPES_QUERY_KEY,
  ['tracking-item'],
  ['tracking-items'],
  ['tracking-balance-grid'],
  ['tracking-dashboard-balance-grid'],
  ['tracking-analysis-balance-grid'],
]

type Confirm =
  | { mode: 'archive'; type: ItemType }
  | { mode: 'unarchive'; type: ItemType }
  | { mode: 'delete'; type: ItemType }
  | null

export default function ItemTypesSettingsPage() {
  const router = useRouter()
  const currentUser = useAuthStore(s => s.user)
  const queryClient = useQueryClient()

  const { data: types = [], isLoading, isError, refetch, isFetching } = useItemTypes(true)

  const [showArchived, setShowArchived] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const triggerRef = useRef<HTMLElement | null>(null)
  const dragIndex = useRef<number | null>(null)

  // Redirect non-admins (mirrors /admin/users).
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') router.push('/dashboard')
  }, [currentUser, router])

  const sorted = useMemo(() => [...types].sort(bySortOrder), [types])
  const visible = showArchived ? sorted : sorted.filter(t => !t.isArchived)
  const activeCount = sorted.filter(t => !t.isArchived).length
  const archivedCount = sorted.length - activeCount

  const invalidateRelated = () =>
    Promise.all(RELATED_KEYS.map(queryKey => queryClient.invalidateQueries({ queryKey: queryKey as unknown[] })))

  const rememberTrigger = () => {
    triggerRef.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
  }
  const restoreFocus = () => triggerRef.current?.focus?.()

  // ── Reorder (optimistic, full-list, rollback on error) ────────────────────
  const persistOrder = async (ordered: ItemType[]) => {
    const prev = queryClient.getQueryData<ItemType[]>(ADMIN_LIST_KEY)
    queryClient.setQueryData<ItemType[]>(
      ADMIN_LIST_KEY,
      ordered.map((t, i) => ({ ...t, sortOrder: i })),
    )
    setReordering(true)
    try {
      await trackingService.reorderItemTypes(ordered.map(t => t.id))
      await invalidateRelated()
    } catch (err) {
      if (prev) queryClient.setQueryData(ADMIN_LIST_KEY, prev)
      toast.error(extractApiError(err))
    } finally {
      setReordering(false)
    }
  }

  const move = (fullIndex: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? fullIndex - 1 : fullIndex + 1
    if (target < 0 || target >= sorted.length) return
    const arr = [...sorted]
    ;[arr[fullIndex], arr[target]] = [arr[target], arr[fullIndex]]
    void persistOrder(arr)
  }

  const dropOn = (fullIndex: number) => {
    const from = dragIndex.current
    dragIndex.current = null
    if (from === null || from === fullIndex) return
    const arr = [...sorted]
    const [moved] = arr.splice(from, 1)
    arr.splice(fullIndex, 0, moved)
    void persistOrder(arr)
  }

  // ── Row mutations ────────────────────────────────────────────────────────
  const handleRename = async (t: ItemType, label: string) => {
    setBusyId(t.id)
    try {
      await trackingService.updateItemType(t.id, { label })
      await invalidateRelated()
      toast.success('Type renamed')
    } catch (err) {
      toast.error(extractApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleCountsAsProperty = async (t: ItemType, next: boolean) => {
    setBusyId(t.id)
    const capabilities = next
      ? Array.from(new Set([...t.capabilities, 'counts_as_property']))
      : t.capabilities.filter(c => c !== 'counts_as_property')
    try {
      await trackingService.updateItemType(t.id, { capabilities })
      await invalidateRelated()
    } catch (err) {
      toast.error(extractApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleCreate = async ({ label, capabilities }: { label: string; capabilities: string[] }) => {
    setModalBusy(true)
    setModalError(null)
    try {
      await trackingService.createItemType({ label, capabilities })
      await invalidateRelated()
      setShowAdd(false)
      restoreFocus()
      toast.success(`Type "${label}" added`)
    } catch (err) {
      setModalError(extractApiError(err))
    } finally {
      setModalBusy(false)
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    const { mode, type } = confirm
    setModalBusy(true)
    setModalError(null)
    try {
      if (mode === 'archive') await trackingService.archiveItemType(type.id)
      else if (mode === 'unarchive') await trackingService.unarchiveItemType(type.id)
      else await trackingService.deleteItemType(type.id)
      await invalidateRelated()
      setConfirm(null)
      restoreFocus()
      toast.success(
        mode === 'delete' ? `Type "${type.label}" deleted` : `Type "${type.label}" ${mode}d`,
      )
    } catch (err) {
      setModalError(extractApiError(err))
    } finally {
      setModalBusy(false)
    }
  }

  const openConfirm = (c: Exclude<Confirm, null>) => {
    rememberTrigger()
    setModalError(null)
    setConfirm(c)
  }
  const closeConfirm = () => {
    setConfirm(null)
    restoreFocus()
  }

  const busy = reordering || isFetching

  return (
    <RoleGuard
      roles={['admin']}
      fallback={<div className="flex-1 flex items-center justify-center text-ink-muted p-10">Access denied</div>}
    >
      <div className="space-y-4 max-w-4xl">
        <Link
          href="/tracking/category"
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Category page
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
              <Tags className="w-5 h-5 text-brand-400" /> Item Types
            </h1>
            <p className="text-xs text-ink-muted mt-0.5">
              Add, rename, reorder and archive the tracking-item types. Type <em>behaviours</em> (Property
              total, Bond register) are fixed in code — only the label list is editable.
            </p>
          </div>
          <button
            onClick={() => {
              rememberTrigger()
              setModalError(null)
              setShowAdd(true)
            }}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Add custom type
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
            <span className="text-xs text-ink-muted">
              {activeCount} active{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
            </span>
            <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border bg-surface-elevated accent-brand-500"
              />
              Show archived
            </label>
          </div>

          {isLoading ? (
            <div className="divide-y divide-border/25" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-11 px-4 flex items-center">
                  <div className="h-3 w-40 rounded bg-surface-elevated animate-pulse" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-10 flex flex-col items-center gap-2 text-loss text-sm">
              <AlertCircle className="w-5 h-5" />
              Failed to load item types.
              <button onClick={() => refetch()} className="btn-ghost text-xs px-3 py-1.5 mt-1">Retry</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-ink-muted text-sm">No types.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-ink-muted">
                    <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Order</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Label</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Slug</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Capabilities</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Status</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(t => {
                    const fullIndex = sorted.findIndex(x => x.id === t.id)
                    return (
                      <ItemTypeRow
                        key={t.id}
                        type={t}
                        index={fullIndex}
                        total={sorted.length}
                        busy={busyId === t.id || busy}
                        handlers={{
                          onMoveUp: () => move(fullIndex, 'up'),
                          onMoveDown: () => move(fullIndex, 'down'),
                          onRenameSubmit: label => handleRename(t, label),
                          onToggleCountsAsProperty: next => handleToggleCountsAsProperty(t, next),
                          onArchiveToggle: () =>
                            openConfirm({ mode: t.isArchived ? 'unarchive' : 'archive', type: t }),
                          onDelete: () => openConfirm({ mode: 'delete', type: t }),
                          onDragStart: () => (dragIndex.current = fullIndex),
                          onDragEnterRow: () => {},
                          onDrop: () => dropOn(fullIndex),
                        }}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddItemTypeModal
            existingLabels={sorted.map(t => t.label)}
            loading={modalBusy}
            error={modalError}
            onConfirm={handleCreate}
            onClose={() => {
              setShowAdd(false)
              restoreFocus()
            }}
          />
        )}
        {confirm?.mode === 'archive' && (
          <ItemTypeConfirmDialog
            title={`Archive "${confirm.type.label}"?`}
            confirmLabel="Archive"
            loading={modalBusy}
            error={modalError}
            onConfirm={runConfirm}
            onClose={closeConfirm}
            body={
              <>
                <p>
                  <strong>{confirm.type.label}</strong> is used by{' '}
                  {confirm.type.itemCount ?? 0} item{(confirm.type.itemCount ?? 0) === 1 ? '' : 's'}.
                </p>
                <p className="mt-1.5">
                  Archiving hides it when creating or reassigning items. Existing items keep it and all
                  totals (Property / Grand Total) are unaffected. You can unarchive it any time.
                </p>
              </>
            }
          />
        )}
        {confirm?.mode === 'unarchive' && (
          <ItemTypeConfirmDialog
            title={`Unarchive "${confirm.type.label}"?`}
            confirmLabel="Unarchive"
            loading={modalBusy}
            error={modalError}
            onConfirm={runConfirm}
            onClose={closeConfirm}
            body={<p>It will appear again in the type picker for new and reassigned items.</p>}
          />
        )}
        {confirm?.mode === 'delete' && (
          <ItemTypeConfirmDialog
            title={`Delete "${confirm.type.label}"?`}
            confirmLabel="Delete"
            destructive
            loading={modalBusy}
            error={modalError}
            onConfirm={runConfirm}
            onClose={closeConfirm}
            body={<p>This can&rsquo;t be undone. Only unused custom types can be deleted.</p>}
          />
        )}
      </AnimatePresence>
    </RoleGuard>
  )
}
