# Action Plan — Technical Design

## 1. Database Schema

Three PostgreSQL tables, all UUID-keyed.

### `action_plans`

```sql
CREATE TABLE action_plans (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(200)  NOT NULL,
    plan_type   VARCHAR(20)   NOT NULL,          -- 'purchase' | 'portfolio'
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ   DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX ON action_plans (created_by, plan_type);
```

### `purchase_plan_items`

```sql
CREATE TABLE purchase_plan_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id       UUID NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    stock         VARCHAR(20)  NOT NULL DEFAULT '',
    current_price NUMERIC(14,4),
    size          INTEGER,
    buy_price     NUMERIC(14,4),
    tp            NUMERIC(14,4),
    sl            NUMERIC(14,4),
    strategy      VARCHAR(200),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON purchase_plan_items (plan_id);
```

### `portfolio_plan_items`

```sql
CREATE TABLE portfolio_plan_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id       UUID NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    symbol        VARCHAR(20)  NOT NULL DEFAULT '',
    current_price NUMERIC(14,4),
    size          INTEGER,
    entry_price   NUMERIC(14,4),
    tp            NUMERIC(14,4),
    sl            NUMERIC(14,4),
    order_size    INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON portfolio_plan_items (plan_id);
```

**Table creation** is handled automatically by SQLAlchemy's `Base.metadata.create_all` in the FastAPI lifespan startup (no Alembic migration needed for greenfield tables).

---

## 2. Backend — FastAPI

### File locations

```
backend/app/models/action_plan.py         ← SQLAlchemy ORM models
backend/app/schemas/action_plan.py        ← Pydantic input schemas
backend/app/api/v1/endpoints/action_plan.py  ← Router + handlers
```

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/action-plans/suggest-name?plan_type=` | Bearer | Unique name for today |
| `GET` | `/api/v1/action-plans/stock-price?symbol=` | Bearer | yfinance price lookup |
| `GET` | `/api/v1/action-plans?plan_type=&months=` | Bearer | List plans |
| `POST` | `/api/v1/action-plans` | Bearer | Create empty plan |
| `GET` | `/api/v1/action-plans/{id}` | Bearer | Fetch plan + items |
| `PUT` | `/api/v1/action-plans/{id}` | Bearer | Replace name/items |
| `DELETE` | `/api/v1/action-plans/{id}` | Bearer | Hard delete |
| `POST` | `/api/v1/action-plans/{id}/duplicate?new_name=` | Bearer | Copy plan |

All endpoints require a valid Bearer JWT token (`get_current_user_id` dependency).  
Plans are **user-scoped**: queries always filter by `created_by = current_user_id`.

### Update strategy (PUT)

Items are replaced via **delete-all + bulk-insert** within a single transaction:

```python
await db.execute(delete(PurchasePlanItem).where(plan_id == plan_id))
await db.flush()
for i, item in enumerate(body.purchase_items):
    db.add(PurchasePlanItem(plan_id=plan_id, sort_order=i, ...))
```

This avoids partial-update bugs and keeps the implementation simple.

### Stock price lookup

```python
for ticker_sym in [f"{sym}.BK", sym]:          # Thai SET first
    hist = yf.Ticker(ticker_sym).history(period="5d")
    if not hist.empty:
        return float(hist["Close"].iloc[-1])
```

`yfinance` is already a dependency (`requirements.txt`).

---

## 3. Frontend — Next.js 14 (App Router)

### File locations

```
frontend/src/services/actionPlan.ts                              ← API service
frontend/src/app/(dashboard)/action-plan/page.tsx                ← List page
frontend/src/app/(dashboard)/action-plan/purchase/[id]/page.tsx  ← Purchase editor
frontend/src/app/(dashboard)/action-plan/portfolio/[id]/page.tsx ← Portfolio editor
  # Added: calcRR(), fmtRR(), AUTO_SAVE_DEBOUNCE_MS, handleBlur, autoSaveTimer ref
