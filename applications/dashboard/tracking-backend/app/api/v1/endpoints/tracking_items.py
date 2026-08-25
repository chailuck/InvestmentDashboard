"""Tracking Item endpoints — single-entity CRUD plus nested ledger-entry
actions and the running-total projection.

Gating rule: entries (and the running-total view) are only available for
items with `initial_investment_tracking=True`. This is enforced here at the
application layer (not the DB) because it is a mutable per-item flag, not a
structural constraint.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.initial_investment_entry import InitialInvestmentEntry
from app.models.tracking_item import TrackingItem
from app.schemas.initial_investment_entry import (
    EntryCreate,
    EntryOut,
    RunningTotalOut,
    RunningTotalRow,
)
from app.schemas.tracking_item import TrackingItemOut, TrackingItemUpdate

router = APIRouter(prefix="/items", tags=["Tracking Items"])
_log = get_logger("api.tracking_items")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_or_404(item_id: uuid.UUID, user_id: str, db: AsyncSession) -> TrackingItem:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(TrackingItem).where(TrackingItem.id == item_id, TrackingItem.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Tracking item not found")
    return obj


@router.get("/{item_id}", response_model=TrackingItemOut)
async def get_tracking_item(item_id: uuid.UUID, user_id: UserId, db: DB) -> TrackingItem:
    return await _get_or_404(item_id, user_id, db)


@router.put("/{item_id}", response_model=TrackingItemOut)
async def update_tracking_item(
    item_id: uuid.UUID, body: TrackingItemUpdate, user_id: UserId, db: DB
) -> TrackingItem:
    item = await _get_or_404(item_id, user_id, db)
    if body.name is not None:
        item.name = body.name.strip()
    if body.type is not None:
        item.type = body.type
    if body.initial_investment_tracking is not None:
        item.initial_investment_tracking = body.initial_investment_tracking
    if body.exclusive is not None:
        item.exclusive = body.exclusive
    if body.order is not None:
        item.order_index = body.order
    if body.description is not None:
        item.description = body.description
    if body.account_name is not None:
        item.account_name = body.account_name
    if body.remark is not None:
        item.remark = body.remark
    await db.commit()
    await db.refresh(item)
    _log.info("Tracking item updated", user_id=user_id, item_id=str(item.id))
    return item


@router.delete("/{item_id}", status_code=204, response_model=None)
async def delete_tracking_item(item_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    item = await _get_or_404(item_id, user_id, db)
    await db.delete(item)  # DB-level ON DELETE CASCADE removes entries
    await db.commit()
    _log.info("Tracking item deleted", user_id=user_id, item_id=str(item_id))
    return Response(status_code=204)


# ── Nested: ledger entries under a tracking item ────────────────────────────

@router.post("/{item_id}/entries", response_model=EntryOut, status_code=201)
async def create_entry(
    item_id: uuid.UUID, body: EntryCreate, user_id: UserId, db: DB
) -> InitialInvestmentEntry:
    item = await _get_or_404(item_id, user_id, db)
    if not item.initial_investment_tracking:
        raise HTTPException(
            400,
            "This tracking item does not have initial_investment_tracking enabled; "
            "enable it before adding ledger entries",
        )
    uid = uuid.UUID(user_id)
    entry = InitialInvestmentEntry(
        user_id=uid,
        tracking_item_id=item.id,
        amount=body.amount,
        entry_date=body.entry_date,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/{item_id}/entries", response_model=list[EntryOut])
async def list_entries(item_id: uuid.UUID, user_id: UserId, db: DB) -> list[InitialInvestmentEntry]:
    await _get_or_404(item_id, user_id, db)
    result = await db.execute(
        select(InitialInvestmentEntry)
        .where(InitialInvestmentEntry.tracking_item_id == item_id)
        .order_by(
            InitialInvestmentEntry.entry_date.asc(),
            InitialInvestmentEntry.created_at.asc(),
        )
    )
    return list(result.scalars().all())


@router.get("/{item_id}/running-total", response_model=RunningTotalOut)
async def running_total(item_id: uuid.UUID, user_id: UserId, db: DB) -> RunningTotalOut:
    item = await _get_or_404(item_id, user_id, db)
    if not item.initial_investment_tracking:
        raise HTTPException(
            400,
            "This tracking item does not have initial_investment_tracking enabled",
        )
    result = await db.execute(
        select(InitialInvestmentEntry)
        .where(InitialInvestmentEntry.tracking_item_id == item_id)
        .order_by(
            InitialInvestmentEntry.entry_date.asc(),
            InitialInvestmentEntry.created_at.asc(),
        )
    )
    entries = list(result.scalars().all())

    rows: list[RunningTotalRow] = []
    running: Decimal = Decimal("0")
    for e in entries:
        running += e.amount
        rows.append(
            RunningTotalRow(
                id=e.id,
                entry_date=e.entry_date,
                amount=e.amount,
                running_total=running,
            )
        )

    return RunningTotalOut(item_id=item.id, current_total=running, entries=rows)
