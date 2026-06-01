"""Weekly Manual Scan endpoints."""


import asyncio
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.weekly_scan import UserScanConfig, WeeklyScan, WeeklyScanItem, UserSymbolList

UserId = Annotated[str, Depends(get_current_user_id)]
DB     = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(prefix="/weekly-scan", tags=["weekly-scan"])

# â"€â"€ Default symbol list (SET50 + extras) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

SET50_DEFAULT = [
    "ADVANC", "AOT", "AWC", "BANPU", "BBL", "BDMS", "BEM", "BGRIM", "BH", "BTS",
    "CBG", "CENTEL", "COM7", "CPALL", "CPF", "CPN", "CRC", "DELTA", "EA", "EGCO",
    "GPSC", "GULF", "HANA", "HMPRO", "INTUCH", "IVL", "KBANK", "KCE", "KTB", "KTC",
    "LH", "MINT", "MTC", "OR", "OSP", "PTT", "PTTEP", "PTTGC", "RATCH", "SAWAD",
    "SCB", "SCC", "SCGP", "TISCO", "TOP", "TRUE", "TTB", "TU", "WHA",
    "BTCUSD-DR", "GOLUSD-DR",
]

# â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

def _next_saturday() -> str:
    today = date.today()
    days_until_saturday = (5 - today.weekday()) % 7
    if days_until_saturday == 0:
        days_until_saturday = 7
    sat = today + timedelta(days=days_until_saturday)
    return sat.strftime("%d_%m_%Y")


def _prev_saturday() -> str:
    today = date.today()
    # Mon=0 … Sat=5 … Sun=6 → days since last Saturday (0 if today is Saturday)
    days_since = (today.weekday() - 5) % 7
    sat = today - timedelta(days=days_since)
    return sat.strftime("%d_%m_%Y")


def _color_counts(items: list[WeeklyScanItem]) -> dict[str, int]:
    counts: dict[str, int] = {"CYAN": 0, "GREEN": 0, "YELLOW": 0, "RED": 0, "PURPLE": 0, "NONE": 0}
    for item in items:
        key = item.color_mark if item.color_mark in counts else "NONE"
        counts[key] += 1
    return counts


def _item_dict(item: WeeklyScanItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "symbol": item.symbol,
        "sort_order": item.sort_order,
        "list_name": item.list_name,
        "market": item.market,
        "color_mark": item.color_mark,
        "strategy": item.strategy,
        "buy_price": float(item.buy_price) if item.buy_price is not None else None,
        "size": item.size,
        "tp": float(item.tp) if item.tp is not None else None,
        "sl": float(item.sl) if item.sl is not None else None,
        "remark": item.remark,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }

# â"€â"€ Pydantic schemas â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

class ConfigUpdate(BaseModel):
    symbols: list[str]

class ScanCreate(BaseModel):
    name: str

class ItemEval(BaseModel):
    color_mark: str | None = None
    strategy: str | None = None
    buy_price: float | None = None
    size: int | None = None
    tp: float | None = None
    sl: float | None = None
    remark: str | None = None

class ItemAdd(BaseModel):
    symbol: str
    list_name: str | None = None
    market: str = 'SET'

class SymbolListCreate(BaseModel):
    name: str
    market: str = 'SET'
    symbols: list[str] = []

class SymbolListUpdate(BaseModel):
    name: str | None = None
    market: str | None = None
    symbols: list[str] | None = None
    sort_order: int | None = None

# ── Week-price helpers ────────────────────────────────────────────────────────

def _parse_week_dates(scan_name: str) -> tuple[date | None, date | None]:
    """Extract Monday/Friday from scan name WEEKLY_SCAN_DD_MM_YYYY."""
    m = re.search(r'(\d{2})_(\d{2})_(\d{4})', scan_name)
    if not m:
        return None, None
    try:
        sat = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        return sat - timedelta(days=5), sat - timedelta(days=1)
    except ValueError:
        return None, None


def _sym_to_ticker(symbol: str, market: str = 'SET') -> str:
    sym = symbol.strip().upper()
    if market == 'CRYPTO' or sym.endswith('-DR') or 'USD' in sym:
        return sym
    if market == 'HK':
        return f"{sym.zfill(4)}.HK"
    if market in ('US', 'OTHER'):
        return sym
    return f"{sym}.BK"   # SET default


