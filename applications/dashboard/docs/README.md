# Enterprise AI Investment Dashboard

A production-grade, AI-native investment platform with real-time interactive analytics, portfolio management, and an embedded AI copilot.

---

## Architecture

```
applications/dashboard/
├── frontend/          Next.js 14 + React 18 + TypeScript
├── backend/           FastAPI + Python 3.12 async
├── docker/            Multi-stage Dockerfiles
├── k8s/               Kubernetes manifests
├── .github/workflows/ GitHub Actions CI/CD
├── scripts/           Dev setup scripts
└── docs/              Documentation
```

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Charts | Apache ECharts (echarts-for-react) |
| Grid | AG Grid Community, react-grid-layout |
| Animations | Framer Motion |
| State | Zustand (client), React Query (server) |
| Real-time | Socket.IO |
| Backend | FastAPI, Python 3.12, asyncio |
| ORM | SQLAlchemy 2.0 async + asyncpg |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Auth | JWT (HS256) + RBAC |
| AI | LangChain + Anthropic Claude |
| Infra | Docker, Kubernetes, GitHub Actions |

---

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
cd applications/dashboard

# Copy env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Edit your API keys
nano backend/.env

# Start everything
docker compose up -d

# With dev tools (Adminer DB UI)
docker compose --profile dev up -d
```

Services:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/api/docs
- Adminer (dev): http://localhost:8080

### Option 2: Local development

```bash
cd applications/dashboard
chmod +x scripts/dev.sh
./scripts/dev.sh
```

---

## Interactive Dashboard

The dashboard is fully interactive with drag-and-drop widget layout:

| Widget | Description |
|---|---|
| Portfolio Summary | Live P&L, total value, daily return metrics |
| Performance Chart | ECharts line chart with period selector (1D–ALL) |
| Holdings Table | AG Grid with real-time price updates |
| Allocation Chart | Donut chart by sector |
| Risk Metrics | Sharpe, VaR, Max Drawdown, Beta, Alpha |
| AI Insights | Embedded streaming AI copilot chat |

**Customise layout**: Click "Edit layout" to drag/resize/reorder widgets. Layout is persisted to localStorage.

---

## AI Copilot

The AI Insights widget provides:
- Embedded portfolio-aware chat
- Streaming token-by-token responses via WebSocket
- Quick-prompt shortcuts
- Context from live portfolio data

Full-page copilot: `/ai-copilot`

---

## API Reference

Base URL: `http://localhost:8000/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Get JWT tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/me` | Current user profile |
| GET | `/portfolios` | List portfolios |
| GET | `/portfolios/{id}` | Portfolio detail |
| GET | `/portfolios/{id}/holdings` | Holdings with live prices |
| GET | `/portfolios/{id}/performance` | Performance time series |
| GET | `/portfolios/{id}/metrics` | Risk/return metrics |
| POST | `/ai/copilot/chat` | Initiate AI chat session |
| GET | `/health` | Health status |

Interactive docs: http://localhost:8000/api/docs

---

## WebSocket Events

Connect to `ws://localhost:8000` with Socket.IO.

| Event | Direction | Payload |
|---|---|---|
| `quote_update` | server→client | `{ symbol, price, change, changePct }` |
| `portfolio_update` | server→client | Portfolio summary object |
| `ai_stream_token` | server→client | `{ session_id, token }` |
| `ai_stream_end` | server→client | `{ session_id }` |
| `notification` | server→client | Notification object |
| `subscribe` | client→server | `{ channel: "portfolio:{id}" }` |

---

## Kubernetes Deployment

```bash
# Create namespace and apply all manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Edit secrets first!
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml
```

Update `k8s/configmap.yaml` and `k8s/ingress.yaml` with your domain before applying.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Async PostgreSQL connection string | localhost |
| `REDIS_URL` | Redis connection string | localhost |
| `APP_SECRET_KEY` | JWT signing secret | random |
| `ANTHROPIC_API_KEY` | Anthropic API key | required |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT access TTL | 30 |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL |

---

## Project Status

**Foundation complete.** The following are scaffolded and ready for business logic:

- [x] Interactive drag-and-drop dashboard
- [x] Dark-mode design system with Tailwind tokens
- [x] Responsive layout (mobile / tablet / desktop)
- [x] Real-time WebSocket foundation (Socket.IO)
- [x] ECharts portfolio chart with period selector
- [x] AG Grid holdings table with filter
- [x] AI copilot streaming chat widget
- [x] JWT authentication flow
- [x] FastAPI async backend with health/auth/portfolio/AI endpoints
- [x] PostgreSQL + Redis connection layer
- [x] Multi-stage Docker builds
- [x] Kubernetes manifests (Deployment, Service, HPA, PDB, Ingress)
- [x] GitHub Actions CI/CD pipeline

**Next steps:**
- Connect market data provider (Polygon.io / Yahoo Finance)
- Implement real LangChain AI responses
- Add Alembic migrations
- File upload (Excel/CSV → portfolio import)
- User management admin panel