frontend/src/components/layouts/Sidebar.tsx                      ← + Action Plan nav item
```

### Service (`actionPlan.ts`)

Thin wrapper around `apiClient` (Axios with `/api/proxy` base URL):

```typescript
actionPlanService.suggestName(type)           // GET suggest-name
actionPlanService.getStockPrice(symbol)       // GET stock-price
actionPlanService.list(type, months?)         // GET list
actionPlanService.create(name, type)          // POST
actionPlanService.get(id)                     // GET /{id}
actionPlanService.update(id, payload)         // PUT /{id}
actionPlanService.delete(id)                  // DELETE /{id}
actionPlanService.duplicate(id, newName)      // POST /{id}/duplicate
```

### Main list page (`/action-plan`)

- Two `<PlanSection>` components rendered vertically.
- Each section: header + filter bar (3m/6m/1y/All) + table + modals.
- **Create** flow: `suggestName` → modal → `create` → `router.push('/action-plan/<type>/<id>')`.
- **Duplicate** flow: `suggestName` → modal → `duplicate` → `router.push(...)`.
- **Delete** flow: confirmation modal → `delete` → refetch list.
- Data fetched with TanStack Query; keys: `['action-plans', type, months]`.

### Purchase editor (`/action-plan/purchase/[id]`)

State: `rows: PurchaseRow[]` (local, not in server state during editing).

```typescript
interface PurchaseRow {
  _key: string          // nanoid for React key
  stock: string
  current_price: number | null
  size: number | null
  buy_price: number | null
  tp: number | null
  sl: number | null
  strategy: string      // one of STRATEGY_OPTIONS or custom text
  fetchingPrice: boolean
}
```

**RR computation (inline, display-only):**
```typescript
const rr = (buy && sl && tp && buy > sl)
  ? (tp - buy) / (buy - sl)
  : null
```

**Stock price on-blur:**
```typescript
const onStockBlur = async (key, symbol) => {
  setRow(key, { fetchingPrice: true })
  const price = await actionPlanService.getStockPrice(symbol)
  setRow(key, { current_price: price, fetchingPrice: false })
}
```

**Save:** `actionPlanService.update(id, { name, purchase_items: rows })`.

**Generate:** builds CSV string → shows in `<GenerateModal>` with a Copy button.

### Portfolio editor (`/action-plan/portfolio/[id]`)

On mount:
1. Fetch plan from DB (`actionPlanService.get(id)`).
2. Fetch active positions (`portfolioTrackerService.getPositions({ status: 'active' })`).
3. Merge: for each position, overlay saved `tp / sl / order_size` from the plan.

**Refresh button:** calls `portfolioTrackerService.refresh()` then invalidates positions query.

**Copy Prev Plan button:** reads all portfolio plans via `actionPlanService.list('portfolio', null)`, selects the first plan whose `id` is not the current plan (i.e., the next most-recently-created plan), fetches it via `actionPlanService.get(prevId)`, and applies a symbol-keyed merge to the local `rows` state:

```typescript
// Only rows where ALL three fields are null are eligible for copy
if (row.order_size !== null || row.tp !== null || row.sl !== null) return row

const match = prevMap.get(row.symbol.toUpperCase())
if (!match) return row
if (match.order_size === null && match.tp === null && match.sl === null) return row

return { ...row, order_size: match.order_size, tp: match.tp, sl: match.sl }
```

The operation is entirely client-side. No data is persisted until the user presses Save. A feedback banner displays the number of rows updated and the source plan name, auto-dismisses after 6 seconds.

**RR Calculation (inline derived, display-only):**

```typescript
// calcRR — pure function, module scope, lines 39–48 in page.tsx
function calcRR(
  tp: number | null,
  entryPrice: number | null,
  sl: number | null,
): number | null {
  if (tp == null || entryPrice == null || sl == null) return null
  const denominator = entryPrice - sl
  if (denominator === 0) return null
  return (tp - entryPrice) / denominator
}
```

`calcRR` is called inside `rows.map()` per row. The result is used only in the JSX `<span>` in the RR column cell. It is never added to `Row` state and never included in the `actionPlanService.update()` payload.

Color thresholds applied to the `cn()` class selector:
- `rr >= 2.0` → `text-gain`
- `rr >= 1.0` → `text-warning`
- `rr < 1.0` or `rr == null` → `text-ink-disabled`

**Auto-save on Blur:**

```typescript
const AUTO_SAVE_DEBOUNCE_MS = 300   // module-level constant

