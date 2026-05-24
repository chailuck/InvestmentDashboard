'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { wsClient } from './client'
import type { WSEventType } from '@/types'

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    wsClient.connect()
    setIsConnected(wsClient.isConnected)

    const checkInterval = setInterval(() => {
      setIsConnected(wsClient.isConnected)
    }, 2000)

    return () => {
      clearInterval(checkInterval)
    }
  }, [])

  return { isConnected, wsClient }
}

export function useWSEvent<T>(event: WSEventType, handler: (payload: T) => void) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const unsub = wsClient.on<T>(event, (payload) => handlerRef.current(payload))
    return unsub
  }, [event])
}

export function useRealtimeQuote(symbol: string) {
  const [quote, setQuote] = useState<{ price: number; change: number; changePct: number } | null>(null)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)

  useWSEvent('quote_update', (payload: any) => {
    if (payload.symbol !== symbol) return
    setFlash(payload.price > (quote?.price ?? payload.price) ? 'up' : 'down')
    setQuote(payload)
    setTimeout(() => setFlash(null), 400)
  })

  return { quote, flash }
}
