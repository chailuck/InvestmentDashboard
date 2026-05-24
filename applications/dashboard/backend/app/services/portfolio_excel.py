"""Portfolio service — reads Investment tracking.xlsx and provides live P&L data."""

from __future__ import annotations

import warnings
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

warnings.filterwarnings("ignore")

SHEET = "Sheet1"


def _excel_path() -> Path:
    from app.core.config import get_settings
    return Path(get_settings().investment_excel_path)


def _load_df() -> pd.DataFrame:
    path = _excel_path()
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {path}")
    df = pd.read_excel(path, sheet_name=SHEET)
    df["Entry Date"] = pd.to_datetime(df["Entry Date"], errors="coerce")
    df["Exit Date"] = pd.to_datetime(df["Exit Date"], errors="coerce")
    df["Entry Price"] = pd.to_numeric(df["Entry Price"], errors="coerce")
    df["Exit Price"] = pd.to_numeric(df["Exit Price"], errors="coerce")
    df["Current price"] = pd.to_numeric(df.get("Current price", pd.Series(dtype=float)), errors="coerce")
    df["Position Size"] = pd.to_numeric(df["Position Size"], errors="coerce")
    return df


def _net_pnl(entry: float, exit_p: float, size: float, direction: str) -> float:
    mult = -1 if "short" in str(direction).lower() else 1
    return round((exit_p - entry) * size * mult, 0)


def _pnl_pct(entry: float, exit_p: float, direction: str) -> float:
    if entry == 0:
        return 0.0
    mult = -1 if "short" in str(direction).lower() else 1
    return round((exit_p - entry) / entry * 100 * mult, 2)


def fetch_live_prices(symbols: list[str]) -> dict[str, float | None]:
    """Fetch latest close prices from Yahoo Finance for Thai SET stocks (.BK suffix)."""
    if not symbols:
        return {}
    try:
        import yfinance as yf
        tickers = [s + ".BK" for s in symbols]
        raw = yf.download(tickers, period="5d", interval="1d", auto_adjust=False, progress=False)
        price_map: dict[str, float | None] = {}
        for sym, ticker in zip(symbols, tickers):
            try:
                if len(tickers) == 1:
                    closes = raw["Close"].dropna()
                else:
                    closes = raw[("Close", ticker)].dropna()
                price_map[sym] = round(float(closes.iloc[-1]), 2) if len(closes) > 0 else None
            except Exception:
                price_map[sym] = None
        return price_map
    except Exception:
        return {s: None for s in symbols}


def get_positions(
    from_date: date | None = None,
    to_date: date | None = None,
    status: str = "active",  # "active" | "closed" | "all"
) -> list[dict[str, Any]]:
    """
    Return positions filtered by date range and status.
    status='active'  → open positions only (Exit Price is blank)
    status='closed'  → closed positions only
    status='all'     → everything
    """
    df = _load_df()
    today = date.today()

    open_mask = df["Exit Price"].isna()

    if status == "active":
        df = df[open_mask].copy()
    elif status == "closed":
        df = df[~open_mask].copy()
    else:
        df = df.copy()

    # Date filter: for open positions use Entry Date; for closed use Exit Date
    if from_date or to_date:
        def in_range(row: pd.Series) -> bool:
            is_open = pd.isna(row["Exit Price"])
            ref: date | None = None
            if is_open:
                ref = row["Entry Date"].date() if pd.notna(row["Entry Date"]) else None
            else:
                ref = row["Exit Date"].date() if pd.notna(row["Exit Date"]) else None
            if ref is None:
                return True
            if from_date and ref < from_date:
                return False
            if to_date and ref > to_date:
                return False
            return True

        mask = df.apply(in_range, axis=1)
        df = df[mask]

    if df.empty:
        return []

    # Fetch live prices for open positions
    open_symbols = df[df["Exit Price"].isna()]["Symbol"].dropna().unique().tolist()
    live_prices = fetch_live_prices(open_symbols)

    positions: list[dict[str, Any]] = []
    for i, (_, row) in enumerate(df.iterrows()):
        sym = str(row.get("Symbol", "")).strip()
        direction = str(row.get("Position (Long/Short)", "Long")).strip()
        entry = float(row["Entry Price"]) if pd.notna(row["Entry Price"]) else 0.0
        size = int(row["Position Size"]) if pd.notna(row["Position Size"]) else 0
        is_open = pd.isna(row["Exit Price"])

        if is_open:
            cur = live_prices.get(sym) or (float(row["Current price"]) if pd.notna(row["Current price"]) else entry)
            exit_price = None
            exit_date = None
        else:
            exit_price = float(row["Exit Price"])
            cur = exit_price
            exit_date = row["Exit Date"].date().isoformat() if pd.notna(row["Exit Date"]) else None

        net = _net_pnl(entry, cur, size, direction)
        pct = _pnl_pct(entry, cur, direction)

        sl = float(row["SL"]) if "SL" in row and pd.notna(row.get("SL")) else None
        tp = float(row["TP"]) if "TP" in row and pd.notna(row.get("TP")) else None

        positions.append({
            "id": i + 1,
            "symbol": sym,
            "direction": direction,
            "entryDate": row["Entry Date"].date().isoformat() if pd.notna(row["Entry Date"]) else None,
            "exitDate": exit_date,
            "entryPrice": entry,
            "currentPrice": round(cur, 2),
            "exitPrice": exit_price,
            "positionSize": size,
            "netPnl": net,
            "pnlPct": pct,
            "sl": sl,
            "tp": tp,
            "status": "active" if is_open else "closed",
        })

    return positions


