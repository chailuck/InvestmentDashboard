# Dashboard — Technical Design

---

## 1. Files

```
frontend/src/app/(dashboard)/dashboard/page.tsx
frontend/src/components/dashboard/AllocationChartWidget.tsx
frontend/src/components/dashboard/PortfolioSummaryWidget.tsx
frontend/src/components/dashboard/PortfolioChartWidget.tsx
frontend/src/components/dashboard/HoldingsTableWidget.tsx
frontend/src/components/dashboard/AIInsightsWidget.tsx
frontend/src/components/dashboard/RiskMetricsWidget.tsx
frontend/src/components/analytics/EChartsChart.tsx          — shared candlestick chart component
frontend/src/components/analytics/AnalyticsModal.tsx        — full-screen analytics modal (ECharts-backed)
```

---

## 2. Allocation Chart

**File:** `frontend/src/components/dashboard/AllocationChartWidget.tsx`

```typescript
const { data } = useQuery({
  queryKey: ['portfolio-positions', 'active'],
  queryFn: () => portfolioTrackerService.getPositions({ status: 'active' }),
  refetchInterval: 60_000,
})

// Compute allocation per symbol
const slices = positions.reduce((acc, pos) => {
  const value = pos.currentPrice * pos.positionSize
  acc[pos.symbol] = (acc[pos.symbol] ?? 0) + value
  return acc
}, {} as Record<string, number>)

// ECharts donut option
const option = {
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    data: Object.entries(slices).map(([name, value]) => ({ name, value }))
  }]
}
```

---

## 3. Market Indices

**Backend:** `GET /api/v1/portfolio-tracker/market/set-indices` and `/market/global-indices`

**Service:** `backend/app/services/portfolio_excel.py`

```python
SET_TICKERS = ["^SET.BK", "^SET50.BK", "^SET100.BK", "^MAI.BK", "^sSET.BK"]
GLOBAL_TICKERS = ["^GSPC", "^IXIC", "^DJI", "BTC-USD", "GC=F"]

def fetch_set_indices():
    quotes = _yahoo_quote_direct(SET_TICKERS)
    return [{"name": ..., "value": ..., "change": ..., "changePct": ...} for t in SET_TICKERS]

def _yahoo_quote_direct(tickers):
    url = "https://query1.finance.yahoo.com/v7/finance/quote"
    params = {"symbols": ",".join(tickers), "fields": "regularMarketPrice,regularMarketChange,regularMarketChangePercent"}
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, params=params, timeout=10)
    results = resp.json()["quoteResponse"]["result"]
    return {r["symbol"]: r for r in results}
```

---

## 4. EChartsChart Component

**File:** `frontend/src/components/analytics/EChartsChart.tsx`

A reusable full-featured OHLCV candlestick chart powered by `echarts-for-react`. Renders four vertically stacked panels sharing a synchronised x-axis: candlestick + VRVP, volume, RSI, and Stochastic.

```typescript
import { EChartsChart, type ChartInterval } from '@/components/analytics/EChartsChart'

<EChartsChart
  symbol="GULF"
  assetType="SET"        // passed to analyticsService for data fetching
  interval="1d"          // '1h' | '4h' | '1d' | '1wk'
  onIntervalChange={setInterval}
  height={400}           // pixel height of the chart container
/>
```

**Exported types:**

```typescript
export type ChartInterval = '1h' | '4h' | '1d' | '1wk'
export type ChartRange    = '6mo' | '1y' | '2y' | '2.5y'
```

The component manages its own range state internally. The `zoomStartForRange` helper computes the ECharts `dataZoom.start` percentage so the visible window covers the last N calendar days regardless of how many candles are in the dataset.

See `docs/09-weekly-scan/TECHNICAL.md` Section 8 for the full chart option builder and VRVP implementation details.

---

## 5. PortfolioSummaryWidget

**File:** `frontend/src/components/dashboard/PortfolioSummaryWidget.tsx`

Renders four animated metric cards. Uses `portfolioTrackerService.getPositions({ status: 'active' })` via TanStack Query (`refetchInterval: 60_000`). THB values are compacted via `fmtTHB`:

```typescript
function fmtTHB(n: number) {
  const sign = n >= 0 ? '+' : ''
  if (Math.abs(n) >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(2)}M ฿`
  if (Math.abs(n) >= 1_000)     return `${sign}${(n / 1_000).toFixed(1)}K ฿`
  return `${sign}${n.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`
}
```

Each metric card uses `motion.div` with `initial={{ opacity: 0, y: 8 }}` entry animation. The value inside each card uses `AnimatePresence` with a slide-up exit/enter transition so value changes are visually apparent on data refresh.

---

## 6. PortfolioChartWidget — Range + Granularity Controls

**File:** `frontend/src/components/dashboard/PortfolioChartWidget.tsx`

> ℹ️ Frontend-only change. No backend, database, or API contract change — `GET /portfolio-tracker/performance`'s `period` query param already accepted `daily` / `weekly` / `monthly` before this feature; see `backend/app/api/v1/endpoints/portfolio_tracker.py` (`get_performance`, mapped to `get_daily_performance` in `portfolio_excel.py`, or to the DB-mode equivalent in `portfolio_db.py`).

### 6.1 State

Two independent pieces of state, typed as string unions:

```typescript
type Period      = '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD'
type Granularity = 'daily' | 'weekly' | 'monthly'