def _fetch_sym_prices(symbol: str, monday: date, friday: date, market: str = 'SET') -> dict[str, float | None]:
    today       = date.today()
    fetch_start = (monday - timedelta(days=7)).strftime("%Y-%m-%d")
    fetch_end   = (min(friday, today) + timedelta(days=4)).strftime("%Y-%m-%d")

    try:
        df = yf.Ticker(_sym_to_ticker(symbol, market)).history(
            start=fetch_start, end=fetch_end,
            interval="1d", auto_adjust=False, back_adjust=False,
        )
    except Exception:
        return {"mon": None, "fri": None}

    if df.empty:
        return {"mon": None, "fri": None}

    df.index  = pd.to_datetime(df.index).tz_localize(None)
    idx_dates = df.index.date  # numpy array of datetime.date

    mon_price: float | None = None
    if monday > today:
        col = df["Close"].dropna()
        if not col.empty:
            mon_price = round(float(col.iloc[-1]), 2)
    else:
        mask = idx_dates >= monday
        sub  = df.loc[mask, "Open"].dropna()
        if not sub.empty:
            mon_price = round(float(sub.iloc[0]), 2)

    fri_price: float | None = None
    if friday >= today:
        col = df["Close"].dropna()
        if not col.empty:
            fri_price = round(float(col.iloc[-1]), 2)
    else:
        mask = idx_dates <= friday
        sub  = df.loc[mask, "Close"].dropna()
        if not sub.empty:
            fri_price = round(float(sub.iloc[-1]), 2)

    return {"mon": mon_price, "fri": fri_price}

# ── Symbol-list endpoints ────────────────────────────────────────────────────

def _list_dict(sl: UserSymbolList) -> dict[str, Any]:
    return {
        "id": str(sl.id),
        "name": sl.name,
        "market": sl.market,
        "symbols": sl.symbols,
        "sort_order": sl.sort_order,
        "updated_at": sl.updated_at.isoformat() if sl.updated_at else None,
    }


@router.get("/symbol-lists")
async def list_symbol_lists(user_id: UserId, db: DB) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(UserSymbolList)
        .where(UserSymbolList.user_id == uid)
        .order_by(UserSymbolList.sort_order)
    )
    rows = result.scalars().all()

    # Migration helper: if user has no lists yet but has a legacy config, seed a "Default" list
    if not rows:
        config = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
        if config and config.symbols:
            seeded = UserSymbolList(
                user_id=uid,
                name="Default",
                symbols=config.symbols,
                sort_order=0,
            )
            db.add(seeded)
            await db.commit()
            await db.refresh(seeded)
            return [_list_dict(seeded)]

    return [_list_dict(sl) for sl in rows]