def get_daily_performance(
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict[str, Any]]:
    """
    Compute daily cumulative P&L for the line chart.
    - Closed positions: bucketed on their Exit Date
    - Open positions: mark-to-market using live price, bucketed on today
    """
    df = _load_df()
    today = date.today()
    to_date = to_date or today
    from_date = from_date or (today - timedelta(days=30))

    open_mask = df["Exit Price"].isna()
    closed = df[~open_mask].copy()
    open_pos = df[open_mask].copy()

    # Fetch live prices for open positions
    open_syms = open_pos["Symbol"].dropna().unique().tolist()
    live_prices = fetch_live_prices(open_syms)

    # Build rows with effective_date and net_pnl
    rows: list[tuple[date, float]] = []

    for _, r in closed.iterrows():
        edate = r["Exit Date"].date() if pd.notna(r["Exit Date"]) else today
        if edate < from_date or edate > to_date:
            continue
        entry = float(r["Entry Price"]) if pd.notna(r["Entry Price"]) else 0.0
        exit_p = float(r["Exit Price"]) if pd.notna(r["Exit Price"]) else entry
        size = float(r["Position Size"]) if pd.notna(r["Position Size"]) else 0.0
        direction = str(r.get("Position (Long/Short)", "Long"))
        rows.append((edate, _net_pnl(entry, exit_p, size, direction)))

    for _, r in open_pos.iterrows():
        sym = str(r.get("Symbol", "")).strip()
        entry = float(r["Entry Price"]) if pd.notna(r["Entry Price"]) else 0.0
        cur = live_prices.get(sym) or (float(r["Current price"]) if pd.notna(r["Current price"]) else entry)
        size = float(r["Position Size"]) if pd.notna(r["Position Size"]) else 0.0
        direction = str(r.get("Position (Long/Short)", "Long"))
        rows.append((today, _net_pnl(entry, cur, size, direction)))

    if not rows:
        return []

    series_df = pd.DataFrame(rows, columns=["date", "net"])
    daily = series_df.groupby("date")["net"].sum().sort_index()

    # Fill every calendar day in range (skip weekends optional, but keep all days present in data)
    date_range = pd.date_range(from_date, to_date, freq="B")  # business days
    daily = daily.reindex([d.date() for d in date_range], fill_value=0)
    cumulative = daily.cumsum()

    result: list[dict[str, Any]] = []
    for d, cum in cumulative.items():
        result.append({
            "date": d.isoformat() if hasattr(d, "isoformat") else str(d),
            "dailyPnl": round(float(daily[d]), 0),
            "cumulativePnl": round(float(cum), 0),
        })

    return result
