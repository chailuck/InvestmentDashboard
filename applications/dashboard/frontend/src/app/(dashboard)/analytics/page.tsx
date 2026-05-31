'use client'

import { useState } from 'react'
import { Search, BarChart2, TrendingUp, TrendingDown, AlertCircle, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { analyticsService, type AssetType, type SearchResult } from '@/services/analytics'
import { AnalyticsModal } from '@/components/analytics/AnalyticsModal'

// ── Asset type tabs ───────────────────────────────────────────────────────────

const ASSET_TYPES: { label: string; value: AssetType; color: string }[] = [
  { label: 'SET', value: 'SET', color: 'text-brand-400 border-brand-500/30 bg-brand-500/10' },
  { label: 'CRYPTO', value: 'CRYPTO', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  { label: 'DR', value: 'DR', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
]

// ── Search history ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  symbol: string
  assetType: AssetType
  result: SearchResult
  searchedAt: Date
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [query, setQuery] = useState('')
  const [assetType, setAssetType] = useState<AssetType>('SET')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<HistoryEntry[]>([])
  const [modalSymbol, setModalSymbol] = useState<{ symbol: string; assetType: AssetType } | null>(null)

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = query.trim().toUpperCase()
    if (!q) return

    setSearching(true)
    setSearchError(null)
    try {
      const result = await analyticsService.search(q, assetType)
      // Add to history (deduplicate by symbol+type)
      setResults(prev => {
        const filtered = prev.filter(r => !(r.symbol === q && r.assetType === assetType))
        return [{ symbol: q, assetType, result, searchedAt: new Date() }, ...filtered].slice(0, 20)
      })
      if (result.found) {
        setModalSymbol({ symbol: q, assetType })
      } else {
        setSearchError(`Symbol "${q}" not found on ${assetType}.`)
      }
    } catch {
      setSearchError('Search failed. Check your connection.')
    } finally {
      setSearching(false)
    }
  }

  const activeType = ASSET_TYPES.find(t => t.value === assetType)!

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink-primary flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-brand-400" />
          Analytics
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Search SET, CRYPTO, or DR symbols for technical analysis and chart data.
        </p>
      </div>

      {/* Search card */}
      <div className="card p-5 space-y-4">
        {/* Asset type tabs */}
        <div className="flex gap-2">
          {ASSET_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setAssetType(t.value)}
              className={cn(
                'px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                assetType === t.value ? t.color : 'text-ink-muted border-border hover:text-ink-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              placeholder={assetType === 'SET' ? 'e.g. BBCP, AOT, KBANK' : assetType === 'CRYPTO' ? 'e.g. BTC, ETH, SOL' : 'e.g. GOLD, OIL'}
              className="input pl-9 text-sm font-mono uppercase"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="btn-primary px-5 py-2 text-sm flex items-center gap-2"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </form>

        {searchError && (
          <div className="flex items-center gap-2 text-xs text-loss bg-loss/8 border border-loss/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {searchError}
          </div>
        )}
      </div>

      {/* Search history / results */}
      {results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">Search Results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-surface-elevated/30">
                  {['Symbol', 'Name', 'Market', 'Price', 'Change', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-ink-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((entry, i) => {
                  const r = entry.result
                  const typeStyle = ASSET_TYPES.find(t => t.value === entry.assetType)?.color ?? ''
                  return (
                    <tr key={i} className="border-b border-border/20 hover:bg-surface-elevated/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setModalSymbol({ symbol: entry.symbol, assetType: entry.assetType })}
                          className="font-bold text-ink-primary hover:text-brand-400 transition-colors font-mono"
                        >
                          {entry.symbol}
                        </button>
                        {r.ticker && r.ticker !== entry.symbol && (
                          <div className="text-[10px] text-ink-disabled font-mono">{r.ticker}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-secondary max-w-[160px] truncate" title={r.name}>
                        {r.name || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', typeStyle)}>
                            {entry.assetType}
                          </span>
                          {r.exchange && (
                            <span className="text-[10px] text-ink-muted font-medium px-1.5 py-0.5 rounded border border-border/50 bg-surface-elevated">
                              {r.exchange}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-primary font-medium">
                        {r.price != null ? r.price.toFixed(4) : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {r.change_pct != null ? (
                          <span className={cn('flex items-center gap-1', r.change_pct >= 0 ? 'text-gain' : 'text-loss')}>
                            {r.change_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {r.change_pct >= 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.found
                          ? <span className="text-gain text-[10px] font-medium">Found</span>
                          : <span className="text-ink-disabled text-[10px]">Not found</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.found && (
                          <button
                            onClick={() => setModalSymbol({ symbol: entry.symbol, assetType: entry.assetType })}
                            className="text-xs text-brand-400 hover:text-brand-300 transition-colors font-medium"
                          >
                            View →
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analytics modal */}
      <AnimatePresence>
        {modalSymbol && (
          <AnalyticsModal
            symbol={modalSymbol.symbol}
            assetType={modalSymbol.assetType}
            onClose={() => setModalSymbol(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
