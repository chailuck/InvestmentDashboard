# Portfolio Tracker — Functional Specification

---

## 1. Overview

The portfolio page (`/portfolio`) is the primary tracking interface. It reads trade data from an Excel file (`Investment tracking.xlsx`) and enriches open positions with live prices from Yahoo Finance.

---

## 2. Excel File Structure

The source of truth is an Excel file with one sheet named `Sheet1`. Each row represents one closed or open trade. Columns (exact names matter):

| Column | Type | Description |
|--------|------|-------------|
| Symbol | text | Thai SET ticker (e.g. GULF, PTT) |
| Direction | text | `Long` or `Short` |
| Entry Date | date | Trade entry date |
| Entry Price | number | Price paid per share |
| Exit Date | date | Exit date (blank = still open) |
| Exit Price | number/formula | Exit price; blank or "NOT SELL" = open position |
| Position Size | number | Number of shares |
| SL | number | Stop-loss price |
| TP | number | Take-profit price |
| Remarks | text | Optional notes |

**Open position detection:** A row is "active" (open) if `Exit Price` is NaN/blank or the string `"NOT SELL"`.

---

## 3. Filters

At the top of the portfolio page, users can filter by:
- **From date** — default: 3 months ago
- **To date** — default: today (with a "Today" quick-set button)
- **Status** — Active (open) / All / Closed

Filters are persisted in `localStorage` under `portfolio_criteria` so they survive page refresh.

---

## 4. Metric Cards

Four summary cards update with every filter change:
- **Total P&L** — sum of all Net P&L for the filtered positions
- **Positions** — count of filtered positions
- **Win Rate** — % of positions where `netPnl > 0`
- **Avg P&L** — `totalPnl ÷ count`

---

## 5. Positions Table

Columns: Symbol · Direction · Entry Date · Entry Price · Current Price · Size · Net P&L (+ %) · SL · TP · Status

- **Direction** shows `↑ L` for Long, `↓ S` for Short
- **Net P&L** colored green (gain) or red (loss)
- **Status** badge: `OPEN` (green) or `CLOSED` (grey)
- **Footer row** shows total P&L

---

## 6. Performance History Chart

A dual-axis ECharts chart:
- **Left Y-axis:** cumulative P&L line (green area fill)
- **Right Y-axis:** period P&L bars (green = positive, red = negative)
- **X-axis:** dates grouped by the selected period (Daily / Weekly / Monthly)

The period selector (Daily / Weekly / Monthly) applies to both the chart and the Performance by Date table below it.

---

## 7. Performance by Date Table

A collapsible table grouped by the selected period. Each row shows:
- Period label · Net P&L · Accumulated P&L · Wins · Losses · Total · Win Rate

**Drill-down:** clicking any row opens a **Transaction Modal** showing all individual trades that occurred in that period. Columns: Symbol · Dir · Entry Date · Exit Date · Entry ฿ · Exit ฿ · Size · Net P&L · P&L% · Remarks.

---

## 8. Performance by Stock

- **Bar chart:** horizontal bars colored green/red per stock
- **Collapsible table:** Symbol · Investment · Current Value · Net P&L · P&L% · Wins · Losses · Win Rate (with mini progress bar)

---

## 9. Refresh

The **Refresh** button (top-right `↺` icon) copies the source Excel to the working location and invalidates the server-side cache. A progress modal shows:

1. **Reading source file** (with file path and size)
2. **Copying to working location**
3. **Clearing cache** (all workers)
4. **Reloading portfolio data** (triggers TanStack Query refetch)

**Source path** and **working path** are configured in Settings → App Configuration.

---

## 10. Raw Data Viewer

The **Raw Data** button (table icon) opens a full-screen modal showing every row from the Excel file as-is, with all original column names. Useful for debugging.
