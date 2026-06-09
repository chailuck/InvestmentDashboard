/* ──────────────────────────────────────────────────────────
   Shared TypeScript types for the Investment Dashboard
   ────────────────────────────────────────────────────────── */

// ── Auth ──────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'analyst' | 'viewer'
  avatar?: string
  createdAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface UserDetail {
  id: string
  email: string
  name: string
  role: 'admin' | 'analyst' | 'viewer'
  is_active: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface UserListResponse {
  users: UserDetail[]
  total: number
}

// ── Portfolio ─────────────────────────────────────────────
export interface Portfolio {
  id: string
  name: string
  totalValue: number
  dailyPnl: number
  dailyPnlPct: number
  totalReturn: number
  totalReturnPct: number
  cash: number
  holdings: Holding[]
  lastUpdated: string
}

export interface Holding {
  id: string
  portfolioId: string
  symbol: string
  name: string
  quantity: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  weight: number
  sector: string
  assetClass: AssetClass
  dayChange: number
  dayChangePct: number
}

export type AssetClass = 'equity' | 'fixed_income' | 'crypto' | 'commodity' | 'cash' | 'alternative'

// ── Market Data ───────────────────────────────────────────
export interface Quote {
  symbol: string
  price: number
  change: number
  changePct: number
  volume: number
  high: number
  low: number
  open: number
  prevClose: number
  timestamp: string
}

export interface OHLCV {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketIndex {
  symbol: string
  name: string
  value: number
  change: number
  changePct: number
}

// ── Analytics ─────────────────────────────────────────────
export interface PortfolioMetrics {
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  volatility: number
  beta: number
  alpha: number
  var95: number
  var99: number
  calmarRatio: number
  informationRatio: number
}

export interface PerformanceSeries {
  date: string
  portfolioValue: number
  benchmarkValue: number
  return: number
  benchmarkReturn: number
}

export interface AllocationData {
  name: string
  value: number
  pct: number
  color?: string
}

// ── AI Copilot ────────────────────────────────────────────
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  isStreaming?: boolean
  metadata?: {
    sources?: string[]
    confidence?: number
    tokens?: number
  }
}

export interface CopilotSession {
  sessionId: string
  messages: ChatMessage[]
  createdAt: string
  portfolioContext?: string
}

// ── Notifications ─────────────────────────────────────────
export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error' | 'alert'
  title: string
  message: string
  timestamp: string
  read: boolean
  actionUrl?: string
}

// ── WebSocket Events ──────────────────────────────────────
export type WSEventType =
  | 'quote_update'
  | 'portfolio_update'
  | 'notification'
  | 'market_status'
  | 'ai_stream_token'
  | 'ai_stream_end'
  | 'ai_stream_error'

export interface WSEvent<T = unknown> {
  type: WSEventType
  payload: T
  timestamp: string
}

// ── Dashboard Widgets ─────────────────────────────────────
export interface WidgetConfig {
  id: string
  type: WidgetType
  title: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  settings?: Record<string, unknown>
}

export type WidgetType =
  | 'portfolio_summary'
  | 'portfolio_chart'
  | 'holdings_table'
  | 'market_ticker'
  | 'ai_insights'
  | 'allocation_chart'
  | 'risk_metrics'
  | 'performance_chart'
  | 'watchlist'
  | 'news_feed'
  | 'market_pulse'
  | 'scan_heat_tile'
  | 'pnl_waterfall'
  | 'trading_history_summary'
  | 'investment_balance'

// ── API ───────────────────────────────────────────────────
export interface ApiError {
  type: string
  title: string
  status: number
  detail: string
  instance?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

// ── File Upload ───────────────────────────────────────────
export interface UploadedFile {
  id: string
  filename: string
  size: number
  status: 'processing' | 'completed' | 'failed'
  portfolioId?: string
  rowsImported?: number
  errors?: string[]
  createdAt: string
}
