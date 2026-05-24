# Enterprise AI Investment Dashboard — Technical Design

_Last updated: 2026-05-24_

---

## 1. System Architecture

```
Browser (Next.js 14)
    │  REST/JSON + WebSocket
    ▼
FastAPI (Python 3.12)  ──→  PostgreSQL 16
    │                  ──→  Redis 7
    │                  ──→  Anthropic API (Claude)
    │                  ──→  Yahoo Finance (yfinance)
    └── Excel file (read-only volume mount)
```

All services run as Docker containers on a shared `dashboard-net` bridge network.

---

## 2. Backend

### 2.1 Directory Structure

```
backend/
├── main.py                        # FastAPI app factory + lifespan
├── app/
│   ├── api/v1/
│   │   ├── router.py              # Assembles all endpoint routers
│   │   └── endpoints/
│   │       ├── auth.py            # JWT login, refresh, forgot/reset password
│   │       ├── users.py           # CRUD user management (admin)
│   │       ├── portfolio_tracker.py  # Excel-based portfolio (new)
│   │       ├── portfolios.py      # Mock/placeholder portfolio data
│   │       ├── ai.py              # AI copilot chat
│   │       └── health.py          # Liveness/readiness probes
│   ├── auth/
│   │   ├── jwt.py                 # Token creation, verification, hashing
│   │   └── dependencies.py        # get_current_user, require_admin, require_analyst
│   ├── core/
│   │   ├── config.py              # Pydantic BaseSettings (env vars)
│   │   └── logging.py             # structlog configuration
│   ├── database/
│   │   ├── session.py             # SQLAlchemy async engine + session factory
│   │   └── redis.py               # Redis async client + CacheClient wrapper
│   ├── middleware/
│   │   └── security.py            # RequestIdMiddleware, SecurityHeadersMiddleware
│   ├── models/
│   │   └── user.py                # SQLAlchemy User ORM model
│   ├── schemas/
│   │   ├── users.py               # Pydantic user schemas
│   │   └── portfolio.py           # Pydantic portfolio schemas (mock API)
│   ├── services/
│   │   └── portfolio_excel.py     # Excel reader + yfinance live prices (new)
│   └── websocket/
│       └── manager.py             # Socket.IO server
```

### 2.2 Key Design Decisions

#### Admin Seeding
The first-run admin user is seeded on startup only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set in the environment. Uses `ON CONFLICT (email) DO NOTHING` to be idempotent across multi-worker restarts.

#### Auth Token Flow
```
Login → access_token (JWT, 30 min) + refresh_token (JWT, 7 days)
       ↓
Request → Bearer access_token in Authorization header
       ↓ (on 401)
Silent refresh → POST /auth/refresh with refresh_token
       ↓ (on refresh failure)
Logout → clear auth state, redirect to /login
```

#### RBAC Dependencies
```python
get_current_user()    → User ORM object (any authenticated user)
require_admin()       → raises 403 if role != "admin"
require_analyst()     → raises 403 if role not in ("admin", "analyst")
```

#### Portfolio Excel Service (`portfolio_excel.py`)

| Function | Description |
|----------|-------------|
| `_load_df()` | Reads Excel, parses date/numeric columns |
| `fetch_live_prices(symbols)` | Downloads 5d history via yfinance, returns latest Close for each symbol |
| `get_positions(from_date, to_date, status)` | Returns filtered position list with live P&L |
| `get_daily_performance(from_date, to_date)` | Returns daily and cumulative P&L for chart |

Open positions are identified by `df['Exit Price'].isna()`. Net P&L formula:
- Long: `(current - entry) × size`
- Short: `(entry - current) × size`

Daily performance groups closed positions by Exit Date and open positions by today, then cumsum over business-day date range.

### 2.3 API Endpoints

#### Portfolio Tracker (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/portfolio-tracker/positions` | Any | List positions with filters |
| GET | `/api/v1/portfolio-tracker/performance` | Any | Daily P&L for chart |

Query parameters for `/positions`:
- `from_date` (YYYY-MM-DD) — filter start date
- `to_date` (YYYY-MM-DD) — filter end date
- `status` — `active` (default) | `closed` | `all`

Response shape:
```json
{
  "positions": [...],
  "total": 7,
  "totalNetPnl": 12500.0
}
```

---

## 3. Frontend

### 3.1 Directory Structure

