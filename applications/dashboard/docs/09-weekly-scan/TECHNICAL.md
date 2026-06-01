# Weekly Scan — Technical Design

---

## 1. Files

### Backend

```
backend/app/models/weekly_scan.py              — ORM models (4 classes)
backend/app/api/v1/endpoints/weekly_scan.py    — FastAPI router (608 lines)
```

### Frontend

```
frontend/src/app/(dashboard)/weekly-scan/page.tsx                      — scan index / list page
frontend/src/app/(dashboard)/weekly-scan/[id]/page.tsx                 — scan detail / table (882 lines)
frontend/src/app/(dashboard)/weekly-scan/[id]/evaluate/page.tsx        — evaluate / chart view (523 lines)
frontend/src/app/(dashboard)/weekly-scan/[id]/dashboard/page.tsx       — scan summary dashboard (460 lines)
frontend/src/services/weeklyScan.ts                                     — API service layer
```

---

## 2. Database Schema

**ORM file:** `backend/app/models/weekly_scan.py`

### `user_scan_configs`

Legacy single-list config. Retained for migration support; new users use `user_symbol_lists` instead.

```sql
CREATE TABLE user_scan_configs (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    symbols     JSONB        NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX ON user_scan_configs (user_id);
```

| Field | Notes |
|-------|-------|
| `symbols` | JSONB array of uppercase ticker strings |

---

### `user_symbol_lists`

Named, ordered symbol lists. Multiple lists per user; each scoped to one market.

```sql
CREATE TABLE user_symbol_lists (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    market      VARCHAR(20)  NOT NULL DEFAULT 'SET',
    symbols     JSONB        NOT NULL DEFAULT '[]',
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON user_symbol_lists (user_id);
```

| Field | Notes |
|-------|-------|
| `market` | `SET` \| `US` \| `HK` \| `CRYPTO` \| `OTHER` |
| `symbols` | JSONB array of uppercase ticker strings |
| `sort_order` | Ascending display order; new lists placed after existing max |

---

### `weekly_scans`

Header record for one weekly scan session.

```sql
CREATE TABLE weekly_scans (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON weekly_scans (user_id);
```

Name convention: `WEEKLY_SCAN_DD_MM_YYYY` — the embedded date is parsed by `_parse_week_dates()` to derive the Monday open / Friday close window for price fetching.

---

### `weekly_scan_items`

One row per symbol in a scan. All evaluation fields are nullable until the analyst fills them in.

```sql
CREATE TABLE weekly_scan_items (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id     UUID         NOT NULL REFERENCES weekly_scans(id) ON DELETE CASCADE,
    symbol      VARCHAR(30)  NOT NULL,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    list_name   VARCHAR(100),
    market      VARCHAR(20)  NOT NULL DEFAULT 'SET',

    -- Evaluation (all nullable)
    color_mark  VARCHAR(10),      -- CYAN | GREEN | YELLOW | RED | PURPLE
    strategy    VARCHAR(200),
    buy_price   NUMERIC(14, 4),
    size        INTEGER,
    tp          NUMERIC(14, 4),
    sl          NUMERIC(14, 4),
    remark      TEXT,

    updated_at  TIMESTAMPTZ  DEFAULT NOW(),

    CONSTRAINT uq_scan_item UNIQUE (scan_id, symbol)
);

CREATE INDEX ON weekly_scan_items (scan_id);
```

---

### Entity Relationships

```
users (1)
  ├─── user_scan_configs (1)     [user_id → users.id  ON DELETE CASCADE]
  ├─── user_symbol_lists (N)     [user_id → users.id  ON DELETE CASCADE]
  └─── weekly_scans (N)          [user_id → users.id  ON DELETE CASCADE]
         └─── weekly_scan_items (N)  [scan_id → weekly_scans.id  ON DELETE CASCADE]
```

---

## 3. Alembic Migrations

Alembic was introduced alongside the Weekly Scan module.

```
backend/alembic/
  env.py            — async engine configuration for SQLAlchemy 2.0
  script.py.mako    — migration script template
  versions/         — individual migration files
```

`env.py` imports all models via `from app.models import *` and uses `target_metadata = Base.metadata`. Migrations are run with:

```bash
alembic upgrade head
```

