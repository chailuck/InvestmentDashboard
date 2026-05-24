# Enterprise AI Investment Dashboard — Requirements

_Last updated: 2026-05-24_

---

## 1. Overview

An enterprise-grade, full-stack investment dashboard for tracking a personal Thai SET stock portfolio. It integrates live market data via Yahoo Finance, an AI copilot powered by Anthropic Claude, and a web-based UI for real-time portfolio monitoring.

---

## 2. Functional Requirements

### 2.1 Authentication

| ID | Requirement |
|----|-------------|
| AUTH-01 | Users must authenticate with email and password via JWT. |
| AUTH-02 | Tokens: 30-minute access token + 7-day refresh token (silent renewal). |
| AUTH-03 | Password reset flow: email-based token (1hr TTL) stored in Redis. In dev mode, the reset token is returned directly in the API response. |
| AUTH-04 | First-run admin seeding: configurable via `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` environment variables. If not set, no admin is seeded. |
| AUTH-05 | Logout blacklists the user in the auth cache. |

### 2.2 User Management (RBAC)

| ID | Requirement |
|----|-------------|
| USR-01 | Roles: `admin`, `analyst`, `viewer`. |
| USR-02 | Admins can list, create, edit, deactivate, and force-reset passwords for any user. |
| USR-03 | Analysts and viewers can only update their own name and change their own password. |
| USR-04 | New users are created without a default password — admins must set one explicitly. |
| USR-05 | Users menu is nested under the Settings accordion in the sidebar and is only visible to admins. |
| USR-06 | Deactivating self is blocked. |

### 2.3 Portfolio Tracker

| ID | Requirement |
|----|-------------|
| PORT-01 | Source of truth: `Investment tracking.xlsx` (Sheet1), located at `/app/investment_data/` inside the backend container (mounted read-only). |
| PORT-02 | Open positions are identified by a blank `Exit Price` column (the Excel formula returns "NOT SELL" for these rows). |
| PORT-03 | Live prices are fetched from Yahoo Finance with the `.BK` suffix for Thai SET stocks (e.g. GULF → GULF.BK). |
| PORT-04 | Net P&L is calculated as `(current_price - entry_price) × position_size` for Long; sign is reversed for Short. |
| PORT-05 | Default view: active (open) positions, date range = last 1 month. |
| PORT-06 | Date filter applies to: Entry Date for open positions; Exit Date for closed positions. |
| PORT-07 | The portfolio page includes a daily performance line chart showing daily P&L bars and cumulative P&L line over the selected date range. |
| PORT-08 | Closed positions use their Exit Date and Exit Price for chart bucketing. Open positions are mark-to-market (live price) and bucketed on today. |
| PORT-09 | Live prices auto-refresh every 60 seconds. |
| PORT-10 | If the Excel file is not found (path not configured), the API returns HTTP 503 with a descriptive error. |

### 2.4 Dashboard

| ID | Requirement |
|----|-------------|
| DASH-01 | Overview page with portfolio summary metrics, performance chart, and sector allocation. |

### 2.5 Analytics

| ID | Requirement |
|----|-------------|
| ANA-01 | Analytics page placeholder — to be defined. |

### 2.6 AI Copilot

| ID | Requirement |
|----|-------------|
| AI-01 | Chat interface powered by Anthropic Claude (claude-sonnet-4-6 by default). |
| AI-02 | Model configurable via `AI_DEFAULT_MODEL` env var. |
| AI-03 | Accessible to all authenticated users. |

### 2.7 Navigation

| ID | Requirement |
|----|-------------|
| NAV-01 | Sidebar items: Dashboard, Portfolio, Analytics, AI Copilot. |
| NAV-02 | Settings is a collapsible accordion with sub-items: My Profile (all users), Users (admin only). |
| NAV-03 | Sidebar collapses to icon-only mode on desktop; drawer on mobile. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | All services run in Docker containers managed by docker-compose. |
| NFR-02 | Backend: FastAPI + Python 3.12 + asyncio. |
| NFR-03 | Frontend: Next.js 14 App Router (React 18, TypeScript). |
| NFR-04 | Database: PostgreSQL 16 (async via asyncpg). |
| NFR-05 | Cache: Redis 7 (used for token blacklist and password reset tokens). |
| NFR-06 | API documentation available at `/api/docs` in development mode only. |
| NFR-07 | Prometheus metrics exposed at `/metrics` (configurable via `METRICS_ENABLED`). |
| NFR-08 | All API endpoints require JWT authentication except `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, and health checks. |

---

## 4. Out of Scope

- Multi-user portfolio isolation (single shared Excel file)
- Real-time WebSocket price streaming from the exchange
- Order execution / brokerage integration
- Mobile native app
