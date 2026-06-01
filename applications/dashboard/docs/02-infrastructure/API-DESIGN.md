# API Design

---

## 1. Conventions

- **Base path:** `/api/v1/`
- **Format:** JSON (`Content-Type: application/json`)
- **Auth:** `Authorization: Bearer <accessToken>` on all endpoints except auth and health
- **Errors:** `{ "detail": "human-readable message" }` — matches FastAPI's default
- **HTTP status codes:**

| Code | Meaning |
|------|---------|
| 200 | Success (GET, PUT, POST list/detail) |
| 201 | Created (POST that creates a resource) |
| 204 | No content (DELETE) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient role) |
| 404 | Not found |
| 422 | Unprocessable entity (Pydantic validation) |
| 500 | Internal server error |
| 503 | Service unavailable (e.g. Excel file missing) |

---

## 2. All Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/health/live` | None | Liveness probe |
| GET | `/api/v1/health/ready` | None | Readiness probe (checks DB + Redis) |

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/login` | None | Login, returns tokens |
| POST | `/api/v1/auth/refresh` | None | Rotate access token using refresh token |
| POST | `/api/v1/auth/logout` | Bearer | Blacklist current token |
| POST | `/api/v1/auth/forgot-password` | None | Email reset token (dev: returns token in response) |
| POST | `/api/v1/auth/reset-password` | None | Set new password with token |
| GET | `/api/v1/auth/me` | Bearer | Current user profile |

### Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/users` | Admin | List all users |
| POST | `/api/v1/users` | Admin | Create user |
| GET | `/api/v1/users/{id}` | Admin | Get user by ID |
| PUT | `/api/v1/users/{id}` | Admin | Update user (name, role, is_active) |
| DELETE | `/api/v1/users/{id}` | Admin | Delete user |
| PUT | `/api/v1/users/{id}/password` | Admin | Force-set user password |
| PUT | `/api/v1/users/me` | Bearer | Update own profile (name) |
| PUT | `/api/v1/users/me/password` | Bearer | Change own password |

### Portfolio Tracker

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/portfolio-tracker/refresh` | Bearer | Copy source Excel → working copy, bust cache |
| GET | `/api/v1/portfolio-tracker/raw-data` | Bearer | All raw rows from Excel |
| GET | `/api/v1/portfolio-tracker/positions` | Bearer | Filtered positions with live P&L |
| GET | `/api/v1/portfolio-tracker/performance` | Bearer | Daily/weekly/monthly P&L chart data |
| GET | `/api/v1/portfolio-tracker/performance/by-date` | Bearer | Grouped P&L table |
| GET | `/api/v1/portfolio-tracker/performance/transactions` | Bearer | Transactions for a period |
| GET | `/api/v1/portfolio-tracker/performance/by-stock` | Bearer | P&L grouped by stock |
| GET | `/api/v1/portfolio-tracker/market/set-indices` | Bearer | Thai market indices |
| GET | `/api/v1/portfolio-tracker/market/global-indices` | Bearer | S&P500, NASDAQ, BTC, Gold |

### Action Plans

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/action-plans/suggest-name` | Bearer | Unique name for today |
| GET | `/api/v1/action-plans/stock-price` | Bearer | Live price for a symbol |
| GET | `/api/v1/action-plans` | Bearer | List plans (type + month filter) |
| POST | `/api/v1/action-plans` | Bearer | Create empty plan |
| GET | `/api/v1/action-plans/{id}` | Bearer | Fetch plan + items |
| PUT | `/api/v1/action-plans/{id}` | Bearer | Replace name/items |
| DELETE | `/api/v1/action-plans/{id}` | Bearer | Hard delete |
| POST | `/api/v1/action-plans/{id}/duplicate` | Bearer | Copy plan |

### AI Copilot

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/ai/copilot/stream` | Bearer | SSE streaming chat |
| DELETE | `/api/v1/ai/copilot/session/{id}` | Bearer | Clear session history |

### App Configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/app-config` | Bearer | Get config values |
| PUT | `/api/v1/app-config` | Bearer | Save config values |
| POST | `/api/v1/app-config/test-path` | Bearer | Test if a file path exists |

### Weekly Scan

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/weekly-scan/symbol-lists` | Bearer | List all symbol lists for the current user |
| POST | `/api/v1/weekly-scan/symbol-lists` | Bearer | Create a new named symbol list |
| PUT | `/api/v1/weekly-scan/symbol-lists/{list_id}` | Bearer | Update name, market, symbols, or sort_order |
| DELETE | `/api/v1/weekly-scan/symbol-lists/{list_id}` | Bearer | Delete a symbol list |
| GET | `/api/v1/weekly-scan/config` | Bearer | Get legacy single-list config (auto-seeds SET50 defaults) |
| PUT | `/api/v1/weekly-scan/config` | Bearer | Replace legacy symbol list |
| GET | `/api/v1/weekly-scan/suggest-name` | Bearer | Return suggested scan name for next/last Saturday |
| GET | `/api/v1/weekly-scan/scans` | Bearer | List all scans (newest first) with colour counts |
| POST | `/api/v1/weekly-scan/scans` | Bearer | Create scan and populate from current symbol lists |
| GET | `/api/v1/weekly-scan/scans/{scan_id}` | Bearer | Fetch scan header + all items + colour counts |
| DELETE | `/api/v1/weekly-scan/scans/{scan_id}` | Bearer | Hard-delete scan and all items |
| POST | `/api/v1/weekly-scan/scans/{scan_id}/refresh` | Bearer | Merge current symbol lists into existing scan |
| POST | `/api/v1/weekly-scan/scans/{scan_id}/items` | Bearer | Add a single symbol to a scan |
| PUT | `/api/v1/weekly-scan/scans/{scan_id}/items/{symbol}` | Bearer | Upsert evaluation fields for one symbol |
| DELETE | `/api/v1/weekly-scan/scans/{scan_id}/items/{symbol}` | Bearer | Remove a symbol from a scan |
| GET | `/api/v1/weekly-scan/scans/{scan_id}/week-prices` | Bearer | Monday open + Friday close for all symbols in the scan |

### Documentation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/docs-content/manifest` | Bearer | Doc tree manifest |
| GET | `/api/v1/docs-content/file?path=` | Bearer | Serve a markdown file |
| GET | `/api/v1/docs-content/{name}` | Bearer | Legacy: requirements / design |

