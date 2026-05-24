import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/store/auth'
import type { WSEvent, WSEventType } from '@/types'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000'

class WebSocketClient {
  private socket: Socket | null = null
  private handlers: Map<WSEventType, Set<(payload: any) => void>> = new Map()
  private reconnectAttempts = 0
  private maxReconnects = 5

  connect(): void {
    if (this.socket?.connected) return

    const token = useAuthStore.getState().accessToken
    this.socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnects,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    })

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0
      console.debug('[WS] Connected:', this.socket?.id)
    })

    this.socket.on('disconnect', (reason) => {
      console.debug('[WS] Disconnected:', reason)
    })

    this.socket.on('reconnect_attempt', (attempt) => {
      this.reconnectAttempts = attempt
    })

    this.socket.on('event', (event: WSEvent) => {
      this.dispatch(event.type, event.payload)
    })

    // Subscribe to all known channels
    ;['quote_update', 'portfolio_update', 'notification', 'market_status',
      'ai_stream_token', 'ai_stream_end', 'ai_stream_error'].forEach((ch) => {
      this.socket?.on(ch, (payload: any) => this.dispatch(ch as WSEventType, payload))
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  subscribe(portfolioId: string): void {
    this.socket?.emit('subscribe', { channel: `portfolio:${portfolioId}` })
  }

  unsubscribe(portfolioId: string): void {
    this.socket?.emit('unsubscribe', { channel: `portfolio:${portfolioId}` })
  }

  on<T>(event: WSEventType, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  private dispatch(event: WSEventType, payload: any): void {
    this.handlers.get(event)?.forEach((h) => {
      try { h(payload) } catch (e) { console.error('[WS] Handler error:', e) }
    })
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false
  }

  get id(): string | undefined {
    return this.socket?.id
  }
}

export const wsClient = new WebSocketClient()
