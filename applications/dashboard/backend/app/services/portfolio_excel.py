"""Portfolio service — reads Investment tracking.xlsx and provides live P&L data."""

from __future__ import annotations

import shutil
import time
import warnings
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

warnings.filterwarnings("ignore")

SHEET = "Sheet1"

# ── Simple in-memory cache (thread-safe for single worker) ────────────────────
_CACHE: dict[str, tuple[float, Any]] = {}

# Shared invalidation file — written by any worker on refresh, read by all workers
_CACHE_BUST_FILE = Path("/app/uploads/.cache_bust")

def _cache_bust_ts() -> float:
    """Return the mtime of the bust file, or 0 if it doesn't exist."""
    try:
        return _CACHE_BUST_FILE.stat().st_mtime
    except OSError:
        return 0.0

def _write_cache_bust() -> None:
    """Touch the bust file so all workers know to drop their caches."""
    try:
        _CACHE_BUST_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_BUST_FILE.write_text(str(time.time()))
    except OSError:
        pass

def _cached(key: str, ttl: float, fn):
    now = time.time()
    bust = _cache_bust_ts()
    entry = _CACHE.get(key)
    # Valid if: entry exists, not expired, AND was written after last bust
    if entry and (now - entry[0] < ttl) and (entry[0] > bust):
        return entry[1]
    val = fn()
    _CACHE[key] = (now, val)
    return val


# ── Path helpers ──────────────────────────────────────────────────────────────

def _working_path() -> Path:
    """Return writable working-copy path — app_config.json overrides the env default."""
    try:
        from app.services.app_config_service import get_app_config
        cfg = get_app_config()
        wp = cfg.get("excel_working_path", "").strip()
        if wp:
            return Path(wp)
    except Exception:
        pass
    from app.core.config import get_settings
    return Path(get_settings().investment_excel_path)


def _source_path() -> Path:
    """Return source path — app_config.json overrides the env default."""
    try:
        from app.services.app_config_service import get_app_config
        cfg = get_app_config()
        src = cfg.get("excel_source_path", "").strip()
        if src:
            return Path(src)
    except Exception:
        pass
    from app.core.config import get_settings
    s = get_settings()
    return Path(s.investment_excel_source_path or s.investment_excel_path)


def copy_excel_from_source() -> str:
    src = _source_path()
    dst = _working_path()
    if not src.exists():
        raise FileNotFoundError(f"Source Excel file not found: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    # Bust cache across all workers: write timestamp file + clear this worker's dict
    _write_cache_bust()
    _CACHE.clear()
    return str(dst)


def _ensure_working_copy() -> Path:
    wp = _working_path()
    if not wp.exists():
        copy_excel_from_source()
    return wp


def _load_df() -> pd.DataFrame:
    path = _ensure_working_copy()
    df = pd.read_excel(path, sheet_name=SHEET)
    df["Entry Date"] = pd.to_datetime(df["Entry Date"], errors="coerce")
    df["Exit Date"] = pd.to_datetime(df["Exit Date"], errors="coerce")
    df["Entry Price"] = pd.to_numeric(df["Entry Price"], errors="coerce")
    df["Exit Price"] = pd.to_numeric(df["Exit Price"], errors="coerce")
    df["Current price"] = pd.to_numeric(
        df.get("Current price", pd.Series(dtype=float)), errors="coerce"
    )
    df["Position Size"] = pd.to_numeric(df["Position Size"], errors="coerce")
    return df


# ── P&L helpers ───────────────────────────────────────────────────────────────

def _net_pnl(entry: float, exit_p: float, size: float, direction: str) -> float:
    mult = -1 if "short" in str(direction).lower() else 1
    return round((exit_p - entry) * size * mult, 0)


def _pnl_pct(entry: float, exit_p: float, direction: str) -> float:
    if entry == 0:
        return 0.0
    mult = -1 if "short" in str(direction).lower() else 1
    return round((exit_p - entry) / entry * 100 * mult, 2)


# ── Period grouping ───────────────────────────────────────────────────────────

def _period_key(d: date, period: str) -> tuple[str, str]:
    if period == "daily":
        return d.strftime("%Y-%m-%d"), d.strftime("%d/%m/%Y")
    elif period == "weekly":
        mon = d - timedelta(days=d.weekday())
        fri = mon + timedelta(days=4)
        return mon.strftime("%Y-%m-%d"), f"{mon.strftime('%d/%m/%Y')} – {fri.strftime('%d/%m/%Y')}"
    else:
        return d.strftime("%Y-%m"), d.strftime("%b %Y")


# ── Live price fetchers ───────────────────────────────────────────────────────

def _yahoo_chart_v8(symbol: str, client) -> dict | None:
    """Fetch a single symbol via Yahoo Finance v8 chart API."""
    try:
        resp = client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"interval": "1d", "range": "5d"},
        )
        if resp.status_code == 200:
            meta = resp.json().get("chart", {}).get("result", [{}])[0].get("meta", {})
            if meta.get("regularMarketPrice") is not None:
                prev = meta.get("chartPreviousClose") or meta.get("regularMarketPreviousClose")
                price = meta["regularMarketPrice"]
                chg = round(price - prev, 4) if prev else None
                chg_pct = round((price - prev) / prev * 100, 4) if prev and prev != 0 else None
                return {
                    "symbol": symbol,
                    "regularMarketPrice": price,
                    "regularMarketChange": chg,
                    "regularMarketChangePercent": chg_pct,
                }
    except Exception:
        pass
    return None


