'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, Edit2, Trash2, ChevronDown, ArrowUp, ArrowDown,
  Loader2, AlertCircle, FolderTree, Layers, ListTree, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  trackingService,
  type Category, type SubCategory, type TrackingItem, type TrackingItemType,
} from '@/services/tracking'
import { extractApiError } from '@/services/api'
import { NameDescriptionModal } from './NameDescriptionModal'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { CreateItemModal } from './CreateItemModal'

// ── Shared reorder helper ─────────────────────────────────────────────────────

/** Swaps the item at `index` with its neighbor in `direction`, returning the new id order. */
function swap<T extends { id: string }>(list: T[], index: number, direction: 'up' | 'down'): string[] {
  const target = direction === 'up' ? index - 1 : index + 1
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map(x => x.id)
}

// ── Tracking Item row ─────────────────────────────────────────────────────────

function ItemRow({
  item, index, total, onMoveUp, onMoveDown, onRename, onDelete, moving,
}: {
  item: TrackingItem
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onDelete: () => void
  moving: boolean
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-elevated/50 transition-colors">
      <span className="text-[10px] text-ink-disabled w-5 shrink-0 tabular-nums">{item.order}</span>
      <Link
        href={`/tracking/items/${item.id}`}
        className="flex items-center gap-2 flex-1 min-w-0 text-sm text-ink-primary hover:text-brand-400 transition-colors"
      >
        <span className="truncate font-medium">{item.name}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated border border-border/50 text-ink-secondary shrink-0">
          {item.type}
        </span>
        <ExternalLink className="w-3 h-3 text-ink-disabled shrink-0" />
      </Link>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={index === 0 || moving}
          aria-label={`Move ${item.name} up`}
          className="btn-icon w-6 h-6 disabled:opacity-30"
        >
          <ArrowUp className="w-3 h-3" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1 || moving}
          aria-label={`Move ${item.name} down`}
          className="btn-icon w-6 h-6 disabled:opacity-30"
        >
          <ArrowDown className="w-3 h-3" />
        </button>
        <button onClick={onRename} aria-label={`Rename ${item.name}`} className="btn-icon w-6 h-6">
          <Edit2 className="w-3 h-3" />
        </button>
        <button onClick={onDelete} aria-label={`Delete ${item.name}`} className="btn-icon w-6 h-6 text-loss/70 hover:text-loss">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ── Sub-category node (owns Tracking Items) ──────────────────────────────────

function SubCategoryNode({
  subCategory, index, total, onMoveUp, onMoveDown, onRename, onDelete, reordering,
}: {
  subCategory: SubCategory
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onDelete: () => void
  reordering: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [showCreateItem, setShowCreateItem] = useState(false)
  const [renameItem, setRenameItem] = useState<TrackingItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<TrackingItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [movingItem, setMovingItem] = useState(false)

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['tracking-items', subCategory.id],
    queryFn: () => trackingService.listItems(subCategory.id),
    staleTime: 30_000,
  })

  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: ['tracking-items', subCategory.id] })

  const handleCreateItem = async (name: string, type: TrackingItemType) => {
    setBusy(true)
    setError(null)
    try {
      await trackingService.createItem(subCategory.id, {
        name, type, initialInvestmentTracking: false, exclusive: false,
      })
      setShowCreateItem(false)
      await invalidateItems()
      toast.success(`Item "${name}" created`)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRenameItem = async (name: string, description: string) => {
    if (!renameItem) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.updateItem(renameItem.id, { name, description: description || null })
      setRenameItem(null)
      await invalidateItems()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteItem = async () => {
    if (!deleteItem) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.deleteItem(deleteItem.id)
      setDeleteItem(null)
      await invalidateItems()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const moveItem = async (idx: number, direction: 'up' | 'down') => {
    setMovingItem(true)
    try {
      const orderedIds = swap(items, idx, direction)
      await trackingService.reorderItems(subCategory.id, orderedIds)
      await invalidateItems()
    } catch (err) {
      toast.error(extractApiError(err))
    } finally {
      setMovingItem(false)
    }
  }

  return (
    <div className="ml-4 pl-3 border-l border-border/40">
      <div className="flex items-center gap-2 py-1.5">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${subCategory.name}`}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <ListTree className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          <span className="text-sm font-medium text-ink-secondary truncate">{subCategory.name}</span>
          <ChevronDown className={cn('w-3.5 h-3.5 text-ink-disabled shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onMoveUp} disabled={index === 0 || reordering} aria-label={`Move ${subCategory.name} up`} className="btn-icon w-6 h-6 disabled:opacity-30">
            <ArrowUp className="w-3 h-3" />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1 || reordering} aria-label={`Move ${subCategory.name} down`} className="btn-icon w-6 h-6 disabled:opacity-30">
            <ArrowDown className="w-3 h-3" />
          </button>
          <button onClick={onRename} aria-label={`Rename ${subCategory.name}`} className="btn-icon w-6 h-6">
            <Edit2 className="w-3 h-3" />
          </button>
          <button onClick={onDelete} aria-label={`Delete ${subCategory.name}`} className="btn-icon w-6 h-6 text-loss/70 hover:text-loss">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {open && (
        <div className="pb-2 space-y-0.5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-ink-muted text-xs py-2 pl-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading items…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-loss text-xs py-2 pl-4">
              <AlertCircle className="w-3.5 h-3.5" /> Failed to load items.
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-ink-disabled pl-4 py-1">No items yet.</p>
          ) : (
            items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                index={idx}
                total={items.length}
                moving={movingItem}
                onMoveUp={() => moveItem(idx, 'up')}
                onMoveDown={() => moveItem(idx, 'down')}
                onRename={() => setRenameItem(item)}
                onDelete={() => setDeleteItem(item)}
              />
            ))
          )}
          <button
            onClick={() => setShowCreateItem(true)}
            className="flex items-center gap-1.5 pl-4 py-1.5 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
      )}

      <AnimatePresence>
        {showCreateItem && (
          <CreateItemModal
            loading={busy}
            error={error}
            onConfirm={handleCreateItem}
            onClose={() => { setShowCreateItem(false); setError(null) }}
          />
        )}
        {renameItem && (
          <NameDescriptionModal
            title={`Rename item — ${renameItem.name}`}
            initialName={renameItem.name}
            initialDescription={renameItem.description ?? ''}
            loading={busy}
            error={error}
            onConfirm={handleRenameItem}
            onClose={() => { setRenameItem(null); setError(null) }}
          />
        )}
        {deleteItem && (
          <ConfirmDeleteModal
            entityLabel="tracking item"
            entityName={deleteItem.name}
            loading={busy}
            error={error}
            onConfirm={handleDeleteItem}
            onClose={() => { setDeleteItem(null); setError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Category node (owns Sub-categories) ──────────────────────────────────────

function CategoryNode({
  category, index, total, onMoveUp, onMoveDown, onRename, onDelete, reordering,
}: {
  category: Category
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onDelete: () => void
  reordering: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [showCreateSub, setShowCreateSub] = useState(false)
  const [renameSub, setRenameSub] = useState<SubCategory | null>(null)
  const [deleteSub, setDeleteSub] = useState<SubCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [movingSub, setMovingSub] = useState(false)

  const { data: subCategories = [], isLoading, isError } = useQuery({
    queryKey: ['tracking-subcategories', category.id],
    queryFn: () => trackingService.listSubCategories(category.id),
    staleTime: 30_000,
  })

  const invalidateSubs = () => queryClient.invalidateQueries({ queryKey: ['tracking-subcategories', category.id] })

  const handleCreateSub = async (name: string, description: string) => {
    setBusy(true)
    setError(null)
    try {
      await trackingService.createSubCategory(category.id, { name, description: description || null })
      setShowCreateSub(false)
      await invalidateSubs()
      toast.success(`Sub-category "${name}" created`)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRenameSub = async (name: string, description: string) => {
    if (!renameSub) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.updateSubCategory(renameSub.id, { name, description: description || null })
      setRenameSub(null)
      await invalidateSubs()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSub = async () => {
    if (!deleteSub) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.deleteSubCategory(deleteSub.id)
      setDeleteSub(null)
      await invalidateSubs()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const moveSub = async (idx: number, direction: 'up' | 'down') => {
    setMovingSub(true)
    try {
      const orderedIds = swap(subCategories, idx, direction)
      await trackingService.reorderSubCategories(category.id, orderedIds)
      await invalidateSubs()
    } catch (err) {
      toast.error(extractApiError(err))
    } finally {
      setMovingSub(false)
    }
  }

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Layers className="w-4 h-4 text-brand-400 shrink-0" />
          <span className="text-sm font-semibold text-ink-primary truncate">{category.name}</span>
          <ChevronDown className={cn('w-4 h-4 text-ink-disabled shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onMoveUp} disabled={index === 0 || reordering} aria-label={`Move ${category.name} up`} className="btn-icon disabled:opacity-30">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1 || reordering} aria-label={`Move ${category.name} down`} className="btn-icon disabled:opacity-30">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRename} aria-label={`Rename ${category.name}`} className="btn-icon">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} aria-label={`Delete ${category.name}`} className="btn-icon text-loss/70 hover:text-loss">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-ink-muted text-xs py-2 pl-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sub-categories…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-loss text-xs py-2 pl-4">
              <AlertCircle className="w-3.5 h-3.5" /> Failed to load sub-categories.
            </div>
          ) : subCategories.length === 0 ? (
            <p className="text-xs text-ink-disabled pl-4 py-1">No sub-categories yet.</p>
          ) : (
            subCategories.map((sub, idx) => (
              <SubCategoryNode
                key={sub.id}
                subCategory={sub}
                index={idx}
                total={subCategories.length}
                reordering={movingSub}
                onMoveUp={() => moveSub(idx, 'up')}
                onMoveDown={() => moveSub(idx, 'down')}
                onRename={() => setRenameSub(sub)}
                onDelete={() => setDeleteSub(sub)}
              />
            ))
          )}
          <button
            onClick={() => setShowCreateSub(true)}
            className="flex items-center gap-1.5 ml-4 pl-3 py-1.5 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add sub-category
          </button>
        </div>
      )}

      <AnimatePresence>
        {showCreateSub && (
          <NameDescriptionModal
            title={`New sub-category in ${category.name}`}
            loading={busy}
            error={error}
            onConfirm={handleCreateSub}
            onClose={() => { setShowCreateSub(false); setError(null) }}
          />
        )}
        {renameSub && (
          <NameDescriptionModal
            title={`Rename sub-category — ${renameSub.name}`}
            initialName={renameSub.name}
            initialDescription={renameSub.description ?? ''}
            loading={busy}
            error={error}
            onConfirm={handleRenameSub}
            onClose={() => { setRenameSub(null); setError(null) }}
          />
        )}
        {deleteSub && (
          <ConfirmDeleteModal
            entityLabel="sub-category"
            entityName={deleteSub.name}
            cascadeWarning="All tracking items under this sub-category will also be deleted."
            loading={busy}
            error={error}
            onConfirm={handleDeleteSub}
            onClose={() => { setDeleteSub(null); setError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Category Tree (top level — owns Categories for the selected set) ────────

export function CategoryTree({ setId }: { setId: string }) {
  const queryClient = useQueryClient()
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [renameCategory, setRenameCategory] = useState<Category | null>(null)
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [movingCategory, setMovingCategory] = useState(false)

  const { data: categories = [], isLoading, isError } = useQuery({
    queryKey: ['tracking-categories', setId],
    queryFn: () => trackingService.listCategories(setId),
    staleTime: 30_000,
  })

  const invalidateCategories = () => queryClient.invalidateQueries({ queryKey: ['tracking-categories', setId] })

  const handleCreateCategory = async (name: string, description: string) => {
    setBusy(true)
    setError(null)
    try {
      await trackingService.createCategory(setId, { name, description: description || null })
      setShowCreateCategory(false)
      await invalidateCategories()
      toast.success(`Category "${name}" created`)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRenameCategory = async (name: string, description: string) => {
    if (!renameCategory) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.updateCategory(renameCategory.id, { name, description: description || null })
      setRenameCategory(null)
      await invalidateCategories()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!deleteCategory) return
    setBusy(true)
    setError(null)
    try {
      await trackingService.deleteCategory(deleteCategory.id)
      setDeleteCategory(null)
      await invalidateCategories()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const moveCategory = async (idx: number, direction: 'up' | 'down') => {
    setMovingCategory(true)
    try {
      const orderedIds = swap(categories, idx, direction)
      await trackingService.reorderCategories(setId, orderedIds)
      await invalidateCategories()
    } catch (err) {
      toast.error(extractApiError(err))
    } finally {
      setMovingCategory(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
          <FolderTree className="w-4 h-4 text-brand-400" /> Categories
        </h2>
        <button
          onClick={() => setShowCreateCategory(true)}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add Category
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-ink-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading categories…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-10 gap-2 text-loss text-sm">
          <AlertCircle className="w-4 h-4" /> Failed to load categories.
        </div>
      ) : categories.length === 0 ? (
        <div className="py-10 text-center text-ink-muted text-sm card">
          No categories yet. Click <span className="text-brand-400 font-medium">Add Category</span> to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map((cat, idx) => (
            <CategoryNode
              key={cat.id}
              category={cat}
              index={idx}
              total={categories.length}
              reordering={movingCategory}
              onMoveUp={() => moveCategory(idx, 'up')}
              onMoveDown={() => moveCategory(idx, 'down')}
              onRename={() => setRenameCategory(cat)}
              onDelete={() => setDeleteCategory(cat)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreateCategory && (
          <NameDescriptionModal
            title="New Category"
            loading={busy}
            error={error}
            onConfirm={handleCreateCategory}
            onClose={() => { setShowCreateCategory(false); setError(null) }}
          />
        )}
        {renameCategory && (
          <NameDescriptionModal
            title={`Rename category — ${renameCategory.name}`}
            initialName={renameCategory.name}
            initialDescription={renameCategory.description ?? ''}
            loading={busy}
            error={error}
            onConfirm={handleRenameCategory}
            onClose={() => { setRenameCategory(null); setError(null) }}
          />
        )}
        {deleteCategory && (
          <ConfirmDeleteModal
            entityLabel="category"
            entityName={deleteCategory.name}
            cascadeWarning="All sub-categories and tracking items under this category will also be deleted."
            loading={busy}
            error={error}
            onConfirm={handleDeleteCategory}
            onClose={() => { setDeleteCategory(null); setError(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
