# Portfolio Tracker — Technical Design

---

## 1. Files

```
backend/app/api/v1/endpoints/portfolio_tracker.py   ← API endpoints
backend/app/services/portfolio_excel.py              ← All business logic
frontend/src/services/portfolioTracker.ts            ← Frontend API service
frontend/src/app/(dashboard)/portfolio/page.tsx      ← Page component
```

---

## 2. Excel Service (`portfolio_excel.py`)

### 2.1 Path Resolution

Two paths are used:

| Path | Purpose | Source |
|------|---------|--------|
| Source path | Read-only original Excel (user's machine via volume mount) | `get_app_config()` or `settings.investment_excel_source_path` |
| Working path | Writable copy in `/app/uploads/` | `get_app_config()` or `settings.investment_excel_path` |

```python
def _source_path() -> Path:
    cfg = get_app_config()
    return Path(cfg.get("excel_source_path") or settings.investment_excel_source_path)

def _working_path() -> Path:
    cfg = get_app_config()
    return Path(cfg.get("excel_working_path") or settings.investment_excel_path)
```

Settings → App Configuration writes to a JSON file (`/app/uploads/app_config.json`) which takes precedence over env vars.

### 2.2 Cache System

In-memory per-worker cache with cross-worker invalidation via a filesystem sentinel file:

```python
_CACHE: dict = {}
_CACHE_BUST_FILE = Path("/app/uploads/.cache_bust")

def _cache_bust_ts() -> float:
    try: return _CACHE_BUST_FILE.stat().st_mtime
    except OSError: return 0.0

def _write_cache_bust():
    _CACHE_BUST_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_BUST_FILE.write_text(str(time.time()))

def _cached(key: str, ttl: float, fn: Callable) -> Any:
    now = time.time()
    bust = _cache_bust_ts()
    entry = _CACHE.get(key)
    if entry and (now - entry[0] < ttl) and (entry[0] > bust):
        return entry[1]
    val = fn()
    _CACHE[key] = (now, val)
    return val
```

When the refresh endpoint is called, `_write_cache_bust()` is called, which causes all 4 Uvicorn workers to invalidate their caches on the next request.

### 2.3 DataFrame Loading

```python
def _load_df() -> pd.DataFrame:
    path = _ensure_working_copy()
    df = pd.read_excel(str(path), sheet_name="Sheet1")
    # Normalize column names (strip whitespace, handle variations)
    # Parse date columns
    # Detect open positions: Exit Price is NaN or "NOT SELL"
    df["_is_open"] = df["Exit Price"].isna() | (df["Exit Price"].astype(str).str.strip() == "NOT SELL")
    return df
```

### 2.4 Live Prices

```python
def fetch_live_prices(symbols: list[str]) -> dict[str, float]:
    tickers = [s + ".BK" if not s.endswith(".BK") else s for s in symbols]
    quotes = _yahoo_quote_direct(tickers)
    return {s: quotes.get(s + ".BK", {}).get("regularMarketPrice") for s in symbols}
```

Uses Yahoo Finance quote API directly (`v7/finance/quote`) instead of yfinance library for speed.

### 2.5 P&L Calculation

```python
def _calc_pnl(row, live_prices):
    symbol = row["Symbol"]
    entry = float(row["Entry Price"])
    size = int(row["Position Size"])
    is_long = "short" not in str(row.get("Direction", "")).lower()

    if row["_is_open"]:
        current = live_prices.get(symbol, entry)
    else:
        current = float(row["Exit Price"])

    if is_long:
        net_pnl = (current - entry) * size
    else:
        net_pnl = (entry - current) * size

    pnl_pct = (net_pnl / (entry * size)) * 100 if entry and size else 0
    return current, net_pnl, pnl_pct
```

### 2.6 Performance Aggregation

`get_daily_performance()` groups closed positions by Exit Date and open positions by today's date, then computes `dailyPnl` and `cumulativePnl`:

```python
date_range = pd.date_range(from_date or df["_bucket_date"].min(), to_date or date.today(), freq="D")
grouped = df.groupby("_bucket_date")["_net_pnl"].sum()
result = []
cumulative = 0
for d in date_range:
    daily = float(grouped.get(d.date(), 0))
    cumulative += daily
    result.append({"date": str(d.date()), "label": ..., "dailyPnl": daily, "cumulativePnl": cumulative})
```

---

## 3. API Endpoints

All endpoints are in `portfolio_tracker.py` with prefix `/portfolio-tracker`.

### POST `/refresh`

```python
@router.post("/refresh")
async def refresh_portfolio(_: UserId) -> dict:
    src = _source_path()
    if not src.exists(): raise 503
    src_size_kb = round(src.stat().st_size / 1024, 1)
    copy_excel_from_source()   # shutil.copy2(src, dst); _write_cache_bust()
    dst_size_kb = round(dst.stat().st_size / 1024, 1) if dst.exists() else 0
    return { "status": "ok", "source": str(src), "destination": str(dst),
             "source_size_kb": src_size_kb, "destination_size_kb": dst_size_kb }
```

### GET `/positions`

Query params: `from_date`, `to_date`, `status` (active|closed|all)

Returns: `{ positions: [...], total: int, totalNetPnl: float }`

### GET `/performance`

Query params: `from_date`, `to_date`, `period` (daily|weekly|monthly)

Returns: `[{ date, label, dailyPnl, cumulativePnl }]`

### GET `/performance/by-date`

Returns grouped P&L per period bucket:
`[{ period, label, net, accumulatedPnl, wins, losses, total, winRate }]`

### GET `/performance/transactions`

Query params: `period_key`, `period`, `from_date`, `to_date`

Returns individual trade rows for a specific period bucket (used by drill-down modal).

---

## 4. Frontend Components

### Page structure (`portfolio/page.tsx`)

All logic lives in the single page file, organized as pure component functions:
- `MetricCard` — single KPI tile
- `PeriodSelector` — Daily/Weekly/Monthly toggle
- `PositionsTable` — main positions grid
- `PerformanceChart` — ECharts dual-axis chart
- `PerformanceByDateTable` — collapsible table with row click
- `TransactionModal` — drill-down overlay
- `PerformanceByStockChart` — bar chart
- `PerformanceByStockTable` — collapsible table
- `RefreshModal` — self-contained; runs refresh in `useEffect` on mount
- `RawDataModal` — full-screen Excel viewer

### Refresh Modal Pattern

The refresh modal is mounted via a boolean flag and runs its own logic in `useEffect`:

```tsx
// Parent:
const [showRefresh, setShowRefresh] = useState(false)
{showRefresh && <RefreshModal onClose={() => setShowRefresh(false)} />}

// RefreshModal:
useEffect(() => {
  let cancelled = false
  const run = async () => {
    try {
      const res = await portfolioTrackerService.refresh()
      setPhase('reloading')
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['portfolio-positions'] }),
        queryClient.refetchQueries({ queryKey: ['portfolio-performance'] }),
        ...
      ])
      setPhase('done')
    } catch (e) { setPhase('error') }
  }
  run()
  return () => { cancelled = true }
}, [])
```

**Why `useEffect`?** React 18 batches state updates inside async functions, so the modal wouldn't render if the async work ran inline in the click handler. Mounting the modal (sync) then running work inside `useEffect` (after mount) ensures the modal renders first.

---

## 5. Frontend Service

**File:** `frontend/src/services/portfolioTracker.ts`

Key methods:
```typescript
portfolioTrackerService.refresh()          → POST /portfolio-tracker/refresh
portfolioTrackerService.getPositions(params) → GET /portfolio-tracker/positions
portfolioTrackerService.getPerformance(p)  → GET /portfolio-tracker/performance
portfolioTrackerService.getPerformanceByDate(p)
portfolioTrackerService.getPerformanceByStock(p)
portfolioTrackerService.getTransactions(p)  → GET /performance/transactions
portfolioTrackerService.getRawData()        → GET /portfolio-tracker/raw-data
portfolioTrackerService.getSetIndices()
portfolioTrackerService.getGlobalIndices()
```