---

## 3. Request / Response Examples

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "ChangeMe123!" }
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "Admin",
    "role": "admin"
  }
}
```

### Positions

```http
GET /api/v1/portfolio-tracker/positions?status=active&from_date=2026-01-01&to_date=2026-05-30
Authorization: Bearer eyJ...
```

```json
{
  "positions": [
    {
      "id": 1,
      "symbol": "GULF",
      "direction": "Long",
      "entryDate": "2026-02-10",
      "entryPrice": 57.5,
      "currentPrice": 64.0,
      "positionSize": 200,
      "netPnl": 1300.0,
      "pnlPct": 11.30,
      "sl": 52.0,
      "tp": 72.0,
      "status": "active"
    }
  ],
  "total": 1,
  "totalNetPnl": 1300.0
}
```

### Weekly Scan — Create Scan

```http
POST /api/v1/weekly-scan/scans
Authorization: Bearer eyJ...
Content-Type: application/json

{ "name": "WEEKLY_SCAN_07_06_2026" }
```

```json
{
  "id": "a1b2c3d4-...",
  "name": "WEEKLY_SCAN_07_06_2026",
  "created_at": "2026-06-01T08:00:00+07:00"
}
```

### Weekly Scan — Get Scan (with items)

```http
GET /api/v1/weekly-scan/scans/a1b2c3d4-...
Authorization: Bearer eyJ...
```

```json
{
  "id": "a1b2c3d4-...",
  "name": "WEEKLY_SCAN_07_06_2026",
  "created_at": "2026-06-01T08:00:00+07:00",
  "updated_at": "2026-06-01T09:15:00+07:00",
  "color_counts": { "CYAN": 3, "GREEN": 8, "YELLOW": 5, "RED": 12, "PURPLE": 4, "NONE": 18 },
  "items": [
    {
      "id": "item-uuid",
      "symbol": "GULF",
      "sort_order": 0,
      "list_name": "SET50",
      "market": "SET",
      "color_mark": "GREEN",
      "strategy": "BREAK OUT",
      "buy_price": 64.0,
      "size": 200,
      "tp": 72.0,
      "sl": 60.0,
      "remark": "Breakout from 3-month consolidation",
      "updated_at": "2026-06-01T09:15:00+07:00"
    }
  ]
}
```

### Weekly Scan — Update Item

```http
PUT /api/v1/weekly-scan/scans/a1b2c3d4-.../items/GULF
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "color_mark": "CYAN",
  "strategy": "BREAK OUT",
  "buy_price": 64.5,
  "tp": 75.0,
  "sl": 60.0
}
```

Only provided fields are updated (partial update via Pydantic `exclude_unset=True`).

### Weekly Scan — Week Prices

```http
GET /api/v1/weekly-scan/scans/a1b2c3d4-.../week-prices
Authorization: Bearer eyJ...
```

```json
{
  "mon_date": "2026-06-02",
  "fri_date": "2026-06-06",
  "prices": {
    "GULF": { "mon": 63.50, "fri": 65.25 },
    "KBANK": { "mon": 145.00, "fri": 143.50 },
    "ADVANC": { "mon": null, "fri": null }
  }
}
```

---

## 4. CORS Configuration

Since all browser requests go through the Next.js proxy (same origin), the backend uses wildcard CORS. The middleware is configured in `backend/main.py`:

```python
wildcard = settings.cors_origins == ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r".*" if wildcard else None,
    allow_credentials=not wildcard,   # credentials not allowed with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Why:** `allow_credentials=True` with `allow_origins=["*"]` is rejected by browsers. Using `allow_origin_regex=r".*"` and `allow_credentials=False` achieves the same effect safely.

---

## 5. Middleware Stack

Applied in order (outer to inner — last runs first on request):

1. `SecurityHeadersMiddleware` — adds security headers (see table below)
2. `RequestIdMiddleware` — injects `X-Request-ID` UUID into every request/response (propagates existing header if present)
3. `CORSMiddleware` — (outermost for CORS preflight)
4. `SlowAPIMiddleware` — rate limiting via SlowAPI; default limit `200/minute` per IP; auth endpoints use `5/minute`

**Security response headers set by `SecurityHeadersMiddleware`:**

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

---

## 6. Metrics

Prometheus metrics are exposed at `/metrics` when `METRICS_ENABLED=true`.

Instrumented by `prometheus-fastapi-instrumentator`:
- Request count by method, path, status
- Request duration histogram
- In-flight requests
- Health endpoints excluded (`/api/v1/health/*`)
