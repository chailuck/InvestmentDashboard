# Database Schema

PostgreSQL 16. Schema is managed by Alembic migrations (`alembic upgrade head`). SQLAlchemy `Base.metadata.create_all` is still called at startup as a development convenience, but Alembic is the canonical migration path. Migration files live in `backend/alembic/versions/`.

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
    notes       TEXT,                      -- freeform notes for the plan
    set_analysis TEXT,                     -- market analysis text (AI or manual)
    ai_recommend TEXT,                     -- AI recommendation text
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON action_plans (created_by, plan_type);
```

**ORM:** `backend/app/models/action_plan.py — class ActionPlan`

| Field | Notes |
|-------|-------|
| `plan_type` | `'purchase'` \| `'portfolio'` — determines which child table holds line items |
| `notes` | Freeform analyst notes for this plan |
| `set_analysis` | SET market analysis text; may be AI-generated or manually entered |
| `ai_recommend` | AI recommendation text; populated by the AI assist feature |

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
    reason        TEXT,                      -- user rationale for this trade idea
    triggered     BOOLEAN      NOT NULL DEFAULT FALSE,  -- true once price hits buy zone
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ON purchase_plan_items (plan_id);
```

**ORM:** `backend/app/models/action_plan.py — class PurchasePlanItem`

| Field | Notes |
|-------|-------|
| `current_price` | Snapshot fetched from yfinance at save time; not live |
| `reason` | User's rationale for including this stock in the plan |
| `triggered` | Set to `TRUE` once the live price enters the buy zone; used for alert UI |

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

### `user_scan_configs`

Legacy per-user single watchlist for weekly scans. Superseded by `user_symbol_lists` but retained for migration compatibility.

```sql
CREATE TABLE user_scan_configs (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    symbols     JSONB        NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
```

**ORM:** `backend/app/models/weekly_scan.py — class UserScanConfig`

| Field | Notes |
|-------|-------|
| `symbols` | JSONB array of uppercase ticker strings; auto-seeded to SET50 defaults on first access |

---

### `user_symbol_lists`

Named, ordered symbol lists supporting multiple watchlists per user.

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

**ORM:** `backend/app/models/weekly_scan.py — class UserSymbolList`

| Field | Notes |
|-------|-------|
| `market` | `SET` \| `US` \| `HK` \| `CRYPTO` \| `OTHER` — drives yfinance ticker suffix logic |
| `symbols` | JSONB array of uppercase tickers |
| `sort_order` | Display order; new lists placed after current maximum |

---

### `weekly_scans`

Header record for a dated weekly scan session.

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

**ORM:** `backend/app/models/weekly_scan.py — class WeeklyScan`

Name convention `WEEKLY_SCAN_DD_MM_YYYY` — the embedded date is parsed server-side to derive the Monday open / Friday close window for price fetching.

---

### `weekly_scan_items`

One row per symbol within a scan. All evaluation fields are nullable until the analyst populates them.

```sql
CREATE TABLE weekly_scan_items (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id     UUID         NOT NULL REFERENCES weekly_scans(id) ON DELETE CASCADE,
    symbol      VARCHAR(30)  NOT NULL,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    list_name   VARCHAR(100),
    market      VARCHAR(20)  NOT NULL DEFAULT 'SET',

    -- Evaluation fields
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

**ORM:** `backend/app/models/weekly_scan.py — class WeeklyScanItem`

| Field | Notes |
|-------|-------|
| `list_name` | Denormalised from `UserSymbolList.name` at scan-creation time for display grouping |
| `color_mark` | Nullable; `CYAN` \| `GREEN` \| `YELLOW` \| `RED` \| `PURPLE` |
| `buy_price`, `tp`, `sl` | 14-digit precision with 4 decimal places (supports sub-baht precision) |

---

### `weekly_reviews`

Header record for one ISO weekly review per user. One row per user per week; the unique constraint on `(user_id, week_start)` enforces this. The review is auto-created on first access to the current-week endpoint.

```sql
CREATE TABLE weekly_reviews (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start  DATE         NOT NULL,
    week_end    DATE         NOT NULL,
    name        VARCHAR(100) NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT uq_review_user_week UNIQUE (user_id, week_start)
);