The four weekly scan tables are created in the initial migration. `create_all()` at startup is still present for development convenience but Alembic is the canonical migration path.

---

## 4. Backend API Endpoints

**Router prefix:** `/api/v1/weekly-scan`  
**Auth:** Bearer token required on all endpoints  
**File:** `backend/app/api/v1/endpoints/weekly_scan.py`

### Symbol Lists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/symbol-lists` | List all symbol lists for the current user |
| POST | `/symbol-lists` | Create a new symbol list |
| PUT | `/symbol-lists/{list_id}` | Update name, market, symbols, or sort_order |
| DELETE | `/symbol-lists/{list_id}` | Delete a symbol list |

**`GET /symbol-lists` — migration helper behaviour:**  
If the user has no lists but has a legacy `UserScanConfig` record, the endpoint automatically seeds a "Default" `UserSymbolList` from that config and returns it. This ensures backwards compatibility with users who configured the old single-list system.

---

### Config (Legacy)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Get legacy symbol config (auto-seeds SET50 defaults on first access) |
| PUT | `/config` | Replace the legacy symbol list |

---

### Scan Lifecycle

| Method | Path | Description |
|--------|------|-------------|
| GET | `/suggest-name` | Returns `WEEKLY_SCAN_DD_MM_YYYY` for the next (or last) Saturday |
| GET | `/scans` | List all scans, ordered newest-first, with colour counts |
| POST | `/scans` | Create scan and populate from current symbol lists |
| GET | `/scans/{scan_id}` | Fetch scan header + all items + colour counts |
| DELETE | `/scans/{scan_id}` | Hard-delete scan and all items |
| POST | `/scans/{scan_id}/refresh` | Merge current symbol lists into the scan (upsert) |

**`POST /scans` — creation logic:**

```python
# Priority 1: named symbol lists
lists_result = await db.execute(
    select(UserSymbolList).where(UserSymbolList.user_id == uid).order_by(UserSymbolList.sort_order)
)
symbol_lists = lists_result.scalars().all()

if symbol_lists:
    for sl in symbol_lists:
        for sym in sl.symbols:
            db.add(WeeklyScanItem(scan_id=scan.id, symbol=sym, list_name=sl.name, market=sl.market, ...))
else:
    # Priority 2: legacy UserScanConfig, fallback to SET50_DEFAULT
    config = await db.scalar(select(UserScanConfig).where(...))
    symbols = config.symbols if config else SET50_DEFAULT
    for sym in symbols:
        db.add(WeeklyScanItem(scan_id=scan.id, symbol=sym, ...))
```

**`POST /scans/{scan_id}/refresh` — merge logic:**  
Existing items keep their evaluation data. New symbols from the current lists are appended. For symbols present in multiple lists, the first list wins for `list_name`/`market` assignment.

---

### Scan Items

| Method | Path | Description |
|--------|------|-------------|
| POST | `/scans/{scan_id}/items` | Add a single symbol to a scan (409 if duplicate) |
| PUT | `/scans/{scan_id}/items/{symbol}` | Upsert evaluation fields for a symbol |
| DELETE | `/scans/{scan_id}/items/{symbol}` | Remove a symbol from a scan |

**`PUT .../items/{symbol}` — partial update:**  
Uses Pydantic's `model_dump(exclude_unset=True)` so only provided fields are written:

```python
for field, val in body.model_dump(exclude_unset=True).items():
    setattr(item, field, val)
await db.execute(
    text("UPDATE weekly_scans SET updated_at = now() WHERE id = :id"), {"id": scan.id}
)
```

The scan's `updated_at` is explicitly bumped via raw SQL because SQLAlchemy `onupdate` does not fire when only child rows change.

---

### Week Prices

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scans/{scan_id}/week-prices` | Fetch Monday open + Friday close for all items |

**Concurrency model:**

```python
loop = asyncio.get_running_loop()
sem  = asyncio.Semaphore(5)   # max 5 concurrent yfinance calls

async def _fetch(sym: str) -> tuple[str, dict]:
    async with sem:
        result = await loop.run_in_executor(
            None, _fetch_sym_prices, sym, monday, friday, sym_market.get(sym, 'SET')
        )
    return sym, result

