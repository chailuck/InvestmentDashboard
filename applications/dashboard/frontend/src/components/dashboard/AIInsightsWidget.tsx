'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, Sparkles, RefreshCw } from 'lucide-react'
import { useWSEvent } from '@/websocket/hooks'
import { apiClient } from '@/services/api'
import { cn } from '@/lib/utils'
import type { WidgetConfig, ChatMessage } from '@/types'

export function AIInsightsWidget({ config }: { config: WidgetConfig }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: '0',
    role: 'assistant',
    content: "I'm your AI investment analyst. I can explain portfolio performance, risk metrics, and market trends. What would you like to know?",
    timestamp: new Date().toISOString(),
  }])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamingIdRef = useRef<string | null>(null)

  // Receive streaming tokens from WebSocket
  useWSEvent<{ session_id: string; token: string }>('ai_stream_token', ({ session_id, token }) => {
    if (session_id !== streamingIdRef.current) return
    setMessages(prev =>
      prev.map(m =>
        m.id === session_id
          ? { ...m, content: m.content + token }
          : m
      )
    )
  })

  useWSEvent<{ session_id: string }>('ai_stream_end', ({ session_id }) => {
    if (session_id !== streamingIdRef.current) return
    setIsStreaming(false)
    setMessages(prev =>
      prev.map(m => m.id === session_id ? { ...m, isStreaming: false } : m)
    )
    streamingIdRef.current = null
  })

  useWSEvent<{ session_id: string; error: string }>('ai_stream_error', ({ session_id, error }) => {
    if (session_id !== streamingIdRef.current) return
    setIsStreaming(false)
    streamingIdRef.current = null
  })

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return
    const text = input.trim()
    setInput('')

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)

    try {
      const { data } = await apiClient.post('/ai/copilot/chat', { message: text })
      const sessionId = data.session_id
      streamingIdRef.current = sessionId

      const assistantMsg: ChatMessage = {
        id: sessionId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setIsStreaming(false)
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      }])
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const QUICK_PROMPTS = [
    'Portfolio health summary',
    'Biggest risk factors',
    'Top performing holdings',
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('flex gap-2', msg.role === 'user' && 'justify-end')}
            >
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-brand-500/15 border border-brand-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3 h-3 text-brand-400" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] text-xs rounded-xl px-3 py-2 leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-brand-500/20 text-ink-primary rounded-br-sm'
                    : 'bg-surface-elevated text-ink-secondary rounded-bl-sm'
                )}
              >
                {msg.content}
                {msg.isStreaming && (
                  <span className="inline-block w-1 h-3 bg-brand-400 ml-0.5 animate-pulse rounded-sm" />
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 2 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => { setInput(p); }}
              className="text-[10px] px-2 py-1 rounded-full border border-border/60 text-ink-muted hover:text-ink-secondary hover:border-border transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/40 p-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask about your portfolio…"
          disabled={isStreaming}
          className="input py-1.5 text-xs flex-1"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isStreaming}
          className={cn(
            'btn-icon shrink-0',
            input.trim() && !isStreaming && 'text-brand-400 hover:text-brand-300'
          )}
        >
          {isStreaming
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />
          }
        </button>
      </div>
    </div>
  )
}