CREATE INDEX ix_weekly_reviews_user_id ON weekly_reviews (user_id);
```

**ORM:** `backend/app/models/weekly_review.py — class WeeklyReview`

| Field | Notes |
|-------|-------|
| `week_start` | Monday of the ISO week (always Monday); used as the canonical week identifier |
| `week_end` | Sunday of the same ISO week |
| `name` | Auto-generated as `"Week {N} ({DD Mon}–{DD Mon YYYY})"` on creation; editable by the user |
| `notes` | Analyst's free-text summary for the week; appears in the review header |

---

### `weekly_review_items`

One row per position within a weekly review. Supports two item types: `TRADE` (positions with buy/sell activity this week) and `HOLD` (open positions with no activity). Both legs (buy and sell) are independently nullable — a trade may be entry-only (still open) or exit-only (previously entered).

```sql
CREATE TABLE weekly_review_items (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id           UUID         NOT NULL REFERENCES weekly_reviews(id) ON DELETE CASCADE,
    symbol              VARCHAR(30)  NOT NULL,
    item_type           VARCHAR(10)  NOT NULL,    -- TRADE | HOLD

    -- Buy leg (entry this week)
    buy_date            DATE,
    buy_price           NUMERIC(14,4),
    buy_size            INTEGER,

    -- Sell leg (exit this week)
    sell_date           DATE,
    sell_price          NUMERIC(14,4),
    sell_size           INTEGER,

    -- User annotations
    buy_reason          TEXT,
    buy_feeling         SMALLINT,    -- 1=Very Bad … 5=Very Good; null = unrated
    sell_reason         TEXT,
    sell_feeling        SMALLINT,    -- 1=Very Bad … 5=Very Good; null = unrated

    -- Week price snapshot (fetched from yfinance on demand)
    week_open_price     NUMERIC(14,4),   -- Monday open of review week
    week_close_price    NUMERIC(14,4),   -- Friday close of review week

    -- Optional back-link to portfolio DB source position
    source_position_id  UUID  REFERENCES portfolio_positions_db(id) ON DELETE SET NULL,

    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX ix_weekly_review_items_review_id ON weekly_review_items (review_id);
```

**ORM:** `backend/app/models/weekly_review.py — class WeeklyReviewItem`

| Field | Notes |
|-------|-------|
| `item_type` | `TRADE` = had buy and/or sell activity during the week; `HOLD` = open position with no activity |
| `buy_date`, `buy_price`, `buy_size` | Buy leg fields; null if position was not entered this week |
| `sell_date`, `sell_price`, `sell_size` | Sell leg fields; null if position was not exited this week |
| `buy_feeling` / `sell_feeling` | Independent 1–5 ratings (1 = Very Bad, 5 = Very Good); null = unrated. `buy_feeling` was previously a single `feeling` column, split in migration `d4f8c2e73b1a` (2026-06-14) |
| `week_open_price` | Monday open price for the review week; fetched from yfinance via `/refresh-prices` |
| `week_close_price` | Friday close price for the review week; falls back to latest available close for in-progress weeks |
| `week_change_pct` | **Computed, not stored.** Derived as `(week_close_price - week_open_price) / week_open_price * 100` by the API response serialiser. Appears in API responses but is not a database column. |
| `source_position_id` | Links to `portfolio_positions_db` for auto-synced items; null for manually entered items |

---

## 3. Entity Relationships

```
users (1)
  ├─── action_plans (N)          [created_by → users.id  ON DELETE SET NULL]
  │      ├─── purchase_plan_items (N)   [plan_id → action_plans.id  ON DELETE CASCADE]
  │      └─── portfolio_plan_items (N)  [plan_id → action_plans.id  ON DELETE CASCADE]
  ├─── user_scan_configs (1)     [user_id → users.id  ON DELETE CASCADE]
  ├─── user_symbol_lists (N)     [user_id → users.id  ON DELETE CASCADE]
  ├─── weekly_scans (N)          [user_id → users.id  ON DELETE CASCADE]
  │      └─── weekly_scan_items (N)     [scan_id → weekly_scans.id  ON DELETE CASCADE]
  ├─── weekly_reviews (N)        [user_id → users.id  ON DELETE CASCADE]
  │      └─── weekly_review_items (N)   [review_id → weekly_reviews.id  ON DELETE CASCADE]
  │                                     [source_position_id → portfolio_positions_db.id  ON DELETE SET NULL]
  └─── portfolio_positions_db (N) [user_id → users.id  ON DELETE CASCADE]
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
from app.models.user import User
from app.models.action_plan import ActionPlan, PurchasePlanItem, PortfolioPlanItem
from app.models.weekly_scan import WeeklyScan, WeeklyScanItem, UserScanConfig, UserSymbolList
from app.models.weekly_review import WeeklyReview, WeeklyReviewItem
from app.models.portfolio_db import PortfolioDbPosition
from app.models.symbol_note import SymbolNote
# dr_mappings model is also registered
async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
```

Importing a model that is never otherwise used is intentional — it registers the mapper.

---

## 6. Migration History

All Alembic migrations in chronological order. Run `alembic upgrade head` to apply all pending migrations.

| Migration ID | Date | Description |
|---|---|---|
| `a6bcb833f755` | 2026-06-01 | Add `symbol_notes` table |
| `b7d4e2f19a3c` | 2026-06-13 | Add `weekly_reviews` and `weekly_review_items` tables (initial schema) |
| `c9e3a1f82b5d` | 2026-06-13 | Refactor `weekly_review_items`: replace single-leg columns with separate buy/sell leg columns; add `week_open_price`/`week_close_price`; rename `item_type` values from `BUY`\|`SELL` to `TRADE` |
| `d4f8c2e73b1a` | 2026-06-14 | Split single `feeling` column into `buy_feeling` + `sell_feeling` |
