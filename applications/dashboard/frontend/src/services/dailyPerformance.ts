import { apiClient } from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A position chip item used for open_positions, purchased_positions, and
 * sold_positions JSONB columns.  buy_price and close_price are optional for
 * backward compatibility — rows created before migration c3d4e5f6a7b8 carry
 * only {symbol, pnl, pnl_pct}.
 */
export interface PositionChip {
  symbol: string
  buy_price?: number | null
  close_price?: number | null
  pnl: number
  pnl_pct: number
}

/**
 * Legacy alias for the PUT request body.  The open_positions field in update
 * requests does not require buy_price / close_price.
 */
export interface OpenPosition {
  symbol: string
  pnl: number
  pnl_pct: number
}

export interface DailyPerformanceRecord {
  id: string
  portfolio_id: string
  date: string // ISO date YYYY-MM-DD
  investment: number
  closed_pnl: number
  closed_pnl_pct: number
  open_pnl: number
  open_pnl_pct: number
  open_positions: PositionChip[] | null
  /** Positions opened on this date (entry_date == date). Added in migration c3d4e5f6a7b8. */
  purchased_positions: PositionChip[] | null
  /** Positions closed on this date (exit_date == date). Added in migration c3d4e5f6a7b8. */
  sold_positions: PositionChip[] | null
  created_at: string | null
  updated_at: string | null
}

export interface DailyPerformanceUpdateInput {
  investment?: number
  closed_pnl?: number
  open_pnl?: number
  open_positions?: OpenPosition[]
}

export interface BackfillResult {
  status: string
  processed: number
  skipped: number
  errors: number
  start_date: string | null
  end_date: string | null
  /** Present only when no positions exist in the portfolio. */
  message?: string
}

// ─── Cash Transaction Types ───────────────────────────────────────────────────

export interface CashTransaction {
  id: string
  portfolio_id: string
  date: string // ISO date YYYY-MM-DD
  amount: number // positive = deposit, negative = withdrawal
  note: string | null
  created_at: string | null
}

export interface CashTransactionCreate {
  portfolio_id: string
  date: string
  amount: number
  note?: string
}

export interface CashTransactionUpdate {
  amount?: number
  note?: string
}

// ─── Daily Performance Service ────────────────────────────────────────────────

export const dailyPerformanceService = {
  /**
   * Fetch daily performance records for a date range.
   * GET /daily-performance?date_from=&date_to=
   */
  async getRecords(
    portfolioId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DailyPerformanceRecord[]> {
    const params: Record<string, string> = { portfolio_id: portfolioId }
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    const { data } = await apiClient.get('/daily-performance', { params })
    return data
  },

  /**
   * Trigger a real-time snapshot for today and persist it.
   * POST /daily-performance/run
   */
  async runSnapshot(portfolioId: string): Promise<DailyPerformanceRecord & { status: string }> {
    const { data } = await apiClient.post('/daily-performance/run', null, {
      params: { portfolio_id: portfolioId },
    })
    return data
  },

  /**
   * Trigger a one-time historical backfill for the given portfolio.
   * POST /daily-performance/backfill
   *
   * DESTRUCTIVE: deletes all existing records for the portfolio before
   * re-generating from scratch.  The operation is synchronous on the server
   * and may take 10–60 seconds.  A generous 120-second client timeout is applied.
   */
  async backfill(portfolioId: string, startDate?: string): Promise<BackfillResult> {
    const params: Record<string, string> = { portfolio_id: portfolioId }
    if (startDate) params.start_date = startDate
    const { data } = await apiClient.post<BackfillResult>(
      '/daily-performance/backfill',
      null,
      { params, timeout: 120_000 },
    )
    return data
  },

  /**
   * Partially update a specific day's record.
   * PUT /daily-performance/{date}
   */
  async updateRecord(
    portfolioId: string,
    date: string,
    update: DailyPerformanceUpdateInput,
  ): Promise<DailyPerformanceRecord> {
    const { data } = await apiClient.put(`/daily-performance/${date}`, update, {
      params: { portfolio_id: portfolioId },
    })
    return data
  },

  /**
   * Delete a single daily performance record.
   * DELETE /daily-performance/{date}?portfolio_id=<uuid>
   */
  async deleteRecord(date: string, portfolioId: string): Promise<void> {
    await apiClient.delete(`/daily-performance/${date}`, {
      params: { portfolio_id: portfolioId },
    })
  },
}

// ─── Portfolio Cash Transactions Service ──────────────────────────────────────

export const portfolioCashTransactionService = {
  /**
   * List all cash transactions for a portfolio, ordered by date ascending.
   * GET /portfolio-cash-transactions?portfolio_id=<uuid>
   */
  async list(portfolioId: string): Promise<CashTransaction[]> {
    const { data } = await apiClient.get('/portfolio-cash-transactions', {
      params: { portfolio_id: portfolioId },
    })
    return data
  },

  /**
   * Create a new cash transaction.
   * POST /portfolio-cash-transactions
   */
  async create(tx: CashTransactionCreate): Promise<CashTransaction> {
    const { data } = await apiClient.post('/portfolio-cash-transactions', tx)
    return data
  },

  /**
   * Update amount and/or note of an existing transaction.
   * PUT /portfolio-cash-transactions/{id}
   */
  async update(id: string, update: CashTransactionUpdate): Promise<CashTransaction> {
    const { data } = await apiClient.put(`/portfolio-cash-transactions/${id}`, update)
    return data
  },

  /**
   * Delete a cash transaction by ID.
   * DELETE /portfolio-cash-transactions/{id}
   */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/portfolio-cash-transactions/${id}`)
  },
}
