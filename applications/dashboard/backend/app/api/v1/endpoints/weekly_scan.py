"""Weekly Manual Scan endpoints."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.weekly_scan import UserScanConfig, WeeklyScan, WeeklyScanItem

UserId = Annotated[str, Depends(get_current_user_id)]
DB     = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter(prefix="/weekly-scan", tags=["weekly-scan"])

# ── Default symbol list (SET50 + extras) ──────────────────────────────────────

SET50_DEFAULT = [
    "ADVANC", "AOT", "AWC", "BANPU", "BBL", "BDMS", "BEM", "BGRIM", "BH", "BTS",
    "CBG", "CENTEL", "COM7", "CPALL", "CPF", "CPN", "CRC", "DELTA", "EA", "EGCO",
    "GPSC", "GULF", "HANA", "HMPRO", "INTUCH", "IVL", "KBANK", "KCE", "KTB", "KTC",
    "LH", "MINT", "MTC", "OR", "OSP", "PTT", "PTTEP", "PTTGC", "RATCH", "SAWAD",
    "SCB", "SCC", "SCGP", "TISCO", "TOP", "TRUE", "TTB", "TU", "WHA",
    "BTCUSD-DR", "GOLUSD-DR",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_saturday() -> str:
    today = date.today()
    days_until_saturday = (5 - today.weekday()) % 7
    if days_until_saturday == 0:
        days_until_saturday = 7
    sat = today + timedelta(days=days_until_saturday)
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
        "color_mark": item.color_mark,
        "strategy": item.strategy,
        "buy_price": float(item.buy_price) if item.buy_price is not None else None,
        "size": item.size,
        "tp": float(item.tp) if item.tp is not None else None,
        "sl": float(item.sl) if item.sl is not None else None,
        "remark": item.remark,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }

# ── Pydantic schemas ──────────────────────────────────────────────────────────

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
async def suggest_name(_: UserId) -> dict[str, str]:
    return {"name": f"WEEKLY_SCAN_{_next_saturday()}"}

# ── Scan list endpoints ───────────────────────────────────────────────────────

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
    # Load config symbols
    config = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
    symbols = config.symbols if config else SET50_DEFAULT

    scan = WeeklyScan(user_id=uid, name=body.name.strip())
    db.add(scan)
    await db.flush()

    for i, sym in enumerate(symbols):
        db.add(WeeklyScanItem(scan_id=scan.id, symbol=sym.upper(), sort_order=i))

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
    """Merge current config symbols into the scan — adds new, preserves existing evaluations."""
    uid = uuid.UUID(user_id)
    scan = await db.scalar(
        select(WeeklyScan)
        .where(WeeklyScan.id == uuid.UUID(scan_id), WeeklyScan.user_id == uid)
        .options(selectinload(WeeklyScan.items))
    )
    if scan is None:
        raise HTTPException(404, "Scan not found")

    config = await db.scalar(select(UserScanConfig).where(UserScanConfig.user_id == uid))
    symbols = [s.upper() for s in (config.symbols if config else SET50_DEFAULT)]

    existing = {it.symbol: it for it in scan.items}
    next_order = max((it.sort_order for it in scan.items), default=-1) + 1

    for sym in symbols:
        if sym not in existing:
            db.add(WeeklyScanItem(scan_id=scan.id, symbol=sym, sort_order=next_order))
            next_order += 1

    await db.execute(text("UPDATE weekly_scans SET updated_at = now() WHERE id = :id"), {"id": scan.id})
    await db.commit()
    await db.refresh(scan)

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

# ── Item endpoints ────────────────────────────────────────────────────────────

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
    item = WeeklyScanItem(scan_id=scan.id, symbol=sym, sort_order=next_order)
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
