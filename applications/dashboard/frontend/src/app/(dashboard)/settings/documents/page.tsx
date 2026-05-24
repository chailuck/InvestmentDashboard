'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDocContent } from '@/services/appConfig'

type DocTab = 'requirements' | 'design'

const TABS: { key: DocTab; label: string }[] = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'design', label: 'Technical Design' },
]

export default function DocumentsPage() {
  const [active, setActive] = useState<DocTab>('requirements')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['doc', active],
    queryFn: () => getDocContent(active),
  })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary flex items-center gap-2">
            <FileText className="w-5 h-5 text-brand-400" />
            Documentation
          </h1>
          <p className="text-ink-muted text-sm mt-0.5">Project requirements and technical design documents</p>
        </div>
        <button onClick={() => refetch()} className="btn-icon" title="Reload">
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActive(tab.key)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              active === tab.key
                ? 'border-brand-400 text-brand-400'
                : 'border-transparent text-ink-muted hover:text-ink-primary')}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="card p-6 md:p-8">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="skeleton h-4 rounded" style={{ width: `${55 + (i % 4) * 12}%` }} />
            ))}
          </div>
        )}
        {isError && (
          <div className="text-center py-10 text-ink-muted">
            <p className="text-sm">Could not load document.</p>
            <p className="text-xs mt-1">Make sure the backend docs volume mount is configured.</p>
          </div>
        )}
        {data && (
          <div className={cn(
            'prose prose-invert prose-sm max-w-none',
            // Headings
            'prose-headings:text-ink-primary prose-headings:font-bold prose-headings:tracking-tight',
            'prose-h1:text-2xl prose-h1:mb-4',
            'prose-h2:text-xl prose-h2:border-b prose-h2:border-border/50 prose-h2:pb-2 prose-h2:mt-8',
            'prose-h3:text-base prose-h3:text-brand-400 prose-h3:mt-6',
            // Body text
            'prose-p:text-ink-secondary prose-p:leading-7',
            // Links
            'prose-a:text-brand-400 prose-a:no-underline hover:prose-a:underline',
            // Code
            'prose-code:text-brand-300 prose-code:bg-surface-elevated prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none',
            'prose-pre:bg-surface-elevated prose-pre:border prose-pre:border-border/50 prose-pre:rounded-lg',
            // Tables
            'prose-table:text-xs prose-table:border-collapse',
            'prose-thead:bg-surface-elevated',
            'prose-th:text-ink-muted prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-border/50',
            'prose-td:text-ink-secondary prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-border/30',
            'prose-tr:border-b prose-tr:border-border/30 even:prose-tr:bg-surface-elevated/30',
            // Lists
            'prose-ul:text-ink-secondary prose-ul:space-y-1',
            'prose-ol:text-ink-secondary prose-ol:space-y-1',
            'prose-li:marker:text-ink-muted',
            // Other
            'prose-strong:text-ink-primary prose-strong:font-semibold',
            'prose-em:text-ink-secondary',
            'prose-blockquote:border-l-4 prose-blockquote:border-brand-500/40 prose-blockquote:text-ink-muted prose-blockquote:not-italic prose-blockquote:pl-4',
            'prose-hr:border-border/50',
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {data.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
