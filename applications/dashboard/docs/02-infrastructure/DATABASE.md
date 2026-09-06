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

## 6. Financial Tracker tables (separate bounded context)

The `ft_tracking_set`, `ft_category`, `ft_sub_category`, `ft_tracking_item`, and `ft_initial_investment_entry` tables (Phase 1), plus `ft_update_tracking_list` and `ft_update_tracking_list_balance` (Phase 2), `ft_bond` (Phase 7), and `ft_item_type` + `ft_item_type_capability` (Configurable Item Types / ADR-027) — **10 tables** — live in this **same physical Postgres database** but are owned and migrated by the independent `tracking-backend` microservice, not by this `backend` service. They are intentionally excluded from the table inventory above: they carry **no foreign keys** to `users` or any table in this section, and are managed by a separate Alembic chain with its own `ft_alembic_version` bookkeeping table.

Later `tracking-backend` migrations:

| Revision | Phase / ADR | Date | Change |
|---|---|---|---|
| `e7c4d9b21a83` | Phase 5 / ADR-018 | 2026-08-30 | Add additive nullable `ft_initial_investment_entry.note VARCHAR(500) NULL`. |
| `ea8407e31992` | Phase 7 / ADR-024, ADR-025 | 2026-08-31 | Widen `ck_ft_tracking_item_type` from 6 → **7** values (add `'BOND'`) by drop + recreate; create `ft_bond`. |
| `00f7a890545d` | Phase 7 / ADR-023 | 2026-08-31 | Add additive nullable `ft_initial_investment_entry.code VARCHAR(100) NULL` and `name VARCHAR(100) NULL`. |
| `b1c2d3e4f5a6` | Phase 7 enhancement / ADR-026 | 2026-09-02 | Add additive nullable `ft_bond.interest_rate NUMERIC(19,4) NULL` (annual rate stored as a percent) + CHECK `ck_ft_bond_interest_rate_range` (`interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100)`). No backfill, no index. Lossy `downgrade()`. |
| `c2d3e4f5a6b7` | Configurable Item Types / ADR-027 | 2026-09-06 | Create `ft_item_type` + `ft_item_type_capability`; seed the 7 pre-existing types as `is_system` rows (fixed literal UUIDs) + the `property→counts_as_property` and `bond→bond_register` grants; add `ft_tracking_item.type_id UUID` FK → `ft_item_type.id` **ON DELETE RESTRICT** (nullable → backfilled by exact `label == old type string` match, hard-abort guard → `SET NOT NULL` + `ix_ft_tracking_item_type_id`); add `BEFORE INSERT OR UPDATE` trigger `ft_tracking_item_sync_type` (sets `type := ft_item_type.label` when `type_id` set); **drop `ck_ft_tracking_item_type`**; widen the now-denormalised `ft_tracking_item.type` `VARCHAR(30)` → `VARCHAR(100)`. Guarded `downgrade()` — lossless only in the safe window (no custom type, no renamed system label), else raises. The `type` string column is **not** dropped here — a later follow-up migration drops it. **New chain head.** |

`ft_tracking_item.type` — **no longer a CHECK-enumerated column.** Migration `c2d3e4f5a6b7` (ADR-027) dropped `ck_ft_tracking_item_type`; integrity is now the FK `ft_tracking_item.type_id → ft_item_type.id` (`ON DELETE RESTRICT`). The `type` `VARCHAR(100)` column is kept transitionally as a trigger-synced denormalised copy of `ft_item_type.label` and will be dropped by a follow-up migration once no code reads it. The 7 seeded `ft_item_type.label` values are verbatim the old CHECK list: `'Bank account'`, `'Property'`, `'Investment Account'`, `'TaxSaving'`, `'Materials'`, `'Insurance'`, `'BOND'`.

