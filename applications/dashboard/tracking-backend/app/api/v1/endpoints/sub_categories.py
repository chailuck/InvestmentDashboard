"""Sub-Category endpoints — single-entity CRUD plus nested tracking-item actions."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.sub_category import SubCategory
from app.models.tracking_item import TrackingItem
from app.schemas.category import ReorderRequest
from app.schemas.sub_category import SubCategoryOut, SubCategoryUpdate
from app.schemas.tracking_item import TrackingItemCreate, TrackingItemOut

router = APIRouter(prefix="/sub-categories", tags=["Sub-Categories"])
_log = get_logger("api.sub_categories")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_or_404(sub_category_id: uuid.UUID, user_id: str, db: AsyncSession) -> SubCategory:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(SubCategory).where(SubCategory.id == sub_category_id, SubCategory.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Sub-category not found")
    return obj


@router.get("/{sub_category_id}", response_model=SubCategoryOut)
async def get_sub_category(sub_category_id: uuid.UUID, user_id: UserId, db: DB) -> SubCategory:
    return await _get_or_404(sub_category_id, user_id, db)


@router.put("/{sub_category_id}", response_model=SubCategoryOut)
async def update_sub_category(
    sub_category_id: uuid.UUID, body: SubCategoryUpdate, user_id: UserId, db: DB
) -> SubCategory:
    sub_category = await _get_or_404(sub_category_id, user_id, db)
    if body.name is not None:
        sub_category.name = body.name.strip()
    if body.description is not None:
        sub_category.description = body.description
    if body.order is not None:
        sub_category.order_index = body.order
    await db.commit()
    await db.refresh(sub_category)
    _log.info("Sub-category updated", user_id=user_id, sub_category_id=str(sub_category.id))
    return sub_category


@router.delete("/{sub_category_id}", status_code=204, response_model=None)
async def delete_sub_category(sub_category_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    sub_category = await _get_or_404(sub_category_id, user_id, db)
    await db.delete(sub_category)  # DB-level ON DELETE CASCADE removes items/entries
    await db.commit()
    _log.info("Sub-category deleted", user_id=user_id, sub_category_id=str(sub_category_id))
    return Response(status_code=204)


# ── Nested: tracking items under a sub-category ─────────────────────────────

@router.post("/{sub_category_id}/items", response_model=TrackingItemOut, status_code=201)
async def create_tracking_item(
    sub_category_id: uuid.UUID, body: TrackingItemCreate, user_id: UserId, db: DB
) -> TrackingItem:
    sub_category = await _get_or_404(sub_category_id, user_id, db)
    uid = uuid.UUID(user_id)

    order = body.order
    if order is None:
        max_result = await db.execute(
            select(TrackingItem.order_index)
            .where(TrackingItem.sub_category_id == sub_category.id)
            .order_by(TrackingItem.order_index.desc())
            .limit(1)
        )
        current_max = max_result.scalar_one_or_none()
        order = (current_max or 0) + 1

    item = TrackingItem(
        user_id=uid,
        sub_category_id=sub_category.id,
        name=body.name.strip(),
        type=body.type,
        initial_investment_tracking=body.initial_investment_tracking,
        exclusive=body.exclusive,
        order_index=order,
        description=body.description,
        account_name=body.account_name,
        remark=body.remark,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/{sub_category_id}/items", response_model=list[TrackingItemOut])
async def list_tracking_items(sub_category_id: uuid.UUID, user_id: UserId, db: DB) -> list[TrackingItem]:
    await _get_or_404(sub_category_id, user_id, db)
    result = await db.execute(
        select(TrackingItem)
        .where(TrackingItem.sub_category_id == sub_category_id)
        .order_by(TrackingItem.order_index.asc())
    )
    return list(result.scalars().all())


@router.put("/{sub_category_id}/items/reorder")
async def reorder_tracking_items(
    sub_category_id: uuid.UUID, body: ReorderRequest, user_id: UserId, db: DB
) -> dict[str, str]:
    sub_category = await _get_or_404(sub_category_id, user_id, db)
    result = await db.execute(
        select(TrackingItem).where(TrackingItem.sub_category_id == sub_category.id)
    )
    existing = {i.id: i for i in result.scalars().all()}

    requested_ids = {item.id for item in body.items}
    if not requested_ids.issubset(existing.keys()):
        raise HTTPException(400, "All ids must belong to the given sub-category")

    for item in body.items:
        existing[item.id].order_index = item.order
    await db.commit()
    _log.info(
        "Tracking items reordered",
        user_id=user_id,
        sub_category_id=str(sub_category_id),
        count=len(body.items),
    )
    return {"status": "ok"}
