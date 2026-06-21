# Action Plan — Functional Specification

## Overview

The **Action Plan** section lets traders prepare and save structured trading plans before executing them. Two independent plan types are supported:

| Type | Purpose |
|------|---------|
| **Purchase Action Plan** | Stocks NOT currently in the portfolio that the trader intends to buy |
| **Portfolio Action Plan** | Actions (TP / SL / order adjustments) on currently open positions |

---

## 1. Navigation

- A top-level **Action Plan** item is added to the main side menu (between Portfolio and Analytics).
- The main `/action-plan` page renders two collapsible sections — one per plan type — each with its own table, controls, and "Create" button.

---

## 2. Purchase Action Plan

### 2.1 Plan List

The Purchase Action Plan section shows a paginated/filtered list of saved plans.

**Filter bar (top of table):**
- **Create new plan** button (opens Create modal)
- **View** selector: `3 months (default)` · `6 months` · `1 year` · `All`

**Table columns:**

| Column | Description |
|--------|-------------|
| Created | Date-time the plan was first saved |
| Plan Name | Human-readable name |
| Symbols | Comma-separated list of stocks, up to 7 |
| Actions | Icon buttons: Edit · Delete (with confirmation) · Duplicate |
| Last Modified | Date-time of last save |

**Create / Duplicate modal:**
- Input field pre-filled with a suggested unique name (`YYYY-MM-DD`, falling back to `YYYY-MM-DD-01`, `YYYY-MM-DD-02`, …).
- User may change the name before confirming.
- On confirm → backend creates the plan → browser navigates to the plan editor.

**Delete confirmation:**
- A modal asks "Are you sure you want to delete `<plan name>`?" before the record is removed.

### 2.2 Purchase Plan Editor

URL: `/action-plan/purchase/[id]`

**Editable table columns:**

| Column | Editable | Notes |
|--------|----------|-------|
| STOCK | ✅ | On blur → fetches latest price from yfinance |
| CURRENT PRICE | ❌ | Auto-populated via price API |
| SIZE | ✅ | Number of shares |
| BUY | ✅ | Intended entry price |
| TP | ✅ | Take-profit price |
| SL | ✅ | Stop-loss price |
| RR | ❌ | Calculated: `(TP − BUY) / (BUY − SL)` |
| STRATEGY | ✅ | Dropdown + free-text for OTHERS |

**Strategy options:**
- BREAK OUT
- BUY ON DIP
- แท่งเทียนกลับตัว
- NEWS
- AJ PAO
- OTHERS (shows free-text input)

**RR indicator:**
- ≥ 3 → green check ✓ (good risk/reward)
- 1 ≤ RR < 3 → amber warning ⚠️
- < 1 or invalid → red ✗

**Toolbar buttons:**
- **+ Add Row** — appends an empty row
- **Save** — persists all rows to the database
- **Generate** — opens a read-only modal with the formatted plan text (copyable)

**Generated text format:**
```
STOCK,SIZE,BUY,TP,SL, STRATEGY
BH,100,184,212,176.6,BUY ON DIP
BTG,1000,20.7,24.5,19.4,แท่งเทียนกลับตัว
CPALL,200,14.5,51.25,45,BREAK OUT
```

---

## 3. Portfolio Action Plan

### 3.1 Plan List

Layout and controls are identical to the Purchase list (same view filter, same action buttons), but scoped to portfolio-type plans.

### 3.2 Portfolio Plan Editor

URL: `/action-plan/portfolio/[id]`

**On open, the editor:**
1. Loads the saved plan items from the database.
2. Fetches **current open positions** from the Portfolio Tracker (Excel data).
3. Merges the two: position data fills Symbol / Current Price / Size / Entry Price; saved plan supplies TP / SL / Order Size.

**Toolbar buttons:**
- **Refresh** — re-copies the Excel source file (same as Portfolio page refresh) then reloads positions.
- **Copy Prev Plan** — copies Order Size, TP, and SL from the most-recently-saved portfolio plan (other than the current plan) into the current plan. Only rows where all three fields are currently null are updated; rows that already have any value set are left untouched. Provides a count of rows updated and names the source plan in a feedback banner. Values are applied to local state only — the user must press **Save** to persist.
- **Export** — downloads the current symbol list as a plain-text file.
- **Restore** — imports a symbol list from a plain-text file, replacing the current list.
- **Generate PortAction** — modal with copyable text.
- **Save** — persists TP, SL, Order Size (and a snapshot of position data) to the database.

**Table columns:**

| Column | Editable | Source | Notes |
|--------|----------|--------|-------|
| SYMBOL | ❌ | Portfolio tracker | |
| CURRENT PRICE | ❌ | Portfolio tracker | |
| SIZE | ❌ | Portfolio tracker | |
| ENTRY PRICE | ❌ | Portfolio tracker | |
| CURRENT P&L | ❌ | Derived (current price vs entry) | Amount and % |
| ORDER SIZE | ✅ | User input (persisted) | Auto-saves on blur |
| TP | ✅ | User input (persisted) | Auto-saves on blur |
| TP P&L | ❌ | Derived (TP vs entry) | |
| SL | ✅ | User input (persisted) | Auto-saves on blur |
| SL P&L | ❌ | Derived (SL vs entry) | |
| RR | ❌ | Derived (computed) | Read-only; never persisted |
| REMAINING | ❌ | Derived (Order Size − Size) | |

**RR Column:**
- Formula: `RR = (TP − Entry Price) / (Entry Price − SL)` (LONG positions only)
- Display format: `2.5R` (one decimal place followed by R)
- Colour coding:
  - RR ≥ 2.0 → green (good risk/reward)
  - 1.0 ≤ RR < 2.0 → amber (acceptable)
  - RR < 1.0 or undefined → grey (poor or insufficient data)
- Only shown when TP, SL, and Entry Price are all populated and Entry Price ≠ SL
- Never stored in the database

**Auto-save on Blur:**
- When focus leaves any of the three editable numeric fields (Order Size, TP, SL), the current plan state is automatically saved to the database.
- A 300 ms debounce collapses rapid tab-throughs into a single save call.
- The manual Save button remains available and coexists with auto-save.
- Visual feedback is shown in the same location as the manual Save confirmation ("Saved" with a checkmark icon, auto-clearing after 3 seconds).
- Auto-save is suppressed if a manual save is already in progress.

**Generated text format:**
```
PORTFOLIO ACTION PLAN
STOCK,TP,SL,ORDER SIZE
TRUE,15.2,13.3,400
GULF,64.0,57.5,200
STA,20.0,18.4,500
```

---

## 4. Business Rules

1. Plans are **user-scoped** — each user sees only their own plans.
2. A plan name must be unique within the same user + type combination (enforced via the suggest-name API).
3. Deleting a plan is **irreversible**; a confirmation modal is required.
4. Duplicating a plan copies all line items exactly.
5. The portfolio plan editor always pulls **live position data** on load; the saved TP/SL/order_size overlay on top.
6. RR is display-only and is never stored.
7. **Copy Prev Plan** only populates rows where Order Size, TP, and SL are all null. A row with any one of those fields already set is considered "configured" and will not be overwritten. The copy is applied to in-memory state only — no data is persisted until the user explicitly clicks Save.
8. RR is a derived display value computed from TP, SL, and Entry Price. It is never stored in the database and is not included in the save payload.
9. Auto-save fires on blur of the Order Size, TP, and SL fields. It is debounced at 300 ms. Programmatic row updates (Copy Prev Plan, Restore) do not trigger auto-save.