`ft_item_type` (Configurable Item Types / ADR-027) — one configurable tracking-item type:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK, `uuid_generate_v4()`. The 7 seeded `is_system` rows use fixed literal UUIDs. |
| `slug` | varchar(50) | No | `UNIQUE` (`uq_ft_item_type_slug`). Immutable code-facing key; `CHECK ck_ft_item_type_slug_format (slug ~ '^[a-z0-9_]+$')`. Never editable via any endpoint. |
| `label` | varchar(100) | No | Human-facing name; admin-editable for every row. Case-/trim-insensitive uniqueness via functional index `uq_ft_item_type_label_ci` on `lower(trim(label))`. |
| `sort_order` | int | No | DEFAULT `0`. Ascending display order (seeded 0..6). |
| `is_system` | bool | No | DEFAULT `false`. `true` for the 7 seeds — archive-only, capabilities locked. |
| `is_archived` | bool | No | DEFAULT `false`. Hidden from the new-assignment picker; still valid on existing items. Partial index `ix_ft_item_type_active (sort_order) WHERE is_archived = false`. |
| `created_by` | uuid | Yes | JWT `sub` of the creating admin; `NULL` for seeds. **No FK** (bounded-context isolation). |
| `created_at` / `updated_at` | timestamptz | No | DEFAULT `now()`; `updated_at` also `onupdate now()`. |

`ft_item_type_capability` (Configurable Item Types / ADR-027) — a `(type, capability)` grant:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `item_type_id` | uuid | No | FK → `ft_item_type.id` **ON DELETE CASCADE**. Composite PK part. |
| `capability_key` | varchar(50) | No | Composite PK part. **No DB CHECK** — validated against the code enum (`counts_as_property`, `bond_register`) at the service layer, so adding a capability later is a code-only change. |

Composite PK `(item_type_id, capability_key)`. Seeded grants: `property → counts_as_property`, `bond → bond_register`.

`ft_bond` (Phase 7) — one row per registered bond holding, attached to a `ft_tracking_item` of type `BOND`:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK, `uuid_generate_v4()` |
| `tracking_item_id` | uuid | No | FK → `ft_tracking_item.id` **ON DELETE CASCADE**. Indexed (`ix_ft_bond_tracking_item_id`). |
| `code` | varchar(100) | No | Required identifier. No uniqueness constraint. |
| `issuer` | varchar(200) | Yes | Blank / whitespace-only coerced to `NULL`. |
| `start_date` | date | Yes | Optional start / issue date. |
| `expired_date` | date | Yes | Optional maturity / expiry date. Not validated against `start_date`. |
| `amount` | numeric(19,4) | No | `CHECK ck_ft_bond_amount_nonneg (amount >= 0)` — zero allowed. |
| `interest_rate` | numeric(19,4) | Yes | *(Phase 7 enhancement / ADR-026 — migration `b1c2d3e4f5a6`)* Optional annual interest rate stored as a **percent** (`3.25` = 3.25% p.a.). `CHECK ck_ft_bond_interest_rate_range (interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100))`. 4 dp, excess precision rounded on write. No backfill — pre-existing rows are `NULL`. Nullable-clearable on update. |
| `created_at` / `updated_at` | timestamptz | No | DEFAULT `now()`; `updated_at` also `onupdate now()`. |

`ft_bond` has **no `user_id` column** — ownership is resolved by joining to `ft_tracking_item.user_id`. It has **no `status` column** — status is computed on every read from the dates versus the current Asia/Bangkok date, never stored. It likewise has **no `years` column** *(Phase 7 enhancement / ADR-026)* — `years` = `round_half_up((expired_date - start_date).days / 365.25)` as an integer (`NULL` if either date is missing; not clamped for inverted dates) is derived on every read and never persisted, the same treatment as `status`.

Full schema, indexes, constraints, and entity relationships for all 10 tables: `18-financial-tracker/TECHNICAL.html` §3–4 (and §15–16 for the Phase 7 bond register and its ADR-026 enhancement, §17 for Configurable Item Types / ADR-027).

---

## 7. Migration History

All Alembic migrations in chronological order. Run `alembic upgrade head` to apply all pending migrations.

