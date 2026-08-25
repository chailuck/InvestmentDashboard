"""Initial Investment Entry endpoints — standalone CRUD by entry id."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.initial_investment_entry import InitialInvestmentEntry
from app.schemas.initial_investment_entry import EntryOut, EntryUpdate

router = APIRouter(prefix="/entries", tags=["Entries"])
_log = get_logger("api.entries")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_or_404(entry_id: uuid.UUID, user_id: str, db: AsyncSession) -> InitialInvestmentEntry:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(InitialInvestmentEntry).where(
            InitialInvestmentEntry.id == entry_id, InitialInvestmentEntry.user_id == uid
        )
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Entry not found")
    return obj


@router.get("/{entry_id}", response_model=EntryOut)
async def get_entry(entry_id: uuid.UUID, user_id: UserId, db: DB) -> InitialInvestmentEntry:
    return await _get_or_404(entry_id, user_id, db)


@router.put("/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: uuid.UUID, body: EntryUpdate, user_id: UserId, db: DB
) -> InitialInvestmentEntry:
    entry = await _get_or_404(entry_id, user_id, db)
    if body.amount is not None:
        entry.amount = body.amount
    if body.entry_date is not None:
        entry.entry_date = body.entry_date
    await db.commit()
    await db.refresh(entry)
    _log.info("Entry updated", user_id=user_id, entry_id=str(entry.id))
    return entry


@router.delete("/{entry_id}", status_code=204, response_model=None)
async def delete_entry(entry_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    entry = await _get_or_404(entry_id, user_id, db)
    await db.delete(entry)
    await db.commit()
    _log.info("Entry deleted", user_id=user_id, entry_id=str(entry_id))
    return Response(status_code=204)