const [period, setPeriod]           = useState<Period>('3M')
const [granularity, setGranularity] = useState<Granularity>(periodToParams('3M').period)
```

`periodToParams(period)` is the single source of truth mapping a range preset to both its `from_date` window and its implied `period` (granularity) value — the same function used for the initial default, the mount-time fallback, and the range-change reset, so the "implied granularity per range" rule only exists in one place.

### 6.2 Persistence — two localStorage keys

```typescript
const PERIOD_KEY      = 'perf-widget-period'       // pre-existing
const GRANULARITY_KEY = 'perf-widget-granularity'  // new
```

On mount, a `useEffect` reads both keys independently:
- `PERIOD_KEY` — if present and a valid `Period`, overrides the `period` state.
- `GRANULARITY_KEY` — if present and a valid `Granularity`, overrides the `granularity` state. If absent or invalid (e.g. cleared/corrupted localStorage, or a value from a future app version not in the current union), it falls back to `periodToParams(effectivePeriod).period` — the granularity implied by the *effective* (possibly just-restored) period, not the component's initial default. This keeps a restored range and a missing/bad granularity value internally consistent instead of pairing a restored "1Y" range with a stale "daily" default.

### 6.3 Query key and data fetching

```typescript
const { from_date } = periodToParams(period)
const toDate = format(new Date(), 'yyyy-MM-dd')

const { data = [], isLoading } = useQuery({
  queryKey: ['dashboard-performance', from_date, granularity],
  queryFn: () => portfolioTrackerService.getPerformance({ from_date, to_date: toDate, period: granularity }),
  refetchInterval: 5 * 60_000,
  staleTime: 60_000,
})
```

`granularity` — not `period` (the range enum) — is passed as the `period` query param to the backend, and both `from_date` and `granularity` are part of the TanStack Query cache key. This matters for the rapid-click race condition covered by QA: each distinct `(from_date, granularity)` pair gets its own cache entry, so an in-flight request for a previously-selected combination cannot resolve after the fact and overwrite the chart with stale data for the combination the user is now viewing — TanStack Query keeps them in separate cache slots rather than one shared "latest response" slot.

### 6.4 Why the range-reset lives in the click handler, not a `useEffect` keyed on `period`

`handlePeriod` performs the reset synchronously and inline:

```typescript
const handlePeriod = (p: Period) => {
  const derived = periodToParams(p).period
  setPeriod(p)
  setGranularity(derived)
  localStorage.setItem(PERIOD_KEY, p)
  localStorage.setItem(GRANULARITY_KEY, derived)
}
```

An alternative design would keep `handlePeriod` setting only `period`, and add a separate `useEffect(() => setGranularity(periodToParams(period).period), [period])` to enforce the reset. That was deliberately avoided: React 18 batches the two `setState` calls inside one event handler into a single re-render, so the query key (`['dashboard-performance', from_date, granularity]`) only ever changes once per click, producing exactly one network request. A `useEffect` keyed on `period` would still batch with the handler's own `setPeriod` in practice under React 18's automatic batching, but it splits one conceptual state transition ("user picked a new range, which resets granularity") across two separate update sites (the handler and the effect), which is harder to reason about and is more fragile if either update path is ever changed to something async (e.g. wrapped in a `startTransition`, a timeout, or a non-React event source) where the two updates could then land in separate render passes and briefly fetch with a mismatched (old granularity, new range) combination before the effect catches up — an extra, avoidable fetch. Keeping both `setState` calls colocated in the same handler makes the "one user action → one state transition → one fetch" invariant explicit and independent of batching internals.

`handleGranularity`, by contrast, only ever touches `granularity` — it has no reset behavior to coordinate, so it is a plain single-state setter:

```typescript
const handleGranularity = (g: Granularity) => {
  setGranularity(g)
  localStorage.setItem(GRANULARITY_KEY, g)
}
```

### 6.5 Empty state

Unchanged: `data.length === 0` renders the existing generic message ("No realized P&L data for this period."). No new UI states were added for this feature.

### 6.6 Testing

Covered by `frontend/src/components/dashboard/__tests__/PortfolioChartWidget.test.tsx` (11 Vitest/RTL tests): default-granularity-from-range, range-change reset, independent manual override, persistence of both localStorage keys, corrupted/invalid localStorage value fallback, sparse-data/empty-state rendering, and a rapid-click test asserting the per-key query cache prevents a stale response from clobbering the active selection.

---

## 7. Dashboard Layout

**File:** `frontend/src/app/(dashboard)/layout.tsx`

```typescript
export default function DashboardLayout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  )
}
```

The layout uses CSS grid for the widget arrangement on the dashboard page. The actual widget layout is in `dashboard/page.tsx`.
