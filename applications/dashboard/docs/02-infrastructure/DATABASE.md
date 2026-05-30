# Database Schema

PostgreSQL 16. All tables created automatically by SQLAlchemy `Base.metadata.create_all` on backend startup (no Alembic migration required for current schema).

---

## 1. Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram indexes (future search)
```

---

## 2. Tables

### `users`

Stores all authenticated users.

```sql
CREATE TABLE users (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    email            VARCHAR(255) NOT NULL UNIQUE,
    name             VARCHAR(255) NOT NULL,
    hashed_password  VARCHAR(255) NOT NULL,
    role             user_role    NOT NULL DEFAULT 'viewer',
                                  -- ENUM: 'admin' | 'analyst' | 'viewer'
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW(),
    last_login_at    TIMESTAMPTZ
);

CREATE INDEX ON users (email);
```

**ORM:** `backend/app/models/user.py — class User`

| Field | Notes |
|-------|-------|
| `id` | UUID, PK, auto |
| `email` | Unique, used for login |
| `hashed_password` | bcrypt via passlib |
| `role` | PostgreSQL ENUM `user_role` |
| `is_active` | Soft-disable without deleting |
| `last_login_at` | Updated on every successful login |

---

### `action_plans`

Header record for both Purchase and Portfolio action plans.

```sql
CREATE TABLE action_plans (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(200) NOT NULL,
    plan_type   VARCHAR(20)  NOT NULL,     -- 'purchase' | 'portfolio'
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON action_plans (created_by, plan_type);
```

**ORM:** `backend/app/models/action_plan.py — class ActionPlan`

---

### `purchase_plan_items`

One row per stock in a Purchase Action Plan.

```sql
CREATE TABLE purchase_plan_items (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id       UUID         NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
    sort_order    INTEGER      NOT NULL DEFAULT 0,
    stock         VARCHAR(20)  NOT NULL DEFAULT '',
    current_price NUMERIC(14,4),             -- fetched from yfinance at plan time
    size          INTEGER,                   -- number of shares
    buy_price     NUMERIC(14,4),             -- intended entry price
    tp            NUMERIC(14,4),             -- take-profit
    sl            NUMERIC(14,4),             -- stop-loss
    strategy      VARCHAR(200),              -- free text / preset
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON purchase_plan_items (plan_id);
```

**ORM:** `backend/app/models/action_plan.py — class PurchasePlanItem`

---

### `portfolio_plan_items`

One row per open position in a Portfolio Action Plan.

```sql
CREATE TABLE portfolio_plan_items (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id       UUID         NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
    sort_order    INTEGER      NOT NULL DEFAULT 0,
    symbol        VARCHAR(20)  NOT NULL DEFAULT '',
    current_price NUMERIC(14,4),             -- snapshot at save time
    size          INTEGER,                   -- position size
    entry_price   NUMERIC(14,4),             -- original entry
    tp            NUMERIC(14,4),             -- user-defined target price
    sl            NUMERIC(14,4),             -- user-defined stop-loss
    order_size    INTEGER,                   -- shares to buy/sell in the action
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON portfolio_plan_items (plan_id);
```

**ORM:** `backend/app/models/action_plan.py — class PortfolioPlanItem`

---

## 3. Entity Relationships

```
users (1)
  └─── action_plans (N)  [created_by → users.id  ON DELETE SET NULL]
         ├─── purchase_plan_items (N)  [plan_id → action_plans.id  ON DELETE CASCADE]
         └─── portfolio_plan_items (N) [plan_id → action_plans.id  ON DELETE CASCADE]
```

---

## 4. Redis (non-relational)

Redis is used for ephemeral data only. Keys are prefixed and have TTLs set by the application.

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `blacklist:<token_jti>` | remaining token lifetime | Logout / token blacklist |
| `pwd_reset:<token>` | 3600 s (1 h) | Password reset tokens |

The Redis client is a custom `CacheClient` wrapper at `backend/app/database/redis.py`.

---

## 5. Model Registration

All ORM models must be imported in `backend/main.py` lifespan before `Base.metadata.create_all` is called:

```python
from app.models.user import User                                           # noqa: F401
from app.models.action_plan import ActionPlan, PurchasePlanItem, PortfolioPlanItem  # noqa: F401
# ... future models here
async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
```

Importing a model that is never otherwise used is intentional — it registers the mapper.
