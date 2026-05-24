'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, Trash2, ChevronDown, Loader2, Wrench, User, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ──────────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  toolCalls?: string[]
  isStreaming?: boolean
}

// ── Quick command suggestions ──────────────────────────────────────────────────

const QUICK_COMMANDS = [
  { label: '/portList', description: 'Show open positions' },
  { label: '/portAction', description: 'Get action recommendations' },
  { label: '/portHist', description: 'Portfolio performance history' },
  { label: '/analyze PTT', description: 'Analyze a stock (replace PTT)' },
]

// ── Tool call indicator ────────────────────────────────────────────────────────

function ToolCallBadge({ name, done }: { name: string; done: boolean }) {
  const labels: Record<string, string> = {
    get_portfolio_positions: 'Reading positions',
    get_live_price: 'Fetching price',
    get_performance_summary: 'Loading performance',
    read_knowledge_doc: 'Reading knowledge base',
    run_analysis_script: 'Running analysis',
  }
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border font-medium transition-all',
      done
        ? 'text-gain border-gain/30 bg-gain/5'
        : 'text-brand-400 border-brand-500/30 bg-brand-500/5',
    )}>
      {done ? (
        <span className="w-1.5 h-1.5 rounded-full bg-gain" />
      ) : (
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
      )}
      {labels[name] ?? name}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-3 max-w-full', isUser && 'flex-row-reverse')}
    >
      {/* Avatar */}
      <div className={cn(
        'w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5',
        isUser
          ? 'bg-gradient-to-br from-brand-400 to-purple-400 text-white'
          : 'bg-surface-elevated border border-border/60 text-brand-400',
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Content */}
      <div className={cn('flex flex-col gap-1.5 min-w-0', isUser ? 'items-end' : 'items-start')}>
        {/* Tool badges */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.toolCalls.map((tc, i) => {
              const [name, state] = tc.split(':')
              return <ToolCallBadge key={i} name={name} done={state === 'done'} />
            })}
          </div>
        )}

        {/* Text bubble */}
        {(msg.content || msg.isStreaming) && (
          <div className={cn(
            'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed max-w-[75ch]',
            isUser
              ? 'bg-brand-500/15 border border-brand-500/20 text-ink-primary rounded-tr-sm'
              : 'bg-surface-card border border-border/50 text-ink-primary rounded-tl-sm',
          )}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none
                [&_table]:border-collapse [&_table]:w-full [&_table]:text-xs
                [&_th]:border [&_th]:border-border/50 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-surface-elevated [&_th]:font-semibold
                [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1
                [&_tr:nth-child(even)_td]:bg-surface-elevated/30
                [&_code]:bg-surface-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-brand-300 [&_code]:text-xs
                [&_pre]:bg-surface-elevated [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto
                [&_strong]:text-ink-primary [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm
                [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4
                [&_li]:my-0.5 [&_p]:my-1 [&_hr]:border-border/40">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                {msg.isStreaming && (
                  <span className="inline-block w-0.5 h-3.5 bg-brand-400 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AICopilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { accessToken } = useAuthStore()

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
    }
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsLoading(true)
    setShowCommands(false)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`${BASE_URL}/api/v1/ai/copilot/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message: text.trim(), session_id: sessionId }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const newSid = res.headers.get('X-Session-Id')
      if (newSid) setSessionId(newSid)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Track tool calls per assistant message
      const activeTools = new Map<string, boolean>()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let event: any
          try { event = JSON.parse(raw) } catch { continue }

          if (event.type === 'text') {
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: m.content + event.content }
                : m
            ))
          } else if (event.type === 'tool_start') {
            activeTools.set(event.name, false)
            const toolSnapshot = Array.from(activeTools.entries()).map(([n, d]) => `${n}:${d ? 'done' : 'pending'}`)
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id ? { ...m, toolCalls: toolSnapshot } : m
            ))
          } else if (event.type === 'tool_end') {
            activeTools.set(event.name, true)
            const toolSnapshot = Array.from(activeTools.entries()).map(([n, d]) => `${n}:${d ? 'done' : 'pending'}`)
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id ? { ...m, toolCalls: toolSnapshot } : m
            ))
          } else if (event.type === 'done') {
            if (event.session_id) setSessionId(event.session_id)
          } else if (event.type === 'error') {
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: `**Error:** ${event.content}`, isStreaming: false }
                : m
            ))
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: `**Connection error:** ${err.message}`, isStreaming: false }
          : m
      ))
    } finally {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ))
      setIsLoading(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }, [accessToken, isLoading, sessionId])

  const clearSession = useCallback(async () => {
    if (sessionId && accessToken) {
      try {
        await fetch(`${BASE_URL}/api/v1/ai/copilot/session/${sessionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      } catch {}
    }
    setMessages([])
    setSessionId(null)
  }, [sessionId, accessToken])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
    if (e.key === 'Escape') setShowCommands(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    setShowCommands(val.startsWith('/') && val.length <= 20)
  }

  // Auto-resize textarea
  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-surface-card/60 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-ink-primary">AI Copilot</h1>
            <p className="text-[11px] text-ink-muted">
              {sessionId ? `Session active` : 'Powered by Claude · InvestmentAgent01'}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearSession}
            className="btn-icon text-ink-muted hover:text-loss"
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
              <Bot className="w-8 h-8 text-brand-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink-primary mb-1">Investment AI Copilot</h2>
              <p className="text-sm text-ink-muted max-w-sm">
                Ask about your portfolio, get analysis, or use skill commands to run analysis scripts.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
              {QUICK_COMMANDS.map(cmd => (
                <button
                  key={cmd.label}
                  onClick={() => sendMessage(cmd.label)}
                  className="text-left px-3 py-2.5 rounded-xl border border-border/50 bg-surface-card hover:border-brand-500/40 hover:bg-brand-500/5 transition-all group"
                >
                  <p className="text-xs font-mono font-semibold text-brand-400 group-hover:text-brand-300">
                    {cmd.label}
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">{cmd.description}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
            </AnimatePresence>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border/50 bg-surface-card/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-4xl mx-auto relative">
          {/* Command autocomplete */}
          <AnimatePresence>
            {showCommands && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute bottom-full mb-2 left-0 right-0 bg-surface-card border border-border/60 rounded-xl overflow-hidden shadow-xl z-20"
              >
                {QUICK_COMMANDS.filter(c => c.label.startsWith(input)).map(cmd => (
                  <button
                    key={cmd.label}
                    onClick={() => { setInput(cmd.label); setShowCommands(false); inputRef.current?.focus() }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated text-left transition-colors"
                  >
                    <span className="text-xs font-mono font-semibold text-brand-400">{cmd.label}</span>
                    <span className="text-xs text-ink-muted">{cmd.description}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your portfolio, or type / for commands…"
                rows={1}
                disabled={isLoading}
                className="w-full resize-none rounded-xl border border-border/60 bg-surface-elevated
                           text-sm text-ink-primary placeholder:text-ink-disabled
                           px-4 py-2.5 pr-12 focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20
                           disabled:opacity-50 transition-all leading-relaxed"
                style={{ minHeight: '44px', maxHeight: '160px' }}
              />
              {isLoading && (
                <div className="absolute right-3 bottom-2.5">
                  <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                </div>
              )}
            </div>

            <button
              onClick={() => isLoading ? abortRef.current?.abort() : sendMessage(input)}
              disabled={!input.trim() && !isLoading}
              title={isLoading ? 'Stop generation' : 'Send message (Enter)'}
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0',
                isLoading
                  ? 'bg-loss/20 border border-loss/30 text-loss hover:bg-loss/30'
                  : input.trim()
                    ? 'bg-brand-500 text-white hover:bg-brand-400 shadow-sm shadow-brand-500/20'
                    : 'bg-surface-elevated border border-border/50 text-ink-disabled cursor-not-allowed',
              )}
            >
              {isLoading ? (
                <span className="w-3 h-3 rounded-sm bg-current" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>

          <p className="text-[10px] text-ink-disabled mt-1.5 text-center">
            Enter to send · Shift+Enter for new line · Type / for commands
          </p>
        </div>
      </div>
    </div>
  )
}