@router.post("/symbol-lists")
async def create_symbol_list(body: SymbolListCreate, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    # Place new list after the current highest sort_order
    max_order = await db.scalar(
        select(UserSymbolList.sort_order)
        .where(UserSymbolList.user_id == uid)
        .order_by(UserSymbolList.sort_order.desc())
        .limit(1)
    )
    next_order = (max_order + 1) if max_order is not None else 0
    symbols = [s.strip().upper() for s in body.symbols if s.strip()]
    sl = UserSymbolList(
        user_id=uid,
        name=body.name.strip(),
        market=body.market,
        symbols=symbols,
        sort_order=next_order,
    )
    db.add(sl)
    await db.commit()
    await db.refresh(sl)
    return _list_dict(sl)


@router.put("/symbol-lists/{list_id}")
async def update_symbol_list(
    list_id: str, body: SymbolListUpdate, user_id: UserId, db: DB
) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    sl = await db.scalar(
        select(UserSymbolList).where(
            UserSymbolList.id == uuid.UUID(list_id),
            UserSymbolList.user_id == uid,
        )
    )
    if sl is None:
        raise HTTPException(404, "Symbol list not found")
    if body.name is not None:
        sl.name = body.name.strip()
    if body.market is not None:
        sl.market = body.market
    if body.symbols is not None:
        sl.symbols = [s.strip().upper() for s in body.symbols if s.strip()]
    if body.sort_order is not None:
        sl.sort_order = body.sort_order
    await db.commit()
    await db.refresh(sl)
    return _list_dict(sl)


@router.delete("/symbol-lists/{list_id}")
async def delete_symbol_list(list_id: str, user_id: UserId, db: DB) -> Response:
    uid = uuid.UUID(user_id)
    sl = await db.scalar(
        select(UserSymbolList).where(
            UserSymbolList.id == uuid.UUID(list_id),
            UserSymbolList.user_id == uid,
        )
    )
    if sl is None:
        raise HTTPException(404, "Symbol list not found")
    await db.delete(sl)
    await db.commit()
    return Response(status_code=204)


# ── Config endpoints ──────────────────────────────────────────────────────────

@router.get("/config")
async def get_scan_config(user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    row = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
    if row is None:
        # Seed defaults on first access
        row = UserScanConfig(user_id=uid, symbols=SET50_DEFAULT)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return {"symbols": row.symbols, "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.put("/config")
async def update_scan_config(body: ConfigUpdate, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    symbols = [s.strip().upper() for s in body.symbols if s.strip()]
    row = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
    if row is None:
        row = UserScanConfig(user_id=uid, symbols=symbols)
        db.add(row)
    else:
        row.symbols = symbols
    await db.commit()
    await db.refresh(row)
    return {"symbols": row.symbols, "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.get("/suggest-name")
async def suggest_name(user_id: UserId, db: DB) -> dict[str, str]:
    uid = uuid.UUID(user_id)
    has_scans = await db.scalar(
        select(WeeklyScan.id).where(WeeklyScan.user_id == uid).limit(1)
    )
    date_str = _next_saturday() if has_scans else _prev_saturday()
    return {"name": f"WEEKLY_SCAN_{date_str}"}

# â"€â"€ Scan list endpoints â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

@router.get("/scans")
async def list_scans(user_id: UserId, db: DB) -> list[dict[str, Any]]:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(WeeklyScan)
        .where(WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
        .order_by(WeeklyScan.created_at.desc())
    )
    scans = result.scalars().all()
    out = []
    for s in scans:
        counts = _color_counts(s.items)
        out.append({
            "id": str(s.id),
            "name": s.name,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
            "total": len(s.items),
            "color_counts": counts,
        })
    return out


@router.post("/scans")
async def create_scan(body: ScanCreate, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)

    scan = WeeklyScan(user_id=uid, name=body.name.strip())
    db.add(scan)
    await db.flush()

    # Prefer named symbol lists; fall back to legacy UserScanConfig
    lists_result = await db.execute(
        select(UserSymbolList)
        .where(UserSymbolList.user_id == uid)
        .order_by(UserSymbolList.sort_order)
    )
    symbol_lists = lists_result.scalars().all()

    counter = 0
    if symbol_lists:
        for sl in symbol_lists:
            for sym in sl.symbols:
                sym = sym.strip().upper()
                if sym:
                    db.add(WeeklyScanItem(
                        scan_id=scan.id,
                        symbol=sym,
                        sort_order=counter,
                        list_name=sl.name,
                        market=sl.market,
                    ))
                    counter += 1
    else:
        config = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
        symbols = config.symbols if config else SET50_DEFAULT
        for sym in symbols:
            sym = sym.strip().upper()
            if sym:
                db.add(WeeklyScanItem(scan_id=scan.id, symbol=sym, sort_order=counter))
                counter += 1

    await db.commit()
    await db.refresh(scan)
    return {"id": str(scan.id), "name": scan.name, "created_at": scan.created_at.isoformat()}


@router.get("/scans/{scan_id}")
async def get_scan(scan_id: str, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")
    return {
        "id": str(scan.id),
        "name": scan.name,
        "created_at": scan.created_at.isoformat(),
        "updated_at": scan.updated_at.isoformat(),
        "items": [_item_dict(it) for it in scan.items],
        "color_counts": _color_counts(scan.items),
    }


@router.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str, user_id: UserId, db: DB) -> Response:
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan).where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")
    await db.delete(scan)
    await db.commit()
    return Response(status_code=204)


@router.post("/scans/{scan_id}/refresh")
async def refresh_scan(scan_id: str, user_id: UserId, db: DB) -> dict[str, Any]:
    """Merge current symbol lists into the scan, re-assigning list_name for every item."""
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")

    # Auto-seed "Default" list from legacy config if user has no lists yet
    lists_result = await db.execute(
        select(UserSymbolList).where(UserSymbolList.user_id == uid).order_by(UserSymbolList.sort_order)
    )
    symbol_lists = list(lists_result.scalars().all())

    if not symbol_lists:
        config = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
        seed_syms = config.symbols if (config and config.symbols) else SET50_DEFAULT
        seeded = UserSymbolList(user_id=uid, name="Default", symbols=seed_syms, sort_order=0)
        db.add(seeded)
        await db.flush()
        symbol_lists = [seeded]

    existing = {it.symbol: it for it in scan.items}
    next_order = max((it.sort_order for it in scan.items), default=-1) + 1
    # Track first-list winner so a symbol appearing in multiple lists gets the first one
    assigned: set[str] = set()

    for sl in symbol_lists:
        for sym in sl.symbols:
            sym = sym.strip().upper()
            if not sym:
                continue
            if sym in existing:
                item = existing[sym]
                # Always re-assign list_name and market; first matching list wins
                if sym not in assigned:
                    item.list_name = sl.name
                    item.market    = sl.market
                    assigned.add(sym)
            else:
                db.add(WeeklyScanItem(
                    scan_id=scan.id, symbol=sym,
                    sort_order=next_order, list_name=sl.name, market=sl.market,
                ))
                assigned.add(sym)
                next_order += 1

    await db.execute(text("UPDATE weekly_scans SET updated_at = now() WHERE id = :id"), {"id": scan.id})
    await db.commit()

    items_result = await db.execute(
        select(WeeklyScanItem).where(WeeklyScanItem.scan_id == scan.id).order_by(WeeklyScanItem.sort_order)
    )
    items = items_result.scalars().all()
    return {
        "id": str(scan.id),
        "name": scan.name,
        "items": [_item_dict(it) for it in items],
        "color_counts": _color_counts(items),
    }

# â"€â"€ Item endpoints â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

@router.post("/scans/{scan_id}/items")
async def add_item(scan_id: str, body: ItemAdd, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")
    sym = body.symbol.strip().upper()
    if any(it.symbol == sym for it in scan.items):
        raise HTTPException(409, f"{sym} already in scan")
    next_order = max((it.sort_order for it in scan.items), default=-1) + 1
    item = WeeklyScanItem(scan_id=scan.id, symbol=sym, sort_order=next_order, list_name=body.list_name, market=body.market)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


@router.put("/scans/{scan_id}/items/{symbol}")
async def upsert_item(scan_id: str, symbol: str, body: ItemEval, user_id: UserId, db: DB) -> dict[str, Any]:
    uid = uuid.UUID(user_id)
    # Verify scan ownership
    scan = await db.scalar(
        select(WeeklyScan).where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")
    sym = symbol.upper()
    item = await db.scalar(
        select(WeeklyScanItem).where(WeeklyScanItem.scan_id == scan.id, WeeklyScanItem.symbol == sym)
    )
    if item is None:
        raise HTTPException(404, f"{sym} not in scan")

    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(item, field, val)

    await db.execute(text("UPDATE weekly_scans SET updated_at = now() WHERE id = :id"), {"id": scan.id})
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


@router.delete("/scans/{scan_id}/items/{symbol}")
async def delete_item(scan_id: str, symbol: str, user_id: UserId, db: DB) -> Response:
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan).where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")
    sym = symbol.upper()
    item = await db.scalar(
        select(WeeklyScanItem).where(WeeklyScanItem.scan_id == scan.id, WeeklyScanItem.symbol == sym)
    )
    if item is None:
        raise HTTPException(404, f"{sym} not in scan")
    await db.delete(item)
    await db.commit()
    return Response(status_code=204)


# ── Week prices endpoint ──────────────────────────────────────────────────────

@router.get("/scans/{scan_id}/week-prices")
async def get_week_prices(scan_id: str, user_id: UserId, db: DB) -> dict[str, Any]:
    """Return Monday open and Friday close prices for every symbol in the scan."""
    uid  = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")

    monday, friday = _parse_week_dates(scan.name)
    items          = scan.items
    sym_market     = {it.symbol: it.market for it in items}
    symbols        = list(sym_market.keys())

    if not symbols or monday is None:
        return {
            "mon_date": monday.isoformat() if monday else None,
            "fri_date": friday.isoformat() if friday else None,
            "prices": {s: {"mon": None, "fri": None} for s in symbols},
        }

    loop = asyncio.get_running_loop()
    sem  = asyncio.Semaphore(5)

    async def _fetch(sym: str) -> tuple[str, dict]:
        async with sem:
            result = await loop.run_in_executor(
                None, _fetch_sym_prices, sym, monday, friday, sym_market.get(sym, 'SET')
            )
        return sym, result

    pairs  = await asyncio.gather(*[_fetch(s) for s in symbols])
    prices = {sym: data for sym, data in pairs}

    return {
        "mon_date": monday.isoformat(),
        "fri_date": friday.isoformat(),
        "prices": prices,
    }