```
frontend/src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   └── reset-password/page.tsx
│   └── (dashboard)/
│       ├── layout.tsx             # Shell with Sidebar + TopBar
│       ├── dashboard/page.tsx
│       ├── portfolio/page.tsx     # New: Excel-based portfolio tracker
│       ├── analytics/page.tsx
│       ├── ai-copilot/page.tsx
│       ├── settings/page.tsx
│       └── admin/users/page.tsx
├── components/
│   ├── layouts/
│   │   ├── Sidebar.tsx            # Accordion nav with Settings sub-menu
│   │   └── TopBar.tsx
│   └── ui/
│       └── RoleGuard.tsx          # Conditional render based on role
├── services/
│   ├── api.ts                     # Axios client with JWT interceptors
│   ├── auth.ts
│   ├── portfolio.ts               # Mock portfolio service
│   ├── portfolioTracker.ts        # New: Excel portfolio API calls
│   └── users.ts
├── store/
│   └── auth.ts                    # Zustand auth store (sessionStorage)
└── types/
    └── index.ts
```

### 3.2 Portfolio Page Design

**URL**: `/portfolio`

**Sections**:
1. **Filter bar** — from date, to date (inputs), status toggle (Active / All / Closed)
2. **Metric cards** — Total P&L, Position count, Win Rate, Average P&L
3. **Daily Performance chart** — ECharts line chart (cumulative P&L line + daily P&L bars)
4. **Positions table** — Symbol, Direction (L/S), Entry Date, Entry Price, Current Price, Size, Net P&L (with % inline), SL, TP, Status badge

**Data fetching**:
- `useQuery` with 60-second `refetchInterval` for both positions and performance
- Manual refresh button triggers `refetch()` on both queries

**Chart**: dual-axis ECharts — left Y-axis for cumulative P&L (area line), right Y-axis for daily P&L (bars colored green/red)

### 3.3 Sidebar Accordion

The Settings nav item is a `<button>` that expands/collapses a sub-list using Framer Motion `AnimatePresence`. Sub-items:
- **My Profile** → `/settings` (all users)
- **Users** → `/admin/users` (admin only, guarded by `user?.role === 'admin'` check)

When collapsed to icon mode, the accordion button still shows the Settings icon and clicking it navigates to the first visible sub-item.

---

## 4. Infrastructure

### 4.1 Docker Services

| Service | Image | Port |
|---------|-------|------|
| postgres | postgres:16-alpine | 5432 |
| redis | redis:7-alpine | 6379 |
| backend | custom (Python 3.12-slim) | 8000 |
| frontend | custom (Node 20-alpine) | 3000 |
| adminer | adminer:latest | 8080 (dev profile) |

### 4.2 Volume Mounts (Backend)

| Host Path | Container Path | Mode |
|-----------|----------------|------|
| `./backend` | `/app` | cached (hot-reload) |
| `uploads_data` (named volume) | `/app/uploads` | rw |
| `D:/Documents/Pop/AI Agents/InvestmentAgent01/investmentPlan` | `/app/investment_data` | ro |

### 4.3 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Seed admin email | (empty — no seed) |
| `ADMIN_PASSWORD` | Seed admin password | (empty — no seed) |
| `ADMIN_NAME` | Seed admin display name | Administrator |
| `INVESTMENT_EXCEL_PATH` | Path to Excel file inside container | (empty) |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `AI_DEFAULT_MODEL` | Claude model ID | claude-sonnet-4-6 |
| `DATABASE_URL` | PostgreSQL async URL | postgresql+asyncpg://... |
| `REDIS_URL` | Redis URL | redis://localhost:6379/0 |
| `JWT_ALGORITHM` | JWT signing algorithm | HS256 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL | 30 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL | 7 |
| `CORS_ORIGINS` | JSON array of allowed origins | ["http://localhost:3000"] |

---

## 5. Dependency Constraints

| Package | Version | Reason |
|---------|---------|--------|
| `bcrypt` | `==3.2.2` | passlib 1.7.4 is incompatible with bcrypt 4.x |
| `pydantic[email]` | `==2.8.2` | Email validation requires the `email` extra |
| `email-validator` | `==2.2.0` | Explicit dependency for pydantic email validation |
| `redis[hiredis]` | `==5.0.8` | Async support built-in; aioredis not used |
| `yfinance` | `==0.2.44` | Live price fetching for Thai SET stocks |

---

## 6. Change History

| Date | Change |
|------|--------|
| 2026-05-24 | Initial architecture established; Docker stack running |
| 2026-05-24 | User management + RBAC implemented (list, CRUD, password reset) |
| 2026-05-24 | Sidebar redesigned with Settings accordion; Users sub-item admin-only |
| 2026-05-24 | Admin seeding made configurable via env vars (no default credentials) |
| 2026-05-24 | Portfolio tracker: Excel reader + yfinance + daily performance chart |
| 2026-05-24 | Docker volume mount added for Investment tracking.xlsx (read-only) |