| Migration ID | Date | Description |
|---|---|---|
| `a6bcb833f755` | 2026-06-01 | Add `symbol_notes` table |
| `b7d4e2f19a3c` | 2026-06-13 | Add `weekly_reviews` and `weekly_review_items` tables (initial schema) |
| `c9e3a1f82b5d` | 2026-06-13 | Refactor `weekly_review_items`: replace single-leg columns with separate buy/sell leg columns; add `week_open_price`/`week_close_price`; rename `item_type` values from `BUY`\|`SELL` to `TRADE` |
| `d4f8c2e73b1a` | 2026-06-14 | Split single `feeling` column into `buy_feeling` + `sell_feeling` |

---

## 8. In-App Backup / Restore Coverage

The admin **Settings → Backup** feature (`backend/app/api/v1/endpoints/backup.py`) backs up
and restores **every table in `investment_db`** — both the `backend` tables in section 2 and
the `tracking-backend`-owned `ft_*` tables in section 6, which share this one physical
database. There is **no hard-coded table list**: the table set and a foreign-key-safe insert
order are discovered from the live PostgreSQL catalogue (`pg_class`, `pg_constraint`) on
every call via a deterministic Kahn topological sort, so a table added by any future
migration in either service is covered automatically.

Full design (file format v2.0, restore transaction/rollback model, the
`session_replication_role` superuser requirement, advisory locking, configuration) is in
`19-backup-restore/TECHNICAL.html`. Endpoint contract and error catalogue:
`02-infrastructure/API-BACKUP.html`. Operations: `19-backup-restore/RUNBOOK.html`.

### 8.1 Covered tables

At the ship date (2026-09-01), `GET /api/v1/backup/tables` reported **28 covered tables**
plus the 2 excluded schema-version tables. 27 of the covered tables map to current ORM
models across the two services; discovery also captures any additional live table. The
always-current list is the response of `GET /api/v1/backup/tables`. Discovery is fully
dynamic, so the two `ft_item_type*` tables added by migration `c2d3e4f5a6b7` (ADR-027,
2026-09-06) are covered automatically with no code change — they simply post-date this
snapshot's count.

| Owner service | Covered tables (backed up and restorable) |
|---|---|
| `backend` (19 model tables) | `users`, `action_plans`, `purchase_plan_items`, `portfolio_plan_items`, `portfolios`, `holdings`, `investment_transactions`, `portfolio_cash_transactions`, `portfolio_positions_db`, `symbol_notes`, `dr_mappings`, `daily_performance`, `user_scan_configs`, `user_symbol_lists`, `weekly_scans`, `weekly_scan_items`, `pe_scan_results`, `weekly_reviews`, `weekly_review_items` |
| `tracking-backend` (10 `ft_*` tables) | `ft_tracking_set`, `ft_category`, `ft_sub_category`, `ft_tracking_item`, `ft_initial_investment_entry`, `ft_update_tracking_list`, `ft_update_tracking_list_balance`, `ft_bond`, `ft_item_type`, `ft_item_type_capability` |

### 8.2 Excluded tables

| Table | Owner | Why excluded |
|---|---|---|
| `alembic_version` | `backend` | Schema-version bookkeeping owned by the Alembic migration chain. Captured in the backup file under `schema_versions` for reference, but **never written by a restore** — a data restore must not roll a schema forward or backward. File-vs-live drift is reported as `schema_version_drift`. Also rejected by the PSV per-table endpoints (`400 urn:backup:error:schema-version-table`). |
| `ft_alembic_version` | `tracking-backend` | Same as above, for the independent `tracking-backend` Alembic chain. |

### 8.3 Cross-service access requirement

The backup code runs inside the `backend` service but reads and writes the `ft_*` tables
directly. This works only because both services connect as the same PostgreSQL superuser in
this deployment. If the roles are split, the `backend` role must keep
`SELECT`/`INSERT`/`TRUNCATE`/`TRIGGER` on the `ft_*` tables **and** be superuser-capable
(restore issues `SET session_replication_role = replica`), or restore fails with
`500 urn:backup:error:insufficient-privilege`.