def _yahoo_quote_direct(symbols: list[str]) -> dict[str, dict]:
    """
    Fetch quotes from Yahoo Finance.
    Primary: v7 batch endpoint.  Fallback: v8 chart endpoint (one request per symbol).
    """
    if not symbols:
        return {}
    import httpx
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://finance.yahoo.com",
        "Referer": "https://finance.yahoo.com/",
    }
    try:
        with httpx.Client(headers=headers, timeout=15, follow_redirects=True) as client:
            # Try v7 batch first
            resp = client.get(
                "https://query1.finance.yahoo.com/v7/finance/quote",
                params={"symbols": ",".join(symbols), "fields": "regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose"},
            )
            if resp.status_code == 200:
                quotes = resp.json().get("quoteResponse", {}).get("result", []) or []
                if quotes:
                    return {q["symbol"]: q for q in quotes}

            # v7 failed (401/429) — fall back to v8 chart per-symbol
            result: dict[str, dict] = {}
            for sym in symbols:
                q = _yahoo_chart_v8(sym, client)
                if q:
                    result[sym] = q
            return result
    except Exception:
        pass
    return {}


def fetch_live_prices(symbols: list[str]) -> dict[str, float | None]:
    """Fetch latest close prices for Thai SET stocks (.BK suffix)."""
    if not symbols:
        return {}

    def _fetch():
        # Try direct Yahoo Finance v7 API first
        bk_symbols = [s + ".BK" for s in symbols]
        quotes = _yahoo_quote_direct(bk_symbols)
        if quotes:
            return {sym: round(float(quotes[ticker]["regularMarketPrice"]), 2)
                    for sym, ticker in zip(symbols, bk_symbols)
                    if ticker in quotes and quotes[ticker].get("regularMarketPrice") is not None}

        # Fallback: yfinance download
        try:
            import yfinance as yf
            raw = yf.download(bk_symbols, period="5d", interval="1d", auto_adjust=False, progress=False)
            result: dict[str, float | None] = {}
            for sym, ticker in zip(symbols, bk_symbols):
                try:
                    closes = raw["Close"].dropna() if len(bk_symbols) == 1 else raw[("Close", ticker)].dropna()
                    result[sym] = round(float(closes.iloc[-1]), 2) if len(closes) > 0 else None
                except Exception:
                    result[sym] = None
            return result
        except Exception:
            return {s: None for s in symbols}

    return _cached(f"live_prices:{'|'.join(sorted(symbols))}", ttl=300, fn=_fetch)


def fetch_set_indices() -> list[dict[str, Any]]:
    """Fetch live Thai SET market index prices."""
    def _fetch():
        # ^SETI on Yahoo Finance maps to a US fund, not Thai SET.
        # The Thai SET composite is unavailable; use SET50/SET100/sSET as proxies.
        indices = [
            ("SET50", "^SET50.BK"),
            ("SET100", "^SET100.BK"),
            ("sSET", "^sSET.BK"),
        ]
        tickers = [t for _, t in indices]
        quotes = _yahoo_quote_direct(tickers)

        result: list[dict[str, Any]] = []
        for name, ticker in indices:
            q = quotes.get(ticker) or {}
            price = q.get("regularMarketPrice")
            chg = q.get("regularMarketChange")
            chg_pct = q.get("regularMarketChangePercent")
            result.append({
                "name": name,
                "value": round(float(price), 2) if price is not None else None,
                "change": round(float(chg), 2) if chg is not None else None,
                "changePct": round(float(chg_pct), 2) if chg_pct is not None else None,
            })
        return result

    return _cached("set_indices", ttl=300, fn=_fetch)


