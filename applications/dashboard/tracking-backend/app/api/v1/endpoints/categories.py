"""Category endpoints — single-entity CRUD plus nested sub-category actions."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.category import Category
from app.models.sub_category import SubCategory
from app.schemas.category import CategoryOut, CategoryUpdate
from app.schemas.sub_category import SubCategoryCreate, SubCategoryOut
from app.schemas.category import ReorderRequest

router = APIRouter(prefix="/categories", tags=["Categories"])
_log = get_logger("api.categories")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_or_404(category_id: uuid.UUID, user_id: str, db: AsyncSession) -> Category:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Category not found")
    return obj


@router.get("/{category_id}", response_model=CategoryOut)
async def get_category(category_id: uuid.UUID, user_id: UserId, db: DB) -> Category:
    return await _get_or_404(category_id, user_id, db)


@router.put("/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: uuid.UUID, body: CategoryUpdate, user_id: UserId, db: DB
) -> Category:
    category = await _get_or_404(category_id, user_id, db)
    if body.name is not None:
        category.name = body.name.strip()
    if body.description is not None:
        category.description = body.description
    if body.order is not None:
        category.order_index = body.order
    await db.commit()
    await db.refresh(category)
    _log.info("Category updated", user_id=user_id, category_id=str(category.id))
    return category


@router.delete("/{category_id}", status_code=204, response_model=None)
async def delete_category(category_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    category = await _get_or_404(category_id, user_id, db)
    await db.delete(category)  # DB-level ON DELETE CASCADE removes sub-cats/items/entries
    await db.commit()
    _log.info("Category deleted", user_id=user_id, category_id=str(category_id))
    return Response(status_code=204)


# ── Nested: sub-categories under a category ─────────────────────────────────

@router.post("/{category_id}/sub-categories", response_model=SubCategoryOut, status_code=201)
async def create_sub_category(
    category_id: uuid.UUID, body: SubCategoryCreate, user_id: UserId, db: DB
) -> SubCategory:
    category = await _get_or_404(category_id, user_id, db)
    uid = uuid.UUID(user_id)

    order = body.order
    if order is None:
        max_result = await db.execute(
            select(SubCategory.order_index)
            .where(SubCategory.category_id == category.id)
            .order_by(SubCategory.order_index.desc())
            .limit(1)
        )
        current_max = max_result.scalar_one_or_none()
        order = (current_max or 0) + 1

    sub_category = SubCategory(
        user_id=uid,
        category_id=category.id,
        name=body.name.strip(),
        description=body.description,
        order_index=order,
    )
    db.add(sub_category)
    await db.commit()
    await db.refresh(sub_category)
    return sub_category


@router.get("/{category_id}/sub-categories", response_model=list[SubCategoryOut])
async def list_sub_categories(category_id: uuid.UUID, user_id: UserId, db: DB) -> list[SubCategory]:
    await _get_or_404(category_id, user_id, db)
    result = await db.execute(
        select(SubCategory)
        .where(SubCategory.category_id == category_id)
        .order_by(SubCategory.order_index.asc())
    )
    return list(result.scalars().all())


@router.put("/{category_id}/sub-categories/reorder")
async def reorder_sub_categories(
    category_id: uuid.UUID, body: ReorderRequest, user_id: UserId, db: DB
) -> dict[str, str]:
    category = await _get_or_404(category_id, user_id, db)
    result = await db.execute(select(SubCategory).where(SubCategory.category_id == category.id))
    existing = {s.id: s for s in result.scalars().all()}

    requested_ids = {item.id for item in body.items}
    if not requested_ids.issubset(existing.keys()):
        raise HTTPException(400, "All ids must belong to the given category")

    for item in body.items:
        existing[item.id].order_index = item.order
    await db.commit()
    _log.info(
        "Sub-categories reordered", user_id=user_id, category_id=str(category_id), count=len(body.items)
    )
    return {"status": "ok"}