pairs = await asyncio.gather(*[_fetch(s) for s in symbols])
```

`_fetch_sym_prices` is a synchronous function wrapping `yf.Ticker(...).history(...)` and is offloaded to the default thread pool executor. The semaphore limits concurrent yfinance HTTP connections to 5 to avoid rate-limiting.

**Ticker symbol translation:**

```python
def _sym_to_ticker(symbol: str, market: str = 'SET') -> str:
    sym = symbol.strip().upper()
    if market == 'CRYPTO' or sym.endswith('-DR') or 'USD' in sym:
        return sym           # use as-is (e.g. BTCUSD-DR, GC=F)
    if market == 'HK':
        return f"{sym.zfill(4)}.HK"
    if market in ('US', 'OTHER'):
        return sym
    return f"{sym}.BK"       # SET default: GULF → GULF.BK
```

---

## 5. Pydantic Schemas (inline in weekly_scan.py)

| Schema | Fields | Used by |
|--------|--------|---------|
| `ScanCreate` | `name: str` | POST /scans |
| `ItemEval` | `color_mark`, `strategy`, `buy_price`, `size`, `tp`, `sl`, `remark` (all optional) | PUT .../items/{symbol} |
| `ItemAdd` | `symbol`, `list_name`, `market` | POST .../items |
| `SymbolListCreate` | `name`, `market`, `symbols` | POST /symbol-lists |
| `SymbolListUpdate` | all optional: `name`, `market`, `symbols`, `sort_order` | PUT /symbol-lists/{id} |
| `ConfigUpdate` | `symbols: list[str]` | PUT /config |

---

## 6. Frontend — Scan Detail Page (`[id]/page.tsx`)

### State

| State | Type | Purpose |
|-------|------|---------|
| `activeListTab` | `string \| null` | Selected symbol-list tab (auto-defaults to first tab on load) |
| `filterSymbol` | `string` | Symbol text filter |
| `filterColors` | `Set<string>` | Multi-select colour filter |
| `filterStrategy` | `string` | Strategy text filter |
| `addToPlan` | `WeeklyScanItem \| null` | Controls Add-to-Plan modal |
| `deleteSymbol` | `string \| null` | Controls delete-confirm modal |
| `analyticsSymbol` | `{symbol, market} \| null` | Controls Analytics modal |

### Data fetching

```typescript
// Scan data — stale after 30 s
const { data: scan } = useQuery({
  queryKey: ['weekly-scan', id],
  queryFn: () => weeklyScanService.getScan(id),
  staleTime: 30_000,
})

// Week prices — stale after 5 min; only runs after scan loads
const { data: weekPrices, isLoading: pricesLoading } = useQuery({
  queryKey: ['weekly-scan-prices', id],
  queryFn: () => weeklyScanService.getWeekPrices(id),
  staleTime: 5 * 60_000,
  enabled: !!scan,
})
```

### Inline editing pattern

All table cells use one of three micro-components:

- **`NumCell`** — click to enter edit mode with `<input type="number">`; blur or Enter commits; Escape cancels
- **`TextCell`** — same pattern for free-text fields (remark, strategy free-text)
- **`ColorPicker`** — five dot buttons; clicking an active dot deselects; clicking inactive activates
- **`StrategyCell`** — icon button grid; OTHERS mode adds a free-text input

Each change calls `updateField(symbol, {field: value})` which issues `PUT .../items/{symbol}` and then invalidates the `['weekly-scan', id]` query.

### Portfolio auto-mark

```typescript
const markPortfolioSymbols = async () => {
  const positions = await portfolioDbService.getPositions('active')
  const activeSymbols = new Set(positions.map(p => p.symbol.toUpperCase()))

  // Inherit strategy from latest purchase plan
  const allPlans = await actionPlanService.list('purchase', null)
  let strategyMap: Record<string, string> = {}
  if (allPlans.length > 0) {
    const latest = await actionPlanService.get(allPlans[0].id)
    for (const item of latest.purchase_items) {
      if (item.strategy) strategyMap[item.stock.toUpperCase()] = item.strategy
    }
  }

  const toMark = scan.items.filter(i => activeSymbols.has(i.symbol.toUpperCase()))
  await Promise.all(toMark.map(item =>
    weeklyScanService.upsertItem(id, item.symbol, {
      color_mark: 'PURPLE',
      strategy: strategyMap[item.symbol.toUpperCase()] ?? item.strategy ?? undefined,
    })
  ))
}
```

---

## 7. Frontend — Evaluate View (`[id]/evaluate/page.tsx`)

### Queue building

```typescript
function buildQueue(scan: WeeklyScan, mode: string, list: string | null): WeeklyScanItem[] {
  let items = [...scan.items].sort((a, b) => a.symbol.localeCompare(b.symbol))
  if (list) items = items.filter(i => i.list_name === list)
  if (mode === 'remaining') return items.filter(i => !i.color_mark)
  if (mode.startsWith('color_')) {
    const color = mode.slice(6) as ColorMark
    return items.filter(i => i.color_mark === color)
  }
  return items  // 'all' mode
}
```

Mode and list are passed as URL search parameters (`?mode=remaining&list=SET50`) allowing direct linking into a specific eval queue.

### Chart component

The evaluate view uses the shared `EChartsChart` component:

```typescript
<EChartsChart
  symbol={symbol}
  assetType={'SET' as AssetType}
  interval={interval}           // '1h' | '4h' | '1d' | '1wk'
  onIntervalChange={setInterval}
  height={400}
