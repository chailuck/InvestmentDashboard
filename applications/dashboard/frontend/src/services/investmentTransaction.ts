import { apiClient } from './api'

export type InvestmentAction = 'CASH_IN' | 'CASH_OUT' | 'ADJUST'

export const INVESTMENT_ACTIONS: { value: InvestmentAction; label: string; color: string }[] = [
  { value: 'CASH_IN',  label: 'Cash In',  color: 'text-gain' },
  { value: 'CASH_OUT', label: 'Cash Out', color: 'text-loss' },
  { value: 'ADJUST',   label: 'Adjust',   color: 'text-amber-400' },
]

export interface InvestmentTransaction {
  id: string
  portfolio_id: string
  user_id: string
  date: string
  action: InvestmentAction
  amount: number
  currency: string
  note: string | null
  created_at: string | null
  updated_at: string | null
}

export interface TransactionSummary {
  total_cash_in: number
  total_cash_out: number
  total_adjust: number
  net_investment: number
}

export interface TransactionListResponse {
  transactions: InvestmentTransaction[]
  total: number
  summary: TransactionSummary
}

export interface TransactionCreate {
  portfolio_id: string
  date: string
  action: InvestmentAction
  amount: number
  currency?: string
  note?: string | null
}

export interface TransactionUpdate {
  date?: string
  action?: InvestmentAction
  amount?: number
  currency?: string
  note?: string | null
}

export const investmentTransactionService = {
  async list(params: {
    portfolio_id?: string
    from_date?: string
    to_date?: string
    action?: InvestmentAction
  } = {}): Promise<TransactionListResponse> {
    const { data } = await apiClient.get('/investment-transactions', { params })
    return data
  },

  async create(body: TransactionCreate): Promise<InvestmentTransaction> {
    const { data } = await apiClient.post('/investment-transactions', body)
    return data
  },

  async update(id: string, body: TransactionUpdate): Promise<InvestmentTransaction> {
    const { data } = await apiClient.put(`/investment-transactions/${id}`, body)
    return data
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/investment-transactions/${id}`)
  },
}
