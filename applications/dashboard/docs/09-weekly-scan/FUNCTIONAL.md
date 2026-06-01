# Weekly Scan — Functional Specification

---

## 1. Overview

The Weekly Scan module (`/weekly-scan`) supports a disciplined, repeatable workflow for reviewing a watchlist of SET and global stocks once per week. The analyst creates a named scan (typically dated to the upcoming Saturday), works through each symbol to evaluate its chart setup, assigns a colour mark and trading strategy, and optionally promotes selected symbols directly to a purchase action plan.

The module is personal — each user manages their own scans, symbol lists, and configuration independently.

---

## 2. Concepts

### 2.1 Symbol Lists

A user can maintain one or more named **symbol lists** (e.g. "SET50", "Crypto DRs", "US Watchlist"). Each list belongs to a single market context. When a scan is created, symbols are drawn from all lists and grouped by list name inside the scan.

- Lists are ordered by `sort_order`; symbols within a list are stored in the order the user defines them.
- If a user has no lists yet, the system falls back to the legacy `UserScanConfig` single-list model and automatically seeds a "Default" list on first access.
- The default seed list contains the SET50 index constituents plus two DR symbols (`BTCUSD-DR`, `GOLUSD-DR`).

### 2.2 Scans

A **scan** is a dated snapshot of a symbol list. Its name follows the convention `WEEKLY_SCAN_DD_MM_YYYY` where the date is the target Saturday. The system auto-suggests the next Saturday's name if the user already has prior scans, or the most recent past Saturday for a first scan.

A scan holds a fixed set of `WeeklyScanItem` rows. Items are not automatically updated when the underlying symbol list changes; the user must explicitly trigger **Refresh** to merge new symbols into an existing scan.

### 2.3 Colour Mark System

Each item in a scan receives exactly one colour mark as the primary evaluation verdict:

| Mark | Colour | Meaning |
|------|--------|---------|
| CYAN | Cyan | Strong buy candidate — top priority |
| GREEN | Green | Buy candidate |
| YELLOW | Yellow | Watch / borderline |
| RED | Red | Skip — no setup |
| PURPLE | Purple | Already in portfolio |
| (none) | — | Not yet evaluated |

RED items trigger an automatic skip-to-next in the Evaluate view to speed up the review workflow.

PURPLE marks are assigned automatically when the user triggers **Mark Portfolio Symbols**: the system cross-references active portfolio positions and marks any matching scan symbols as PURPLE, optionally inheriting the strategy from the latest purchase plan.

### 2.4 Strategies

Each item can have one trading strategy selected from a predefined set. Users may also enter a free-text custom strategy via the "OTHERS" option.

| Strategy | Short Code | Icon |
|----------|------------|------|
| BREAK OUT | BO | Rocket |
| BUY ON DIP | BOD | Trending Down |
| แท่งเทียนกลับตัว (Candle Reversal) | ททกต | Bar Chart |
| ยยจท (Thai technical pattern) | ยยจท | Trending Up |
| NEWS | NEWS | Document |
| AJ PAO | PAO | Target |
| OTHERS | OTH. | Custom text |

### 2.5 Trade Parameters

In addition to the colour and strategy, each item stores optional trade parameters set during evaluation:

- **Buy Price** — intended entry price
- **Size** — number of shares
- **TP** — take-profit price
- **SL** — stop-loss price
- **Remark** — free-text note

---

## 3. User Workflows

### 3.1 Managing Symbol Lists

1. Navigate to **Settings → Symbol Lists** (accessible from the Weekly Scan index).
2. Create one or more named lists and assign a market context (SET, US, HK, CRYPTO).
3. Enter the list of symbols, one per line.
4. Lists are ordered by dragging or setting a sort order.

### 3.2 Creating a Scan

1. Navigate to **Weekly Scan** in the sidebar.
2. Click **New Scan**. The system pre-fills the name with the suggested date (e.g. `WEEKLY_SCAN_07_06_2026`).
3. Confirm. The backend creates the scan and populates it with all symbols from all active symbol lists, grouped by list.
4. The user is taken to the scan detail page.

### 3.3 Reviewing the Scan Table

The scan detail page (`/weekly-scan/[id]`) shows all symbols in a sortable, filterable table.

**Columns:**