def fetch_global_indices() -> list[dict[str, Any]]:
    """Fetch S&P 500, NASDAQ, Dow Jones, BTC, and Gold prices."""
    def _fetch():
        indices = [
            ("S&P 500", "^GSPC"),
            ("NASDAQ",  "^IXIC"),
            ("DOW",     "^DJI"),
            ("BTC",     "BTC-USD"),
            ("XAUUSD",  "GC=F"),
        ]
        tickers = [t for _, t in indices]
        quotes = _yahoo_quote_direct(tickers)

        result: list[dict[str, Any]] = []
        for name, ticker in indices:
            q = quotes.get(ticker) or {}
            price = q.get("regularMarketPrice")
            chg_pct = q.get("regularMarketChangePercent")
            chg = q.get("regularMarketChange")
            result.append({
                "name": name,
                "value": round(float(price), 2) if price is not None else None,
                "change": round(float(chg), 2) if chg is not None else None,
                "changePct": round(float(chg_pct), 2) if chg_pct is not None else None,
            })
        return result

    return _cached("global_indices", ttl=300, fn=_fetch)


# ── Positions ─────────────────────────────────────────────────────────────────

def get_positions(
    from_date: date | None = None,
    to_date: date | None = None,
    status: str = "active",
) -> list[dict[str, Any]]:
    df = _load_df()
    today = date.today()
    open_mask = df["Exit Price"].isna()

    if status == "active":
        df = df[open_mask].copy()
    elif status == "closed":
        df = df[~open_mask].copy()
    else:
        df = df.copy()

    if from_date or to_date:
        def in_range(row: pd.Series) -> bool:
            is_open = pd.isna(row["Exit Price"])
            ref = (
                row["Entry Date"].date() if is_open and pd.notna(row["Entry Date"])
                else row["Exit Date"].date() if not is_open and pd.notna(row["Exit Date"])
                else None
            )
            if ref is None:
                return True
            if from_date and ref < from_date:
                return False
            if to_date and ref > to_date:
                return False
            return True

        df = df[df.apply(in_range, axis=1)]

    if df.empty:
        return []

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
            cur = live_prices.get(sym) or (
                float(row["Current price"]) if pd.notna(row["Current price"]) else entry
            )
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


# ── Performance chart + tables (CLOSED positions only) ────────────────────────

def _closed_rows(from_date: date, to_date: date) -> list[tuple[date, float]]:
    """Return (exit_date, net_pnl) for all CLOSED positions in the date range."""
    df = _load_df()
    today = date.today()
    closed_mask = df["Exit Price"].notna()
    closed = df[closed_mask].copy()

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
    return rows


def get_daily_performance(
    from_date: date | None = None,
    to_date: date | None = None,
    period: str = "daily",
) -> list[dict[str, Any]]:
    """Performance history — CLOSED (realized) trades only."""
    today = date.today()
    to_date = to_date or today
    from_date = from_date or (today - timedelta(days=30))

    rows = _closed_rows(from_date, to_date)
    if not rows:
        return []

    groups: dict[str, float] = {}
    labels: dict[str, str] = {}
    for d, net in rows:
        key, label = _period_key(d, period)
        groups[key] = groups.get(key, 0.0) + net
        labels[key] = label

    cumulative = 0.0
    result: list[dict[str, Any]] = []
    for k in sorted(groups):
        net = groups[k]
        cumulative += net
        result.append({
            "date": k,
            "label": labels[k],
            "dailyPnl": round(net, 0),
            "cumulativePnl": round(cumulative, 0),
        })
    return result


def get_performance_by_date(
    from_date: date | None = None,
    to_date: date | None = None,
    period: str = "daily",
) -> list[dict[str, Any]]:
    """Performance by period table — CLOSED trades only."""
    today = date.today()
    to_date = to_date or today
    from_date = from_date or (today - timedelta(days=30))

    rows = _closed_rows(from_date, to_date)
    if not rows:
        return []

    buckets: dict[str, dict] = {}
    labels: dict[str, str] = {}
    for d, net in rows:
        key, label = _period_key(d, period)
        if key not in buckets:
            buckets[key] = {"net": 0.0, "wins": 0, "losses": 0}
            labels[key] = label
        buckets[key]["net"] += net
        if net > 0:
            buckets[key]["wins"] += 1
        else:
            buckets[key]["losses"] += 1

    # Sort ascending to compute running total, then reverse for display
    sorted_keys = sorted(buckets)
    cumulative = 0.0
    acc: dict[str, float] = {}
    for k in sorted_keys:
        cumulative += buckets[k]["net"]
        acc[k] = cumulative

    result: list[dict[str, Any]] = []
    for k in reversed(sorted_keys):
        b = buckets[k]
        total = b["wins"] + b["losses"]
        win_rate = round(b["wins"] / total * 100, 1) if total > 0 else 0.0
        result.append({
            "period": k,
            "label": labels[k],
            "net": round(b["net"], 0),
            "accumulatedPnl": round(acc[k], 0),
            "wins": b["wins"],
            "losses": b["losses"],
            "total": total,
            "winRate": win_rate,
        })
    return result


