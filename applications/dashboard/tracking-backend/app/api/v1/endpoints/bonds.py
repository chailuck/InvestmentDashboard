"""BOND register endpoints — a standalone CRUD register of individual bond
holdings attached to a TrackingItem of type ``BOND``.

Scope: register only. NO rollup / balance-grid / export / analysis
integration — a bond never contributes to any aggregate view.

Routing: this router carries NO prefix because its paths span two roots —
``/items/{item_id}/bonds`` (collection under an item) and
``/bonds/{bond_id}`` (single bond by id) — so every route spells its full
path explicitly, the same shape the entries feature uses across
``tracking_items.py`` and ``entries.py``.

``status`` is derived on every read (never stored) via
:func:`app.services.bond_status.compute_bond_status`, against a single
Bangkok "today" captured once per request.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.bond import Bond
from app.models.tracking_item import TrackingItem
from app.schemas.bond import BondCreate, BondOut, BondUpdate
from app.services.bond_status import bangkok_today, compute_bond_status, compute_bond_years
from app.services.item_type_capabilities import Capability
from app.services.item_type_registry import ItemTypeRegistry

router = APIRouter(tags=["Bonds"])
_log = get_logger("api.bonds")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_item_or_404(item_id: uuid.UUID, user_id: str, db: AsyncSession) -> TrackingItem:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(TrackingItem).where(TrackingItem.id == item_id, TrackingItem.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Tracking item not found")
    return obj


async def _get_bond_or_404(bond_id: uuid.UUID, user_id: str, db: AsyncSession) -> Bond:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Bond)
        .join(TrackingItem, TrackingItem.id == Bond.tracking_item_id)
        .where(Bond.id == bond_id, TrackingItem.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Bond not found")
    return obj


async def _require_bond_item(item: TrackingItem, db: AsyncSession) -> None:
    """Capability gate — the item's type must carry `bond_register` (ADR-027).
    Raised AFTER `_get_item_or_404`, so a cross-user id is still 404 not 400;
    same 400 + `{"detail": ...}` contract as before. Message no longer names
    'BOND' — a renamed bond type still works."""
    registry = await ItemTypeRegistry.create(db)
    resolved = registry.get(item.type_id)
    if resolved is None or not resolved.has_capability(Capability.BOND_REGISTER.value):
        raise HTTPException(
            400,
            "This tracking item's type does not provide a bond register; "
            "bonds can only be registered against an item whose type has the "
            "bond-register capability",
        )


def _to_out(b: Bond, today: date) -> BondOut:
    return BondOut(
        id=b.id,
        tracking_item_id=b.tracking_item_id,
        code=b.code,
        issuer=b.issuer,
        start_date=b.start_date,
        expired_date=b.expired_date,
        amount=b.amount,
        interest_rate=b.interest_rate,
        status=compute_bond_status(b.start_date, b.expired_date, today),
        years=compute_bond_years(b.start_date, b.expired_date),
        created_at=b.created_at,
        updated_at=b.updated_at,
    )


# ── Collection under a tracking item ───────────────────────────────────────


@router.get("/items/{item_id}/bonds", response_model=list[BondOut])
async def list_bonds(item_id: uuid.UUID, user_id: UserId, db: DB) -> list[BondOut]:
    item = await _get_item_or_404(item_id, user_id, db)
    await _require_bond_item(item, db)
    result = await db.execute(
        select(Bond)
        .where(Bond.tracking_item_id == item_id)
        .order_by(Bond.start_date.asc().nulls_last(), Bond.created_at.asc())
    )
    bonds = list(result.scalars().all())
    today = bangkok_today()
    _log.info("Bonds listed", user_id=user_id, item_id=str(item_id), count=len(bonds))
    return [_to_out(b, today) for b in bonds]


@router.post("/items/{item_id}/bonds", response_model=BondOut, status_code=201)
async def create_bond(
    item_id: uuid.UUID, body: BondCreate, user_id: UserId, db: DB
) -> BondOut:
    item = await _get_item_or_404(item_id, user_id, db)
    await _require_bond_item(item, db)
    bond = Bond(
        tracking_item_id=item.id,
        code=body.code,
        issuer=body.issuer,
        start_date=body.start_date,
        expired_date=body.expired_date,
        amount=body.amount,
        interest_rate=body.interest_rate,
    )
    db.add(bond)
    await db.commit()
    await db.refresh(bond)
    _log.info("Bond created", user_id=user_id, item_id=str(item_id), bond_id=str(bond.id))
    return _to_out(bond, bangkok_today())


# ── Single bond by id ──────────────────────────────────────────────────────


@router.get("/bonds/{bond_id}", response_model=BondOut)
async def get_bond(bond_id: uuid.UUID, user_id: UserId, db: DB) -> BondOut:
    bond = await _get_bond_or_404(bond_id, user_id, db)
    return _to_out(bond, bangkok_today())


@router.put("/bonds/{bond_id}", response_model=BondOut)
async def update_bond(
    bond_id: uuid.UUID, body: BondUpdate, user_id: UserId, db: DB
) -> BondOut:
    bond = await _get_bond_or_404(bond_id, user_id, db)

    # Presence-aware: only keys the client actually sent are applied. `code`
    # and `amount` are NOT NULL, so an explicit `null` for either is a 422,
    # not a clear request. `issuer` / `start_date` / `expired_date` are
    # nullable, so an explicit `null` clears them.
    data = body.model_dump(exclude_unset=True)
    if "code" in data:
        if data["code"] is None:
            raise HTTPException(422, "code cannot be null")
        bond.code = data["code"]
    if "amount" in data:
        if data["amount"] is None:
            raise HTTPException(422, "amount cannot be null")
        bond.amount = data["amount"]
    if "issuer" in data:
        bond.issuer = data["issuer"]  # already blank -> None coerced by the schema
    if "interest_rate" in data:
        bond.interest_rate = data["interest_rate"]   # explicit null clears — column is nullable
    if "start_date" in data:
        bond.start_date = data["start_date"]
    if "expired_date" in data:
        bond.expired_date = data["expired_date"]

    await db.commit()
    await db.refresh(bond)
    _log.info("Bond updated", user_id=user_id, bond_id=str(bond.id))
    return _to_out(bond, bangkok_today())


@router.delete("/bonds/{bond_id}", status_code=204, response_model=None)
async def delete_bond(bond_id: uuid.UUID, user_id: UserId, db: DB) -> Response:
    bond = await _get_bond_or_404(bond_id, user_id, db)
    await db.delete(bond)
    await db.commit()
    _log.info("Bond deleted", user_id=user_id, bond_id=str(bond_id))
    return Response(status_code=204)
