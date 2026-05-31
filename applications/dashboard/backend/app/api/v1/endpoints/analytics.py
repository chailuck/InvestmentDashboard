"""Analytics endpoints — chart data, analysis logs, fibo charts, symbol notes, search."""

from __future__ import annotations

import asyncio
import base64
import glob
import os
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.symbol_note import SymbolNote
from app.services.app_config_service import get_app_config

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(prefix="/analytics", tags=["analytics"])

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_ANALYSIS_LOG_PATH = "/app/investment_agent/analysis_log"
DEFAULT_FIBO_PATH = "/app/investment_agent/charts/Fibo"


def _get_paths() -> tuple[str, str]:
    cfg = get_app_config()
    log_path = cfg.get("analysis_log_path", DEFAULT_ANALYSIS_LOG_PATH)
    fibo_path = cfg.get("fibo_chart_path", DEFAULT_FIBO_PATH)
    return log_path, fibo_path


# ── Indicator helpers ─────────────────────────────────────────────────────────

def _calc_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _calc_stoch(high: pd.Series, low: pd.Series, close: pd.Series,
                k_period: int = 9, smooth_k: int = 3, d_period: int = 3) -> tuple[pd.Series, pd.Series]:
    lowest_low = low.rolling(k_period).min()
    highest_high = high.rolling(k_period).max()
    denom = (highest_high - lowest_low).replace(0, np.nan)
    raw_k = 100 * (close - lowest_low) / denom
    smooth_k_series = raw_k.rolling(smooth_k).mean()
    d_series = smooth_k_series.rolling(d_period).mean()
    return smooth_k_series, d_series


def _calc_vrvp(df: pd.DataFrame, bins: int = 24) -> list[dict]:
    """Volume Range Visible Profile — bins volume by price range."""
    if df.empty:
        return []
    price_min = df["Low"].min()
    price_max = df["High"].max()
    if price_min == price_max:
        return []
    edges = np.linspace(price_min, price_max, bins + 1)
    volumes = np.zeros(bins)
    for _, row in df.iterrows():
        mid = (row["High"] + row["Low"]) / 2
        idx = np.searchsorted(edges[1:], mid, side="left")
        idx = min(idx, bins - 1)
        volumes[idx] += row["Volume"]
    return [
        {"price_low": round(float(edges[i]), 4), "price_high": round(float(edges[i + 1]), 4),
         "volume": int(volumes[i])}
        for i in range(bins)
    ]


def _ticker_sym(symbol: str, asset_type: str) -> list[str]:
    sym = symbol.strip().upper()
    if asset_type == "CRYPTO":
        return [f"{sym}-USD", f"{sym}-USDT", sym]
    if asset_type == "DR":
        return [f"{sym}.BK", sym]
    # SET default
    return [f"{sym}.BK", sym]


def _fetch_ohlcv(symbol: str, asset_type: str, period: str) -> pd.DataFrame:
    for t in _ticker_sym(symbol, asset_type):
        try:
            df = yf.Ticker(t).history(period=period)
            if not df.empty:
                df.index = pd.to_datetime(df.index).tz_localize(None)
                return df
        except Exception:
            continue
    return pd.DataFrame()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/chart")
async def get_chart_data(
    _: UserId,
    symbol: str = Query(...),
    asset_type: str = Query("SET"),
    period: str = Query("6mo"),
) -> dict[str, Any]:
    df = await asyncio.get_event_loop().run_in_executor(
        None, _fetch_ohlcv, symbol, asset_type, period
    )
    if df.empty:
        raise HTTPException(404, f"No data found for {symbol}")

    rsi = _calc_rsi(df["Close"])
    stoch_k, stoch_d = _calc_stoch(df["High"], df["Low"], df["Close"])
    vrvp = _calc_vrvp(df)

    def _ts(dt) -> str:
        return dt.strftime("%Y-%m-%d")

    candles = [
        {"time": _ts(idx), "open": round(float(r.Open), 4), "high": round(float(r.High), 4),
         "low": round(float(r.Low), 4), "close": round(float(r.Close), 4)}
        for idx, r in df.iterrows()
    ]
    volume = [
        {"time": _ts(idx), "value": int(r.Volume),
         "color": "rgba(34,197,94,0.5)" if r.Close >= r.Open else "rgba(239,68,68,0.5)"}
        for idx, r in df.iterrows()
    ]
    rsi_data = [
        {"time": _ts(idx), "value": round(float(v), 2)}
        for idx, v in rsi.items() if not np.isnan(v)
    ]
    stoch_k_data = [
        {"time": _ts(idx), "value": round(float(v), 2)}
        for idx, v in stoch_k.items() if not np.isnan(v)
    ]
    stoch_d_data = [
        {"time": _ts(idx), "value": round(float(v), 2)}
        for idx, v in stoch_d.items() if not np.isnan(v)
    ]

    return {
        "symbol": symbol.upper(),
        "candles": candles,
        "volume": volume,
        "rsi": rsi_data,
        "stoch_k": stoch_k_data,
        "stoch_d": stoch_d_data,
        "vrvp": vrvp,
    }


