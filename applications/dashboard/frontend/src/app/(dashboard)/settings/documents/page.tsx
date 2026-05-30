'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, RefreshCw, ChevronDown, ChevronRight, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocNode {
  id: string
  label: string
  file?: string         // leaf — has content
  children?: DocNode[]  // group — expand/collapse
}

interface Manifest {
  tree: DocNode[]
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchManifest(): Promise<Manifest> {
  const { data } = await apiClient.get('/docs-content/manifest')
  return data as Manifest
}

async function fetchDoc(path: string): Promise<string> {
  const { data } = await apiClient.get('/docs-content/file', { params: { path } })
  return (data as { content: string }).content
}

// ── Tree navigation ────────────────────────────────────────────────────────────

function TreeNode({
  node,
  selected,
  onSelect,
  depth = 0,
}: {
  node: DocNode
  selected: string | null
  onSelect: (node: DocNode) => void
  depth?: number
}) {
  const isLeaf = !!node.file && !node.children?.length
  const [open, setOpen] = useState(true)

  if (isLeaf) {
    return (
      <button
        onClick={() => onSelect(node)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left',
          depth > 0 && 'ml-3',
          selected === node.id
            ? 'bg-brand-500/10 text-brand-400'
            : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
        )}
      >
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium truncate">{node.label}</span>
      </button>
    )
  }

  // Group node
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          depth > 0 && 'ml-3',
          'text-ink-secondary hover:text-ink-primary hover:bg-surface-elevated/50',
        )}
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        {node.label}
      </button>
      {open && node.children && (
        <div className="pl-2 border-l border-border/40 ml-3.5 mt-0.5 space-y-0.5">
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [selectedNode, setSelectedNode] = useState<DocNode | null>(null)

  // Load manifest
  const { data: manifest, isLoading: manifestLoading } = useQuery({
    queryKey: ['docs-manifest'],
    queryFn: fetchManifest,
    staleTime: 60_000,
  })

  // Auto-select first leaf once manifest loads
  useEffect(() => {
    if (manifest && !selectedNode) {
      const firstLeaf = findFirstLeaf(manifest.tree)
      if (firstLeaf) setSelectedNode(firstLeaf)
    }
  }, [manifest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load selected document content
  const {
    data: content,
    isLoading: contentLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['docs-file', selectedNode?.file],
    queryFn: () => fetchDoc(selectedNode!.file!),
    enabled: !!selectedNode?.file,
    staleTime: 60_000,
  })

  return (
    <div className="flex gap-0 h-[calc(100vh-4rem)] -m-6">
      {/* Left tree nav */}
      <aside className="w-56 shrink-0 border-r border-border/50 bg-surface-card overflow-y-auto p-3 space-y-1">
        <div className="flex items-center gap-2 px-2 pb-2 border-b border-border/40 mb-2">
          <BookOpen className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-bold text-ink-primary">Documentation</span>
        </div>

        {manifestLoading ? (
          <div className="space-y-1.5 px-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton h-5 rounded" style={{ width: `${60 + i * 8}%` }} />
            ))}
          </div>
        ) : manifest ? (
          manifest.tree.map((node: DocNode) => (
            <TreeNode
              key={node.id}
              node={node}
              selected={selectedNode?.id ?? null}
              onSelect={setSelectedNode}
            />
          ))
        ) : null}
      </aside>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Content header */}
          {selectedNode && (
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-lg font-bold text-ink-primary">{selectedNode.label}</h1>
              <button onClick={() => refetch()} className="btn-icon" title="Reload">
                <RefreshCw className={cn('w-4 h-4', contentLoading && 'animate-spin')} />
              </button>
            </div>
          )}

          <div className="card p-6 md:p-8">
            {!selectedNode && (
              <div className="text-center py-12 text-ink-muted">
                <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a document from the left navigation.</p>
              </div>
            )}
            {contentLoading && (
              <div className="space-y-3">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="skeleton h-4 rounded" style={{ width: `${50 + (i % 5) * 10}%` }} />
                ))}
              </div>
            )}
            {isError && (
              <div className="text-center py-10 text-ink-muted">
                <p className="text-sm">Could not load document.</p>
                <p className="text-xs mt-1">Make sure the backend docs volume mount is configured.</p>
              </div>
            )}
            {content && !contentLoading && (
              <div className={cn(
                'prose prose-invert prose-sm max-w-none',
                'prose-headings:text-ink-primary prose-headings:font-bold prose-headings:tracking-tight',
                'prose-h1:text-2xl prose-h1:mb-4',
                'prose-h2:text-xl prose-h2:border-b prose-h2:border-border/50 prose-h2:pb-2 prose-h2:mt-8',
                'prose-h3:text-base prose-h3:text-brand-400 prose-h3:mt-6',
                'prose-p:text-ink-secondary prose-p:leading-7',
                'prose-a:text-brand-400 prose-a:no-underline hover:prose-a:underline',
                'prose-code:text-brand-300 prose-code:bg-surface-elevated prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none',
                'prose-pre:bg-surface-elevated prose-pre:border prose-pre:border-border/50 prose-pre:rounded-lg',
                'prose-table:text-xs prose-table:border-collapse',
                'prose-thead:bg-surface-elevated',
                'prose-th:text-ink-muted prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-border/50',
                'prose-td:text-ink-secondary prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-border/30',
                'prose-tr:border-b prose-tr:border-border/30 even:prose-tr:bg-surface-elevated/30',
                'prose-ul:text-ink-secondary prose-ul:space-y-1',
                'prose-ol:text-ink-secondary prose-ol:space-y-1',
                'prose-li:marker:text-ink-muted',
                'prose-strong:text-ink-primary prose-strong:font-semibold',
                'prose-em:text-ink-secondary',
                'prose-blockquote:border-l-4 prose-blockquote:border-brand-500/40 prose-blockquote:text-ink-muted prose-blockquote:not-italic prose-blockquote:pl-4',
                'prose-hr:border-border/50',
              )}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

function findFirstLeaf(nodes: DocNode[]): DocNode | null {
  for (const node of nodes) {
    if (node.file && !node.children?.length) return node
    if (node.children) {
      const found = findFirstLeaf(node.children)
      if (found) return found
    }
  }
  return null
}
