# Dashboard — Functional Specification

---

## 1. Overview

The dashboard (`/dashboard`) is the landing page after login. It shows a high-level summary of the portfolio and market conditions without requiring any interaction.

---

## 2. Widgets

### 2.1 Portfolio Allocation Chart

A donut chart showing the **percentage of portfolio value** allocated to each stock, based on active (open) positions.

- Value per stock = `currentPrice × positionSize`
- Each stock gets one donut slice with its symbol as label
- Tooltip shows percentage and absolute value in THB
- Data source: `GET /api/v1/portfolio-tracker/positions?status=active`

### 2.2 Portfolio Summary Metrics

Four metric cards:
- **Total P&L** — sum of `netPnl` across all active positions
- **Positions** — count of open positions
- **Win Rate** — percentage of positions with `netPnl > 0`
- **Avg P&L** — `totalPnl / positionCount`

### 2.3 Performance Chart (mini)

A compact ECharts line chart showing cumulative P&L over the last 3 months (daily grouping). Reuses the same API as the portfolio page performance chart.

### 2.4 Holdings Table

A compact table of top open positions sorted by P&L. Columns: Symbol, Direction, P&L, P&L %.

### 2.5 Market Index Bar

A horizontal scrollable strip showing:
- **Thai SET indices** (SET, SET50, SET100, MAI, sSET) — live prices from Yahoo Finance
- **Global indices** (S&P 500, NASDAQ, DOW, BTC-USD, Gold) — live prices from Yahoo Finance

Updated on page load; green for positive change, red for negative.

### 2.6 AI Insights Widget

A small widget with a shortcut to the AI Copilot chat. Shows a "Start chatting" prompt.

### 2.7 Portfolio Summary Widget (Enhanced)

The `PortfolioSummaryWidget` displays four metric cards in a responsive 2×2 (mobile) or 1×4 (desktop) grid. Each card shows:

- **Open P&L** — total net P&L across all active positions, formatted in compact THB (e.g. `+12.5K ฿` or `+1.20M ฿`). Also shows the percentage return over total cost basis.
- **Open Positions** — count of open positions with a win/loss breakdown (e.g. `5W / 2L`).
- **Win Rate** — percentage of positions with positive P&L, with total trade count as sub-label.
- **Avg P&L / Trade** — total P&L divided by position count.

Metric values animate on update using Framer Motion's `AnimatePresence` (slide-up transition). The Open P&L card uses brand accent styling when highlighted.

Data source: `GET /api/v1/portfolio-tracker/positions?status=active`

---

## 3. Data Refresh

All dashboard queries use TanStack Query with:
- `staleTime: 60_000` (data considered fresh for 60 s)
- `refetchInterval: 60_000` (auto-polls every 60 s)

The market index strip refreshes independently every 60 s.

---

## 4. Empty State

If no portfolio data is available (Excel not configured or not found), the widgets show a placeholder message directing the user to Settings → App Configuration to set the source file path.

---

## 5. Chart Library — ECharts

All charts on the dashboard (allocation donut, performance line) use the `echarts-for-react` wrapper around Apache ECharts. Charts are rendered via `ReactECharts` with `animation: false` for performance. The dark theme is applied by setting `backgroundColor: '#0d1117'` and `textStyle.color: '#64748b'` inside each chart option object.

The shared `EChartsChart` component (`frontend/src/components/analytics/EChartsChart.tsx`) provides the full candlestick / OHLCV chart used in the Analytics modal and Weekly Scan evaluate view. See the Weekly Scan technical documentation for the full chart feature set.
