"""DR Mapping endpoints — global config for DR-to-parent symbol mapping."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id, require_admin
from app.database.session import get_db
from app.models.dr_mapping import DrMapping

router = APIRouter(prefix="/dr-mappings", tags=["DR Mappings"])

UserId  = Annotated[str, Depends(get_current_user_id)]
AdminId = Annotated[str, Depends(require_admin)]
DB      = Annotated[AsyncSession, Depends(get_db)]


# ── Schemas ──────────────────────────────────────────────────────────────────

class DrMappingCreate(BaseModel):
    dr_symbol:     str   = Field(..., min_length=1, max_length=30)
    parent_symbol: str   = Field(..., min_length=1, max_length=30)
    parent_market: str   = Field("CRYPTO", max_length=20)
    ratio:         float = Field(..., gt=0)
    is_active:     bool  = True


class DrMappingUpdate(BaseModel):
    parent_symbol: str | None   = Field(None, max_length=30)
    parent_market: str | None   = Field(None, max_length=20)
    ratio:         float | None = Field(None, gt=0)
    is_active:     bool | None  = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _auto_desc(parent_symbol: str, ratio: float, dr_symbol: str) -> str:
    r = int(ratio) if ratio == int(ratio) else f"{ratio:g}"
    return f"1 {parent_symbol} = {r} {dr_symbol}"


def _row(m: DrMapping) -> dict[str, Any]:
    ratio = float(m.ratio)
    return {
        "id":            m.id,
        "dr_symbol":     m.dr_symbol,
        "parent_symbol": m.parent_symbol,
        "parent_market": m.parent_market,
        "ratio":         ratio,
        "description":   _auto_desc(m.parent_symbol, ratio, m.dr_symbol),
        "is_active":     m.is_active,
        "created_at":    m.created_at.isoformat() if m.created_at else None,
        "updated_at":    m.updated_at.isoformat() if m.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_mappings(user_id: UserId, db: DB) -> list[dict]:
    """Return all DR mappings — readable by every authenticated user."""
    result = await db.execute(select(DrMapping).order_by(DrMapping.dr_symbol))
    return [_row(m) for m in result.scalars().all()]


@router.get("/{dr_symbol}")
async def get_mapping(dr_symbol: str, user_id: UserId, db: DB) -> dict:
    """Return one mapping by DR symbol."""
    m = await db.scalar(
        select(DrMapping).where(DrMapping.dr_symbol == dr_symbol.upper())
    )
    if m is None:
        raise HTTPException(404, f"No mapping found for {dr_symbol.upper()}")
    return _row(m)


@router.post("", status_code=201)
async def create_mapping(body: DrMappingCreate, user_id: AdminId, db: DB) -> dict:
    """Create a new DR mapping — admin only."""
    sym = body.dr_symbol.strip().upper()
    existing = await db.scalar(select(DrMapping).where(DrMapping.dr_symbol == sym))
    if existing:
        raise HTTPException(409, f"Mapping for {sym} already exists")

    parent_sym = body.parent_symbol.strip().upper()
    m = DrMapping(
        dr_symbol=sym,
        parent_symbol=parent_sym,
        parent_market=body.parent_market.strip().upper(),
        ratio=body.ratio,
        description=_auto_desc(parent_sym, body.ratio, sym),
        is_active=body.is_active,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _row(m)


@router.put("/{mapping_id}")
async def update_mapping(mapping_id: int, body: DrMappingUpdate, user_id: AdminId, db: DB) -> dict:
    """Update an existing DR mapping — admin only."""
    m = await db.scalar(select(DrMapping).where(DrMapping.id == mapping_id))
    if m is None:
        raise HTTPException(404, "Mapping not found")

    if body.parent_symbol is not None:
        m.parent_symbol = body.parent_symbol.strip().upper()
    if body.parent_market is not None:
        m.parent_market = body.parent_market.strip().upper()
    if body.ratio is not None:
        m.ratio = body.ratio
    if body.is_active is not None:
        m.is_active = body.is_active
    # Always regenerate description from current values
    m.description = _auto_desc(m.parent_symbol, float(m.ratio), m.dr_symbol)

    await db.commit()
    await db.refresh(m)
    return _row(m)


@router.delete("/{mapping_id}")
async def delete_mapping(mapping_id: int, user_id: AdminId, db: DB) -> Response:
    """Delete a DR mapping — admin only."""
    m = await db.scalar(select(DrMapping).where(DrMapping.id == mapping_id))
    if m is None:
        raise HTTPException(404, "Mapping not found")
    await db.delete(m)
    await db.commit()
    return Response(status_code=204)
