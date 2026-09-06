'use client'

import { useEffect, useRef, useState } from 'react'
import {
  GripVertical, ArrowUp, ArrowDown, Lock, Check, X, Trash2, Archive, ArchiveRestore, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ItemType } from '@/services/tracking'

const COUNTS_AS_PROPERTY = 'counts_as_property'
const BOND_REGISTER = 'bond_register'

export interface ItemTypeRowHandlers {
  onMoveUp: () => void
  onMoveDown: () => void
  onRenameSubmit: (label: string) => void
  onToggleCountsAsProperty: (next: boolean) => void
  onArchiveToggle: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragEnterRow: () => void
  onDrop: () => void
}

/**
 * One row of the Item Types admin table (§F.2). System rows: lock + "System"
 * badge, label & order still editable, capability checkbox disabled (checked
 * state shown), Delete disabled. Custom rows: fully editable; Delete enabled
 * only at `itemCount === 0`. Archived rows render muted with an "Archived" badge.
 */
export function ItemTypeRow({
  type,
  index,
  total,
  busy,
  handlers,
}: {
  type: ItemType
  index: number
  total: number
  busy: boolean
  handlers: ItemTypeRowHandlers
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(type.label)
  const editRef = useRef<HTMLInputElement>(null)
  const labelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(type.label)
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    labelBtnRef.current?.focus()
  }
  const commitEdit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== type.label) handlers.onRenameSubmit(next)
    else labelBtnRef.current?.focus()
  }

  const hasCountsAsProperty = type.capabilities.includes(COUNTS_AS_PROPERTY)
  const hasBondRegister = type.capabilities.includes(BOND_REGISTER)
  const inUse = (type.itemCount ?? 0) > 0
  const deleteDisabled = type.isSystem || inUse
  const deleteTitle = type.isSystem
    ? "System types can't be deleted — archive instead"
    : inUse
    ? `Used by ${type.itemCount} item${type.itemCount === 1 ? '' : 's'} — archive instead`
    : `Delete ${type.label}`

  return (
    <tr
      className={cn(
        'border-b border-border/25 transition-colors hover:bg-surface-elevated/40',
        type.isArchived && 'opacity-60',
        busy && 'pointer-events-none opacity-50',
      )}
      draggable={!editing}
      onDragStart={handlers.onDragStart}
      onDragEnter={handlers.onDragEnterRow}
      onDragOver={e => e.preventDefault()}
      onDrop={handlers.onDrop}
      data-testid={`item-type-row-${type.slug}`}
    >
      {/* Reorder controls */}
      <td className="px-2 py-2 whitespace-nowrap">
        <div className="flex items-center gap-0.5">
          <span
            className="btn-icon w-6 h-6 cursor-grab text-ink-disabled"
            aria-hidden="true"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          <button
            type="button"
            onClick={handlers.onMoveUp}
            disabled={index === 0 || busy}
            aria-label={`Move ${type.label} up`}
            className="btn-icon w-6 h-6 disabled:opacity-30"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handlers.onMoveDown}
            disabled={index === total - 1 || busy}
            aria-label={`Move ${type.label} down`}
            className="btn-icon w-6 h-6 disabled:opacity-30"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-ink-disabled tabular-nums w-5 text-right">{type.sortOrder}</span>
        </div>
      </td>

      {/* Label — inline edit */}
      <td className="px-3 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              ref={editRef}
              value={draft}
              maxLength={120}
              aria-label={`Rename ${type.label}`}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              className="input text-sm py-1 w-48"
            />
            <button type="button" onClick={commitEdit} aria-label="Save label" className="btn-icon w-6 h-6 text-gain">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={cancelEdit} aria-label="Cancel rename" className="btn-icon w-6 h-6">
              <X className="w-3.5 h-3.5" />
            </button>
            {inUse && (
              <span className="text-[10px] text-ink-disabled">
                Renames everywhere it appears, including past reports.
              </span>
            )}
          </div>
        ) : (
          <button
            ref={labelBtnRef}
            type="button"
            onClick={startEdit}
            className="text-sm text-ink-primary hover:text-brand-400 text-left"
            aria-label={`Edit label for ${type.label}`}
          >
            {type.label}
          </button>
        )}
      </td>

      {/* Slug (read-only) */}
      <td className="px-3 py-2">
        <span className="text-[11px] font-mono text-ink-disabled">{type.slug}</span>
      </td>

      {/* Capabilities */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={cn(
              'flex items-center gap-1.5 text-[11px]',
              type.isSystem ? 'text-ink-disabled cursor-not-allowed' : 'text-ink-secondary cursor-pointer',
            )}
          >
            <input
              type="checkbox"
              checked={hasCountsAsProperty}
              disabled={type.isSystem || busy}
              onChange={e => handlers.onToggleCountsAsProperty(e.target.checked)}
              aria-label={`Counts as property — ${type.label}`}
              className="w-3.5 h-3.5 rounded border-border bg-surface-elevated accent-brand-500 disabled:opacity-60"
            />
            Counts as property
          </label>
          {hasBondRegister && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/20"
              title="Provided by the built-in Bond type. Can't be added to other types."
            >
              Bond register
            </span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {type.isSystem && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated text-ink-muted border border-border/50">
              <Lock className="w-3 h-3" /> System
            </span>
          )}
          {type.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-elevated text-ink-muted border border-border/50">
              Archived
            </span>
          )}
          {!type.isSystem && !type.isArchived && (
            <span className="text-[10px] text-ink-disabled">Custom</span>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlers.onArchiveToggle}
            disabled={busy}
            aria-label={type.isArchived ? `Unarchive ${type.label}` : `Archive ${type.label}`}
            className="btn-icon w-7 h-7"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : type.isArchived ? (
              <ArchiveRestore className="w-3.5 h-3.5" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={handlers.onDelete}
            disabled={deleteDisabled || busy}
            aria-label={`Delete ${type.label}`}
            title={deleteTitle}
            className="btn-icon w-7 h-7 text-loss/70 hover:text-loss disabled:opacity-30 disabled:hover:text-loss/70"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}
