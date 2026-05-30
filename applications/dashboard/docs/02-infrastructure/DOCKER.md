# Docker & Deployment

---

## 1. docker-compose.yml — Full Service Definitions

```yaml
version: "3.9"
networks:
  dashboard-net:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  uploads_data:

services:
  postgres:
    image: postgres:16-alpine
    container_name: inv_postgres
    restart: unless-stopped
    networks: [dashboard-net]
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: investment_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init_db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d investment_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: inv_redis
    restart: unless-stopped
    networks: [dashboard-net]
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes: [redis_data:/data]
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile.backend
    container_name: inv_backend
    restart: unless-stopped
    networks: [dashboard-net]
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    environment:
      APP_ENV: development
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@postgres:5432/investment_db
      REDIS_URL: redis://redis:6379/0
      CORS_ORIGINS: '["*"]'
      LOG_LEVEL: INFO
    env_file: [backend/.env]      # secrets (API keys, ADMIN_*)
    volumes:
      - ./backend:/app:cached                                     # hot-reload in dev
      - uploads_data:/app/uploads                                  # working Excel copy
      - /path/to/investmentPlan:/app/investment_data:ro            # source Excel (ro)
      - /path/to/investmentAgent:/app/investment_agent:ro          # AI knowledge base (ro)
      - ./docs:/app/docs:ro                                        # documentation
    ports: ["8000:8000"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health/live"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 30s

  frontend:
    build:
      context: .
      dockerfile: docker/Dockerfile.frontend
    container_name: inv_frontend
    restart: unless-stopped
    networks: [dashboard-net]
    depends_on:
      backend: { condition: service_healthy }
    environment:
      BACKEND_URL: http://backend:8000    # runtime only — not baked at build time
      NODE_ENV: production
    ports: ["3000:3000"]

  adminer:
    image: adminer:latest
    container_name: inv_adminer
    restart: unless-stopped
    networks: [dashboard-net]
    depends_on: [postgres]
    ports: ["8080:8080"]
    profiles: [dev]         # only starts with: docker compose --profile dev up
```

---

## 2. Backend Dockerfile (`docker/Dockerfile.backend`)

Multi-stage build: `builder` installs Python packages into `/root/.local`; `runtime` copies them to the non-root `appuser`.

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y gcc libpq-dev curl
COPY backend/requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

FROM python:3.12-slim AS runtime
RUN addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --no-create-home appuser
WORKDIR /app
RUN apt-get update && apt-get install -y libpq5 curl
COPY --from=builder /root/.local /home/appuser/.local
COPY backend/ .
RUN chown -R appuser:appgroup /app
USER appuser
ENV PATH=/home/appuser/.local/bin:$PATH
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

---

## 3. Frontend Dockerfile (`docker/Dockerfile.frontend`)

Three-stage build: `deps` installs npm packages; `builder` runs `next build`; `runtime` uses Next.js standalone output.

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY frontend/package.json ./
RUN npm install --no-audit --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
RUN npm run build          # output.standalone in next.config.js

FROM node:20-alpine AS runtime
RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --ingroup nodejs --disabled-password nextjs
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
ENV NODE_ENV=production PORT=3000
CMD ["node", "server.js"]
```

**Key:** `next.config.js` must have `output: 'standalone'` for this Dockerfile to work.

---

## 4. Environment Variables (Complete Reference)

### Backend (`backend/.env` — secrets only; rest via docker-compose `environment:`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | For AI | `""` | Anthropic Claude API key |
| `OPENAI_API_KEY` | No | `""` | OpenAI API key (optional) |
| `ADMIN_EMAIL` | Recommended | `""` | First-run admin email (blank = no seed) |
| `ADMIN_PASSWORD` | Recommended | `""` | First-run admin password |
| `ADMIN_NAME` | No | `Administrator` | First-run admin display name |
| `JWT_SECRET_KEY` | Recommended | random | HS256 signing secret (set explicitly in prod) |
| `INVESTMENT_EXCEL_SOURCE_PATH` | No | `/app/investment_data/Investment tracking.xlsx` | Source Excel (can override via Settings UI) |
| `INVESTMENT_EXCEL_PATH` | No | `/app/uploads/investment_tracking.xlsx` | Working copy path |

### Docker-compose `environment:` (non-secret)

| Variable | Value | Description |
|----------|-------|-------------|
| `APP_ENV` | `development` | `development` / `staging` / `production` |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@postgres:5432/investment_db` | Postgres DSN |
| `REDIS_URL` | `redis://redis:6379/0` | Redis DSN |
| `CORS_ORIGINS` | `'["*"]'` | JSON array (wildcard since proxy handles CORS) |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

### Frontend (`environment:` in docker-compose)

| Variable | Value | Description |
|----------|-------|-------------|
| `BACKEND_URL` | `http://backend:8000` | Internal Docker URL for the proxy route |
| `NODE_ENV` | `production` | Controls Next.js optimisations |

> **Note:** Do NOT use `NEXT_PUBLIC_*` vars for API URLs. They are baked at build time. Use `BACKEND_URL` (runtime, server-side only via the proxy route).

---

## 5. Common Commands

```bash
# Build + start everything
docker compose up -d --build

# Rebuild and restart specific service
docker compose build backend && docker compose up -d backend

# View logs
docker logs inv_backend -f
docker logs inv_frontend -f

# Access PostgreSQL
docker exec -it inv_postgres psql -U postgres -d investment_db

# Access Redis
docker exec -it inv_redis redis-cli

# Restart with Adminer (DB browser on :8080)
docker compose --profile dev up -d

# Tear down (preserves volumes)
docker compose down

# Tear down + delete data
docker compose down -v
```

---

## 6. Volume Mounts

| Named Volume / Host Path | Container Path | Mode | Purpose |
|--------------------------|----------------|------|---------|
| `postgres_data` | `/var/lib/postgresql/data` | rw | PostgreSQL data |
| `redis_data` | `/data` | rw | Redis AOF persistence |
| `uploads_data` | `/app/uploads` | rw | Working Excel copy + `.cache_bust` |
| `./backend` | `/app` | cached | Hot-reload (dev); baked in for prod (not mounted) |
| `<host Excel dir>` | `/app/investment_data` | **ro** | Source Excel file |
| `<host agent dir>` | `/app/investment_agent` | **ro** | AI knowledge base + scripts |
| `./docs` | `/app/docs` | **ro** | Markdown documentation |

---

## 7. Health Checks

| Service | Test | Start Period |
|---------|------|-------------|
| PostgreSQL | `pg_isready -U postgres -d investment_db` | — |
| Redis | `redis-cli ping` | — |
| Backend | `curl -f http://localhost:8000/api/v1/health/live` | 30 s |
| Frontend | none (depends on backend being healthy) | — |

The backend `/api/v1/health/live` returns `{"status":"ok"}` once Uvicorn is accepting connections.