@router.get("/search")
async def search_symbol(
    _: UserId,
    q: str = Query(..., min_length=1),
    asset_type: str = Query("SET"),
) -> dict[str, Any]:
    """Quick lookup: fetch 5d history for the symbol and return basic info."""
    sym = q.strip().upper()
    tickers = _ticker_sym(sym, asset_type)

    def _lookup():
        for t in tickers:
            try:
                tk = yf.Ticker(t)
                hist = tk.history(period="5d")
                if hist.empty:
                    continue
                info = tk.fast_info
                prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else float(hist["Close"].iloc[-1])
                last_close = float(hist["Close"].iloc[-1])
                chg_pct = (last_close - prev_close) / prev_close * 100 if prev_close else 0
                return {
                    "symbol": sym,
                    "ticker": t,
                    "asset_type": asset_type,
                    "name": getattr(info, "currency", t),
                    "price": round(last_close, 4),
                    "change_pct": round(chg_pct, 2),
                    "found": True,
                }
            except Exception:
                continue
        return {"symbol": sym, "found": False}

    result = await asyncio.get_event_loop().run_in_executor(None, _lookup)
    return result


@router.get("/analysis-log")
async def get_analysis_log(
    _: UserId,
    symbol: str = Query(...),
) -> dict[str, Any]:
    log_path, _ = _get_paths()
    sym = symbol.strip().upper()
    # Search HTML first, then MD; pick the most recently modified overall
    all_files = []
    for ext in ["html", "md"]:
        all_files.extend(glob.glob(os.path.join(log_path, f"*{sym}*.{ext}")))
    if not all_files:
        return {"found": False, "content": None, "filename": None, "file_type": None}
    latest = max(all_files, key=os.path.getmtime)
    try:
        content = Path(latest).read_text(encoding="utf-8", errors="replace")
        file_type = "html" if latest.endswith(".html") else "md"
        return {
            "found": True,
            "content": content,
            "filename": os.path.basename(latest),
            "file_type": file_type,
        }
    except Exception as e:
        return {"found": False, "content": None, "filename": None, "file_type": None, "error": str(e)}


@router.get("/fibo-chart")
async def get_fibo_chart(
    _: UserId,
    symbol: str = Query(...),
) -> dict[str, Any]:
    _, fibo_path = _get_paths()
    sym = symbol.strip().upper()
    patterns = [
        os.path.join(fibo_path, f"*{sym}*.png"),
        os.path.join(fibo_path, f"*{sym}*.jpg"),
        os.path.join(fibo_path, f"*{sym}*.jpeg"),
        os.path.join(fibo_path, f"*{sym}*.webp"),
    ]
    files = []
    for p in patterns:
        files.extend(glob.glob(p))
    files = sorted(files, key=os.path.getmtime, reverse=True)
    if not files:
        return {"found": False, "image": None, "filename": None}
    latest = files[0]
    try:
        ext = Path(latest).suffix.lower().lstrip(".")
        mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(ext, "png")
        data = base64.b64encode(Path(latest).read_bytes()).decode()
        return {"found": True, "image": f"data:image/{mime};base64,{data}", "filename": os.path.basename(latest)}
    except Exception as e:
        return {"found": False, "image": None, "filename": None, "error": str(e)}


# ── Symbol notes ──────────────────────────────────────────────────────────────

class NoteUpsert(BaseModel):
    symbol: str
    asset_type: str = "SET"
    note: str


@router.get("/note")
async def get_note(user_id: UserId, db: DB, symbol: str = Query(...)) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    sym = symbol.strip().upper()
    row = await db.execute(
        select(SymbolNote).where(SymbolNote.user_id == uid, SymbolNote.symbol == sym)
    )
    note = row.scalar_one_or_none()
    if note is None:
        return {"symbol": sym, "note": "", "found": False}
    return {"symbol": sym, "note": note.note, "asset_type": note.asset_type, "found": True}


@router.put("/note")
async def upsert_note(body: NoteUpsert, user_id: UserId, db: DB) -> dict[str, str]:
    uid = uuid.UUID(user_id)
    sym = body.symbol.strip().upper()
    stmt = (
        pg_insert(SymbolNote)
        .values(user_id=uid, symbol=sym, asset_type=body.asset_type, note=body.note)
        .on_conflict_do_update(
            constraint="uq_symbol_note_user_symbol",
            set_={"note": body.note, "updated_at": func.now()},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"status": "ok"}
