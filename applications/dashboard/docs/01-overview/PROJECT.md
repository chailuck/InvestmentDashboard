# InvestPro — Project Overview

_Last updated: 2026-05-30_

---

## 1. What Is InvestPro?

**InvestPro** is a full-stack, self-hosted investment dashboard for tracking a personal Thai SET (Stock Exchange of Thailand) portfolio. It provides real-time P&L, charting, AI-assisted analysis, and structured trade planning — all running inside Docker containers on a local machine.

**Primary users:** Individual traders managing a Thai SET portfolio who want a private, fully-controlled dashboard without relying on brokerage web portals.

---

## 2. Goals

| Goal | Description |
|------|-------------|
| Portfolio visibility | See all open positions, P&L, win/loss metrics at a glance |
| Performance analysis | Daily/weekly/monthly charts and drill-down to individual transactions |
| Trade planning | Create and save structured purchase and portfolio action plans |
| AI assistance | Chat with an AI that has context of the portfolio and knowledge base |
| Self-hosted | No cloud dependency; all data stays local; works behind any tunnel |

## 3. Non-Goals

- Multi-user portfolio isolation (one shared Excel source of truth)
- Real-time WebSocket price streaming from the exchange
- Order execution / brokerage integration
- Mobile native app

---

## 4. Technology Stack

### Backend
| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Python | 3.12 |
| Web framework | FastAPI + Uvicorn | 0.115 / 0.30 |
| ORM | SQLAlchemy (async) | 2.0 |
| DB driver | asyncpg | 0.29 |
| Auth | python-jose + passlib + bcrypt | — |
| Cache | redis[hiredis] | 5.0 |
| AI | anthropic SDK + LangChain | ≥0.40 |
| Market data | yfinance | ≥0.2.55 |
| Data | pandas + openpyxl | 2.2 / 3.1 |
| Observability | structlog + prometheus-fastapi-instrumentator | — |

### Frontend
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 14.2 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 3.x |
| Charts | Apache ECharts (echarts-for-react) | — |
| State | Zustand | 4.x |
| Server state | TanStack Query v5 | 5.x |
| Animation | Framer Motion | 11.x |
| HTTP client | Axios | 1.x |

### Infrastructure
| Service | Image | Port |
|---------|-------|------|
| PostgreSQL | postgres:16-alpine | 5432 |
| Redis | redis:7-alpine | 6379 |
| Backend API | custom Python 3.12-slim | 8000 |
| Frontend | custom Node 20-alpine | 3000 |
| Adminer | adminer:latest | 8080 (dev only) |

---

## 5. Application Pages

| URL | Page | Access |
|-----|------|--------|
| `/login` | Login | Public |
| `/forgot-password` | Forgot password | Public |
| `/reset-password` | Reset password (token) | Public |
| `/dashboard` | Overview dashboard | All users |
| `/portfolio` | Portfolio tracker | All users |
| `/action-plan` | Action plan list | All users |
| `/action-plan/purchase/:id` | Purchase plan editor | All users |
| `/action-plan/portfolio/:id` | Portfolio plan editor | All users |
| `/ai-copilot` | AI chat copilot | All users |
| `/settings` | My profile | All users |
| `/settings/documents` | Documentation | All users |
| `/admin/users` | User management | Admin only |

---

## 6. Quick Start

### Prerequisites
- Docker Desktop (with compose v2)
- The Excel file `Investment tracking.xlsx` in a local directory

### Steps

```bash
# 1. Clone / place the project
cd applications/dashboard

# 2. Create backend env file
cp backend/.env.example backend/.env
# Edit backend/.env to set ANTHROPIC_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD

# 3. Update docker-compose.yml volume mount
#    Change the host path for investment_data to match your Excel location

# 4. Build and start all services
docker compose up -d --build

# 5. Open the app
open http://localhost:3000
# Login with the admin credentials you set in step 2
```

### Minimum backend/.env

```env
# Required for AI Copilot
ANTHROPIC_API_KEY=sk-ant-...

# First-run admin account (seeded once on startup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Admin

# Excel source file (set via UI after login, or set here)
INVESTMENT_EXCEL_SOURCE_PATH=/app/investment_data/Investment tracking.xlsx
```

---

## 7. Repository Layout

```
applications/dashboard/
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # App factory + lifespan
│   ├── app/
│   │   ├── api/v1/endpoints/   # Route handlers
│   │   ├── auth/               # JWT + dependencies
│   │   ├── core/               # Config + logging
│   │   ├── database/           # SQLAlchemy + Redis
│   │   ├── middleware/         # Security headers
│   │   ├── models/             # ORM models
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── services/           # Business logic
│   │   └── websocket/          # Socket.IO manager
│   ├── requirements.txt
│   └── .env                    # (gitignored) secrets
├── frontend/                   # Next.js 14 app
│   └── src/
│       ├── app/                # App Router pages
│       ├── components/         # Shared UI components
│       ├── services/           # API service layer
│       ├── store/              # Zustand state stores
│       └── types/              # TypeScript types
├── docker/                     # Dockerfiles
│   ├── Dockerfile.backend
│   └── Dockerfile.frontend
├── docs/                       # This documentation
├── scripts/                    # DB init SQL
└── docker-compose.yml
```