/>
```

See Section 8 for the `EChartsChart` component design.

---

## 8. ECharts Migration (`EChartsChart.tsx`)

**File:** `frontend/src/components/analytics/EChartsChart.tsx`

Replaced the previous chart implementation with a full-featured ECharts candlestick chart powered by `echarts-for-react`.

**Chart panels (vertically stacked, synchronised x-axis):**

| Panel | Grid | Height | Content |
|-------|------|--------|---------|
| Price + VRVP | grid[0] | ~60% | Candlestick (OHLC), VRVP bars |
| Volume | grid[1] | ~15% | Volume bars (green up / red down) |
| RSI | grid[2] | ~12% | RSI line, 70/30 reference lines |
| Stochastic | grid[3] | ~13% | %K and %D lines, 80/20 reference lines |

**Supported intervals:** `1h`, `4h`, `1d`, `1wk`  
**Supported ranges:** `6mo` (182 d), `1y` (365 d), `2y` (730 d), `2.5y` (912 d)

**DataZoom:** Slider and inside zoom on the x-axis; start position is computed to show the last N days based on the selected range:

```typescript
function zoomStartForRange(dates: string[], days: number): number {
  if (!dates.length || days >= 912) return 0
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const idx = dates.findIndex(d => d.slice(0, 10) >= cutoffStr)
  if (idx <= 0) return 0
  return (idx / dates.length) * 100
}
```

**Log scale toggle:** A button on the chart toolbar switches the price y-axis between linear and log scale.

**Tooltip:** Custom HTML formatter showing O/H/L/C for the candlestick series, volume, RSI, and Stochastic %K/%D on a single cross-hair tooltip.

**VRVP (Volume at Price):** Horizontal bar overlay on the price panel showing the distribution of volume across price levels. Bars are normalised to a maximum width of 15% of the chart width.

---

## 9. Rate Limiting

**File:** `backend/app/core/rate_limit.py`

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200/minute"],
)
```

The `limiter` singleton is attached to `app.state.limiter` in `main.py`. `SlowAPIMiddleware` is registered as a middleware. Individual endpoints that require tighter limits use the `@limiter.limit("N/minute")` decorator with `request: Request` as a required parameter (e.g. auth login: `5/minute`).

---

## 10. Security Middleware

**File:** `backend/app/middleware/security.py`

`SecurityHeadersMiddleware` now adds two additional headers beyond the original three:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

The CSP is maximally restrictive because the backend serves only JSON. `frame-ancestors 'none'` and `X-Frame-Options: DENY` are both set for legacy browser compatibility.

`RequestIdMiddleware` (also in this file) injects a short `X-Request-ID` UUID into every request/response, propagated from the incoming header if one is already present.

---

## 11. Model Registration

All weekly scan models must be imported in `backend/main.py` before `Base.metadata.create_all` is called:

```python
from app.models.weekly_scan import (       # noqa: F401
    UserScanConfig, UserSymbolList, WeeklyScan, WeeklyScanItem
)
```
