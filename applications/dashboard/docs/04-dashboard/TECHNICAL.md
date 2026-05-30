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

## 4. Dashboard Layout

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
