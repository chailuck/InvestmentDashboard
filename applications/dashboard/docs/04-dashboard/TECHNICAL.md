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

## 6. Dashboard Layout

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