def get_period_transactions(
    period_key: str,
    period: str,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict[str, Any]]:
    """Return individual CLOSED transactions that fall within a specific period bucket."""
    today = date.today()
    to_date = to_date or today
    from_date = from_date or (today - timedelta(days=30))

    df = _load_df()
    closed_mask = df["Exit Price"].notna()
    closed = df[closed_mask].copy()

    results: list[dict[str, Any]] = []
    for _, r in closed.iterrows():
        edate = r["Exit Date"].date() if pd.notna(r["Exit Date"]) else today
        if edate < from_date or edate > to_date:
            continue
        key, _ = _period_key(edate, period)
        if key != period_key:
            continue

        sym = str(r.get("Symbol", "")).strip()
        direction = str(r.get("Position (Long/Short)", "Long")).strip()
        entry = float(r["Entry Price"]) if pd.notna(r["Entry Price"]) else 0.0
        exit_p = float(r["Exit Price"]) if pd.notna(r["Exit Price"]) else entry
        size = float(r["Position Size"]) if pd.notna(r["Position Size"]) else 0.0
        net = _net_pnl(entry, exit_p, size, direction)
        pct = _pnl_pct(entry, exit_p, direction)
        sl = float(r["SL"]) if "SL" in r and pd.notna(r.get("SL")) else None
        tp = float(r["TP"]) if "TP" in r and pd.notna(r.get("TP")) else None
        remarks = str(r["Remarks"]) if "Remarks" in r and pd.notna(r.get("Remarks")) else None

        results.append({
            "symbol": sym,
            "direction": direction,
            "entryDate": r["Entry Date"].date().isoformat() if pd.notna(r["Entry Date"]) else None,
            "exitDate": edate.isoformat(),
            "entryPrice": entry,
            "exitPrice": exit_p,
            "positionSize": int(size),
            "netPnl": net,
            "pnlPct": pct,
            "sl": sl,
            "tp": tp,
            "remarks": remarks,
        })

    # Sort by exit date desc
    results.sort(key=lambda x: x["exitDate"] or "", reverse=True)
    return results


def get_performance_by_stock(
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict[str, Any]]:
    """Performance grouped by stock symbol — includes open + closed positions."""
    df = _load_df()
    today = date.today()
    to_date = to_date or today
    from_date = from_date or (today - timedelta(days=30))

    open_mask = df["Exit Price"].isna()
    open_syms = df[open_mask]["Symbol"].dropna().unique().tolist()
    live_prices = fetch_live_prices(open_syms)

    buckets: dict[str, dict] = {}

    for _, r in df.iterrows():
        sym = str(r.get("Symbol", "")).strip()
        if not sym:
            continue
        entry = float(r["Entry Price"]) if pd.notna(r["Entry Price"]) else 0.0
        size = float(r["Position Size"]) if pd.notna(r["Position Size"]) else 0.0
        direction = str(r.get("Position (Long/Short)", "Long"))
        is_open = pd.isna(r["Exit Price"])

        if is_open:
            ref_date = r["Entry Date"].date() if pd.notna(r["Entry Date"]) else today
            cur = live_prices.get(sym) or (
                float(r["Current price"]) if pd.notna(r["Current price"]) else entry
            )
        else:
            ref_date = r["Exit Date"].date() if pd.notna(r["Exit Date"]) else today
            cur = float(r["Exit Price"])

        if ref_date < from_date or ref_date > to_date:
            continue

        net = _net_pnl(entry, cur, size, direction)
        investment = round(entry * size, 0)
        current_val = round(cur * size, 0)

        if sym not in buckets:
            buckets[sym] = {"net": 0.0, "wins": 0, "losses": 0, "investment": 0.0, "currentValue": 0.0}
        buckets[sym]["net"] += net
        buckets[sym]["investment"] += investment
        buckets[sym]["currentValue"] += current_val
        if net > 0:
            buckets[sym]["wins"] += 1
        else:
            buckets[sym]["losses"] += 1

    result: list[dict[str, Any]] = []
    for sym, b in sorted(buckets.items(), key=lambda x: abs(x[1]["net"]), reverse=True):
        total = b["wins"] + b["losses"]
        win_rate = round(b["wins"] / total * 100, 1) if total > 0 else 0.0
        inv = b["investment"]
        pnl_pct = round(b["net"] / inv * 100, 2) if inv > 0 else 0.0
        result.append({
            "symbol": sym,
            "net": round(b["net"], 0),
            "investment": round(inv, 0),
            "currentValue": round(b["currentValue"], 0),
            "pnlPct": pnl_pct,
            "wins": b["wins"],
            "losses": b["losses"],
            "total": total,
            "winRate": win_rate,
        })
    return result
