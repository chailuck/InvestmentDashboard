"""Tracking Set endpoints — the top-level container for a user's tracker.

Ownership pattern: every lookup goes through `_get_or_404`, which filters by
both `id` AND `user_id` and raises 404 (never 403) on no match — so a
cross-user access attempt is indistinguishable from a nonexistent resource
(existence is never leaked). This mirrors
`applications/dashboard/backend/app/api/v1/endpoints/portfolio_db.py`'s
`_get_or_404` pattern exactly.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.category import Category
from app.models.tracking_set import TrackingSet
from app.schemas.category import CategoryCreate, CategoryOut, ReorderRequest
from app.schemas.tracking_set import TrackingSetCreate, TrackingSetOut, TrackingSetUpdate
from app.services.cascade import create_tracking_set_with_defaults

router = APIRouter(prefix="/sets", tags=["Tracking Sets"])
_log = get_logger("api.tracking_sets")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_or_404(set_id: uuid.UUID, user_id: str, db: AsyncSession) -> TrackingSet:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(TrackingSet).where(TrackingSet.id == set_id, TrackingSet.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Tracking set not found")
    return obj


@router.post("", response_model=TrackingSetOut, status_code=201)
async def create_tracking_set(body: TrackingSetCreate, user_id: UserId, db: DB) -> TrackingSet:
    uid = uuid.UUID(user_id)
    try:
        tracking_set = await create_tracking_set_with_defaults(
            db, user_id_uuid=uid, name=body.name.strip(), description=body.description
        )
        await db.commit()
        await db.refresh(tracking_set)
    except IntegrityError as exc:
        await db.rollback()
        _log.warning("Duplicate tracking set name", user_id=user_id, name=body.name)
        raise HTTPException(409, "A tracking set with this name already exists") from exc
    _log.info("Tracking set created", user_id=user_id, tracking_set_id=str(tracking_set.id))
    return tracking_set


@router.get("", response_model=list[TrackingSetOut])
async def list_tracking_sets(user_id: UserId, db: DB) -> list[TrackingSet]:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(TrackingSet).where(TrackingSet.user_id == uid).order_by(TrackingSet.created_at.asc())
    )
    return list(result.scalars().all())


@router.get("/{set_id}", response_model=TrackingSetOut)
async def get_tracking_set(set_id: uuid.UUID, user_id: UserId, db: DB) -> TrackingSet:
    return await _get_or_404(set_id, user_id, db)


@router.put("/{set_id}", response_model=TrackingSetOut)
async def update_tracking_set(
    set_id: uuid.UUID, body: TrackingSetUpdate, user_id: UserId, db: DB
) -> TrackingSet:
    tracking_set = await _get_or_404(set_id, user_id, db)
    if body.name is not None:
        tracking_set.name = body.name.strip()
    if body.description is not None:
        tracking_set.description = body.description
    try:
        await db.commit()
        await db.refresh(tracking_set)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "A tracking set with this name already exists") from exc
    _log.info("Tracking set updated", user_id=user_id, tracking_set_id=str(tracking_set.id))
    return tracking_set


@router.delete("/{set_id}", status_code=204, response_model=None)
async def delete_tracking_set(set_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    tracking_set = await _get_or_404(set_id, user_id, db)
    await db.delete(tracking_set)  # DB-level ON DELETE CASCADE removes categories/subcats/items/entries
    await db.commit()
    _log.info("Tracking set deleted", user_id=user_id, tracking_set_id=str(set_id))
    return Response(status_code=204)


# ── Nested: categories under a set ───────────────────────────────────────────

@router.post("/{set_id}/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    set_id: uuid.UUID, body: CategoryCreate, user_id: UserId, db: DB
) -> Category:
    tracking_set = await _get_or_404(set_id, user_id, db)
    uid = uuid.UUID(user_id)

    order = body.order
    if order is None:
        max_result = await db.execute(
            select(Category.order_index)
            .where(Category.tracking_set_id == tracking_set.id)
            .order_by(Category.order_index.desc())
            .limit(1)
        )
        current_max = max_result.scalar_one_or_none()
        order = (current_max or 0) + 1

    category = Category(
        user_id=uid,
        tracking_set_id=tracking_set.id,
        name=body.name.strip(),
        description=body.description,
        order_index=order,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("/{set_id}/categories", response_model=list[CategoryOut])
async def list_categories(set_id: uuid.UUID, user_id: UserId, db: DB) -> list[Category]:
    await _get_or_404(set_id, user_id, db)
    result = await db.execute(
        select(Category).where(Category.tracking_set_id == set_id).order_by(Category.order_index.asc())
    )
    return list(result.scalars().all())


@router.put("/{set_id}/categories/reorder")
async def reorder_categories(
    set_id: uuid.UUID, body: ReorderRequest, user_id: UserId, db: DB
) -> dict[str, str]:
    tracking_set = await _get_or_404(set_id, user_id, db)
    result = await db.execute(select(Category).where(Category.tracking_set_id == tracking_set.id))
    existing = {c.id: c for c in result.scalars().all()}

    requested_ids = {item.id for item in body.items}
    if not requested_ids.issubset(existing.keys()):
        raise HTTPException(400, "All ids must belong to the given tracking set")

    for item in body.items:
        existing[item.id].order_index = item.order
    await db.commit()
    _log.info(
        "Categories reordered", user_id=user_id, tracking_set_id=str(set_id), count=len(body.items)
    )
    return {"status": "ok"}