const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>()

// Cleanup on unmount prevents setState on unmounted component
useEffect(() => () => clearTimeout(autoSaveTimer.current), [])

const handleBlur = useCallback(() => {
  if (saving) return                          // suppress if save already in flight
  clearTimeout(autoSaveTimer.current)         // cancel pending prior blur
  autoSaveTimer.current = setTimeout(() => {
    save()
  }, AUTO_SAVE_DEBOUNCE_MS)
}, [saving, save])
```

`handleBlur` is passed as `onBlur={handleBlur}` to the three editable `NumInput` instances (ORDER SIZE, TP, SL). `NumInput` was extended with an optional `onBlur?: () => void` prop forwarded to the underlying `<input>` element.

The `autoSaveTimer` ref is separate from the existing `saveTimer` ref (used to auto-clear save status messages) to prevent timer collision.

**Save:** `actionPlanService.update(id, { portfolio_items: mergedRows })`.

---

## 4. Documentation System Expansion

To support hierarchical docs navigation:

### Backend (`docs_content.py`)

- `GET /api/v1/docs-content/manifest` → returns `docs/manifest.json` (tree of sections/pages).
- `GET /api/v1/docs-content/file?path=action-plan/FUNCTIONAL.md` → returns raw markdown.
- Legacy `GET /api/v1/docs-content/{name}` kept for backward compatibility.

### Frontend (Documents page)

- Fetches manifest on load, renders a **left-side tree nav**.
- Clicking a node fetches the `.md` file via the `/file` endpoint and renders it with `react-markdown`.

### Docs directory structure

```
docs/
  manifest.json
  REQUIREMENTS.md
  DESIGN.md
  action-plan/
    FUNCTIONAL.md    ← this file
    TECHNICAL.md     ← companion doc
```

---

## 5. Data Flow Diagram

```
Browser → /api/proxy/api/v1/action-plans/...
              ↓ (Next.js server-side proxy)
        http://backend:8000/api/v1/action-plans/...
              ↓
        FastAPI endpoint (action_plan.py)
              ↓
        AsyncSession → PostgreSQL (action_plans, purchase_plan_items, portfolio_plan_items)
```

Stock price flow:
```
Browser (onBlur stock field)
  → GET /api/proxy/api/v1/action-plans/stock-price?symbol=BH
      → FastAPI → yfinance.Ticker("BH.BK").history(period="5d")
          → Yahoo Finance API
              → price returned to browser → displayed in CURRENT PRICE column
```

---

## 6. Architecture Decision Records (2026-06-21 additions)

### ADR-RR-1: RR Computed Inline in Render Loop, Not in Derived State

**Decision:** `calcRR` is called inside `rows.map()` during render, not stored as a state variable or computed via `useEffect`.

**Rationale:** Consistent with the existing `calcPnl`/`calcPnlPct` pattern. `calcRR` is O(1) per row and does not require async I/O. Derived state would introduce synchronisation risk between `rows` and a parallel `rrValues` array.

**Consequence:** RR is recomputed on every render. Acceptable for typical portfolio sizes (5–30 rows).

---

### ADR-AS-1: Ref-Based Debounce, Not `lodash.debounce`

**Decision:** `setTimeout`/`clearTimeout` via `useRef` is used for the 300 ms auto-save debounce.

**Rationale:** The project has no existing `lodash` dependency. The `saveTimer` ref pattern is already established in the same component. Adding a library for one use case is disproportionate.

**Consequence:** Slightly more verbose than a library call but immediately readable and zero bundle weight.

---

### ADR-AS-2: `saving` Guard Read from Closure, Not from Ref

**Decision:** `handleBlur` reads `saving` from the React state closure rather than mirroring it into a `useRef`.

**Rationale:** The guard fires synchronously in response to a DOM blur event, not inside a timer callback. Closure-captured state is current at this call point. A parallel ref would require keeping it synchronised with `setSaving()` calls, creating a maintenance hazard.

**Consequence:** No stale closure risk at the point the guard executes.