| Column | Description |
|--------|-------------|
| Symbol | Ticker symbol; click to open the Analytics modal |
| List | Symbol list name (used as the tab filter) |
| Market | SET / US / HK / CRYPTO |
| Mon Open | Monday open price for the scan week (fetched from Yahoo Finance) |
| Fri Close | Friday close price for the scan week |
| Week % | (Fri − Mon) / Mon × 100, colour-coded green/red |
| Color | Inline colour picker (five dots) |
| Strategy | Inline strategy picker (icon buttons) |
| Buy | Inline editable buy price (click to edit, blur to save) |
| Size | Inline editable position size |
| TP | Inline editable take-profit |
| SL | Inline editable stop-loss |
| Remark | Inline editable free-text remark |
| Actions | Add to purchase plan; delete symbol |

**Filtering:**
- **List tabs** — one tab per named symbol list; "All" shows every symbol.
- **Symbol filter** — text search on symbol ticker.
- **Color filter** — multi-select colour badges; shows only symbols with the selected marks.
- **Strategy filter** — text search on strategy name.

**Inline editing:** All evaluation fields (colour, strategy, buy price, size, TP, SL, remark) are edited directly in the table cell. Changes are saved immediately on blur or Enter via `PUT /api/v1/weekly-scan/scans/{id}/items/{symbol}`.

### 3.4 Evaluating Symbols (Evaluate View)

Click **Start Scan** (with mode selector) to enter the full-screen Evaluate view (`/weekly-scan/[id]/evaluate`).

**Modes:**
- **All symbols** — every symbol in the selected list, alphabetically
- **Remaining only** — symbols with no colour mark
- **[Color] only** — symbols already marked with a specific colour

In the Evaluate view:
- Left panel: symbol queue (scrollable list of all symbols in the queue)
- Centre: `EChartsChart` component showing OHLCV candlestick + volume + RSI + Stochastic
- Right panel: evaluation form (colour, strategy, buy/size/TP/SL/remark)
- A live price bar at the top shows the current price and day change % from the analytics service

Keyboard navigation: **Next** and **Prev** buttons advance through the queue. Selecting RED auto-advances to Next. **Save & Close** saves the current evaluation and returns to the scan table.

An **Analysis Log** panel appears below the chart if a pre-generated analysis file exists for the symbol (HTML or Markdown). A **Fibonacci Chart** image panel also appears if available.

### 3.5 Scan Dashboard

The Scan Dashboard (`/weekly-scan/[id]/dashboard`) provides a one-page summary of a completed scan:

- Stat cards: Total symbols, evaluated count, CYAN+GREEN (actionable) count, best/worst week performer
- ECharts donut chart: colour distribution (with Pending shown as grey)
- Bar charts: week % return per colour group and per strategy
- Filtered symbol tables: grouped by colour mark

### 3.6 Adding Symbols to a Purchase Plan

From the scan table, click the cart icon on any row to open the **Add to Plan** modal. The modal lists the five most recent purchase plans. Selecting one and confirming appends the symbol (with buy price, size, TP, SL, and strategy carried over) to that plan's items.

### 3.7 Refreshing a Scan

Click **Refresh** on the scan detail page to merge the current symbol lists into the existing scan. New symbols are appended; existing symbols retain all their evaluation data. List membership (`list_name`, `market`) is re-assigned from the first matching list.

---

## 4. Week Price Calculation

The system fetches Monday open and Friday close prices for the week encoded in the scan name. The ticker translation rules are:

| Market | Suffix applied |
|--------|----------------|
| SET | `{SYMBOL}.BK` |
| US / OTHER | No suffix |
| HK | Zero-pad to 4 digits + `.HK` |
| CRYPTO / DR symbols | No suffix |

If the scan week is in the future (Monday has not yet occurred), the system returns the most recent close as the proxy for Monday open. Prices are fetched concurrently with a semaphore of 5 to avoid rate-limiting from Yahoo Finance.

---

## 5. Empty States and Edge Cases

| Condition | Behaviour |
|-----------|-----------|
| No symbol lists configured | Scan created using SET50 defaults (50 symbols + 2 DRs) |
| Scan name does not match `DD_MM_YYYY` pattern | Week price columns show `—` for all symbols |
| yfinance returns no data for a symbol | Mon/Fri columns show `—`; no error raised |
| Symbol already in scan | `POST .../items` returns 409; UI prevents duplicate add |
| No purchase plans exist | Add to Plan modal shows informational message; no list displayed |
