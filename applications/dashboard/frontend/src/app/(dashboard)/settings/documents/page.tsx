'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  FileText, RefreshCw, ChevronDown, ChevronRight, BookOpen,
  Download, FileDown, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocNode {
  id: string
  label: string
  file?: string
  children?: DocNode[]
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

function collectLeaves(nodes: DocNode[]): DocNode[] {
  const result: DocNode[] = []
  const walk = (n: DocNode) => {
    if (n.file && !n.children?.length) { result.push(n); return }
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return result
}

// ── Download utility ──────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function htmlTemplate(title: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} — InvestPro Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css">
<style>
  body { background: #0d1117; padding: 2rem; font-family: -apple-system, sans-serif; }
  .markdown-body { max-width: 960px; margin: 0 auto; background: #161b22; padding: 2.5rem; border-radius: 10px; border: 1px solid #30363d; }
  .doc-title { font-size: 1.1rem; font-weight: 700; color: #58a6ff; margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid #30363d; }
</style>
</head>
<body>
<article class="markdown-body">
<p class="doc-title">📊 InvestPro Documentation — ${title}</p>
${bodyHtml}
</article>
</body>
</html>`
}

function htmlTemplateRaw(title: string, markdown: string) {
  // Version using CDN marked.js to render markdown client-side
  const encoded = btoa(unescape(encodeURIComponent(markdown)))
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} — InvestPro Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
<style>
  body { background: #0d1117; padding: 2rem; font-family: -apple-system, sans-serif; }
  .markdown-body { max-width: 960px; margin: 0 auto; background: #161b22; padding: 2.5rem; border-radius: 10px; border: 1px solid #30363d; }
</style>
</head>
<body>
<article class="markdown-body" id="content"></article>
<script>
  const md = decodeURIComponent(escape(atob("${encoded}")));
  document.getElementById('content').innerHTML = marked.parse(md);
</script>
</body>
</html>`
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
            ? 'bg-brand-500/10 text-brand-400 font-medium'
            : 'text-ink-muted hover:text-ink-primary hover:bg-surface-elevated',
        )}
      >
        <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="truncate">{node.label}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          depth > 0 && 'ml-1',
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
            <TreeNode key={child.id} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [selectedNode, setSelectedNode] = useState<DocNode | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const renderRef = useRef<HTMLDivElement>(null)

  const { data: manifest, isLoading: manifestLoading } = useQuery({
    queryKey: ['docs-manifest'],
    queryFn: fetchManifest,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (manifest && !selectedNode) {
      const firstLeaf = findFirstLeaf(manifest.tree)
      if (firstLeaf) setSelectedNode(firstLeaf)
    }
  }, [manifest]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Export helpers ──────────────────────────────────────────────────────

  const exportCurrentMd = () => {
    if (!content || !selectedNode) return
    downloadBlob(content, `${selectedNode.id}.md`, 'text/markdown;charset=utf-8')
  }

  const exportCurrentHtml = () => {
    if (!selectedNode) return
    // Use the rendered DOM if available
    const bodyHtml = renderRef.current?.innerHTML
    if (bodyHtml) {
      downloadBlob(htmlTemplate(selectedNode.label, bodyHtml), `${selectedNode.id}.html`, 'text/html;charset=utf-8')
    } else if (content) {
      downloadBlob(htmlTemplateRaw(selectedNode.label, content), `${selectedNode.id}.html`, 'text/html;charset=utf-8')
    }
  }

  const exportAllMd = async () => {
    if (!manifest) return
    setExportingAll(true)
    try {
      const leaves = collectLeaves(manifest.tree)
      const sections = await Promise.all(
        leaves.map(async leaf => {
          try {
            const c = await fetchDoc(leaf.file!)
            return `# ${leaf.label}\n\n${c}`
          } catch {
            return `# ${leaf.label}\n\n_Failed to load._`
          }
        })
      )
      const combined = sections.join('\n\n---\n\n')
      const header = `# InvestPro — Complete Documentation\n\n_Exported: ${new Date().toISOString().slice(0, 10)}_\n\n---\n\n`
      downloadBlob(header + combined, 'InvestPro-Documentation.md', 'text/markdown;charset=utf-8')
    } finally {
      setExportingAll(false)
    }
  }

  const exportAllHtml = async () => {
    if (!manifest) return
    setExportingAll(true)
    try {
      const leaves = collectLeaves(manifest.tree)
      const sections = await Promise.all(
        leaves.map(async leaf => {
          try { return { label: leaf.label, content: await fetchDoc(leaf.file!) } }
          catch { return { label: leaf.label, content: '_Failed to load._' } }
        })
      )

      // Build combined markdown then embed it with CDN renderer
      const combined =
        `# InvestPro — Complete Documentation\n\n_Exported: ${new Date().toISOString().slice(0, 10)}_\n\n---\n\n` +
        sections.map(s => `# ${s.label}\n\n${s.content}`).join('\n\n---\n\n')

      downloadBlob(htmlTemplateRaw('Complete Documentation', combined), 'InvestPro-Documentation.html', 'text/html;charset=utf-8')
    } finally {
      setExportingAll(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6">
      {/* Left tree nav */}
      <aside className="w-56 shrink-0 border-r border-border/50 bg-surface-card overflow-y-auto p-3 space-y-1">
        <div className="flex items-center gap-2 px-2 pb-2 border-b border-border/40 mb-2">
          <BookOpen className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-bold text-ink-primary">Documentation</span>
        </div>

        {manifestLoading ? (
          <div className="space-y-1.5 px-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton h-5 rounded" style={{ width: `${55 + i * 7}%` }} />
            ))}
          </div>
        ) : manifest ? (
          manifest.tree.map((node: DocNode) => (
            <TreeNode key={node.id} node={node} selected={selectedNode?.id ?? null} onSelect={setSelectedNode} />
          ))
        ) : null}

        {/* Export All buttons */}
        {manifest && (
          <div className="pt-3 mt-3 border-t border-border/40 space-y-1.5">
            <p className="text-[10px] font-semibold text-ink-disabled px-2 uppercase tracking-wide">Export all</p>
            <button
              onClick={exportAllMd}
              disabled={exportingAll}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-40"
            >
              {exportingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              All pages (.md)
            </button>
            <button
              onClick={exportAllHtml}
              disabled={exportingAll}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-40"
            >
              {exportingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              All pages (.html)
            </button>
          </div>
        )}
      </aside>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">

          {/* Page header with export buttons */}
          {selectedNode && (
            <div className="flex items-center justify-between mb-5 gap-3">
              <h1 className="text-lg font-bold text-ink-primary truncate">{selectedNode.label}</h1>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => refetch()}
                  className="btn-icon"
                  title="Reload"
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', contentLoading && 'animate-spin')} />
                </button>
                <button
                  onClick={exportCurrentMd}
                  disabled={!content}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border/50 text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-40"
                  title="Export this page as Markdown"
                >
                  <Download className="w-3.5 h-3.5" />
                  .md
                </button>
                <button
                  onClick={exportCurrentHtml}
                  disabled={!content}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border/50 text-ink-muted hover:text-ink-primary hover:bg-surface-elevated transition-colors disabled:opacity-40"
                  title="Export this page as HTML"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  .html
                </button>
              </div>
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
                <p className="text-xs mt-1">Make sure the backend docs volume is configured.</p>
              </div>
            )}
            {content && !contentLoading && (
              <div
                id="doc-render"
                ref={renderRef}
                className={cn(
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
                  'prose-blockquote:border-l-4 prose-blockquote:border-brand-500/40 prose-blockquote:text-ink-muted prose-blockquote:not-italic prose-blockquote:pl-4',
                  'prose-hr:border-border/50',
                )}
              >
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
