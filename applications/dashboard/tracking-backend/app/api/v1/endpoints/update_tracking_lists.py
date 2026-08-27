"""Update Tracking List endpoints — Phase 2 of the Financial Tracker:
periodic balance snapshots ("updates") against a Tracking Set's category /
sub-category / tracking-item hierarchy, plus the read-time delta
computation against the immediately preceding snapshot.

Two distinct URL families live in this one router — no single fixed
`prefix=` covers both, so unlike most endpoint modules in this service this
router carries none and each route spells out its full path:
  - `/sets/{set_id}/update-lists` — create/list headers under a set
  - `/update-lists/{list_id}` — standalone header CRUD + detail + balances

This mirrors how `tracking_sets.py` nests `/sets/{set_id}/categories`
alongside its own `/sets` CRUD, and how `categories.py` nests
`/categories/{category_id}/sub-categories`.

Ownership pattern: identical `_get_or_404`-style helpers as every other
endpoints module in this service — bare 404 (never 403) on any cross-user
access attempt, so existence is never leaked.
"""

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
from app.models.tracking_item import TrackingItem
from app.models.tracking_set import TrackingSet
from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance
from app.schemas.update_tracking_list import (
    BalanceUpsertRequest,
    UpdateTrackingListBalanceOut,
    UpdateTrackingListCreate,
    UpdateTrackingListDetailCategory,
    UpdateTrackingListDetailItem,
    UpdateTrackingListDetailOut,
    UpdateTrackingListDetailSubCategory,
    UpdateTrackingListOut,
    UpdateTrackingListUpdate,
)
from app.services.update_tracking import get_update_list_detail

router = APIRouter(tags=["Update Tracking Lists"])
_log = get_logger("api.update_tracking_lists")

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_set_or_404(set_id: uuid.UUID, user_id: str, db: AsyncSession) -> TrackingSet:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(TrackingSet).where(TrackingSet.id == set_id, TrackingSet.user_id == uid)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Tracking set not found")
    return obj


async def _get_list_or_404(list_id: uuid.UUID, user_id: str, db: AsyncSession) -> UpdateTrackingList:
    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(UpdateTrackingList).where(
            UpdateTrackingList.id == list_id, UpdateTrackingList.user_id == uid
        )
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Update tracking list not found")
    return obj


# ── Nested under a set: create/list headers ──────────────────────────────────


@router.post(
    "/sets/{set_id}/update-lists", response_model=UpdateTrackingListOut, status_code=201
)
async def create_update_tracking_list(
    set_id: uuid.UUID, body: UpdateTrackingListCreate, user_id: UserId, db: DB
) -> UpdateTrackingList:
    tracking_set = await _get_set_or_404(set_id, user_id, db)
    uid = uuid.UUID(user_id)

    update_list = UpdateTrackingList(
        user_id=uid,
        tracking_set_id=tracking_set.id,
        transaction_date=body.transaction_date,
        quarter=body.quarter,
        year=body.year,
    )
    db.add(update_list)
    await db.commit()
    await db.refresh(update_list)
    _log.info(
        "Update tracking list created",
        user_id=user_id,
        tracking_set_id=str(set_id),
        update_tracking_list_id=str(update_list.id),
    )
    return update_list


@router.get("/sets/{set_id}/update-lists", response_model=list[UpdateTrackingListOut])
async def list_update_tracking_lists(
    set_id: uuid.UUID, user_id: UserId, db: DB
) -> list[UpdateTrackingList]:
    await _get_set_or_404(set_id, user_id, db)
    result = await db.execute(
        select(UpdateTrackingList)
        .where(UpdateTrackingList.tracking_set_id == set_id)
        .order_by(UpdateTrackingList.transaction_date.desc(), UpdateTrackingList.created_at.desc())
    )
    return list(result.scalars().all())


# ── Standalone header CRUD ────────────────────────────────────────────────────


@router.get("/update-lists/{list_id}", response_model=UpdateTrackingListOut)
async def get_update_tracking_list(list_id: uuid.UUID, user_id: UserId, db: DB) -> UpdateTrackingList:
    return await _get_list_or_404(list_id, user_id, db)


@router.put("/update-lists/{list_id}", response_model=UpdateTrackingListOut)
async def update_update_tracking_list(
    list_id: uuid.UUID, body: UpdateTrackingListUpdate, user_id: UserId, db: DB
) -> UpdateTrackingList:
    update_list = await _get_list_or_404(list_id, user_id, db)

    # Presence-aware update: only fields the client actually sent are
    # applied, so an explicit `null` clears a field while an omitted key
    # leaves it untouched — `is not None` checks alone cannot distinguish
    # those two cases and would make a field impossible to ever clear.
    #
    # transaction_date is the one exception: it is NOT NULL at the DB layer,
    # so an explicit `null` for it (unlike quarter/year, which are legitimately
    # clearable) is a client error, not a clear-to-null request — reject it
    # with 422 instead of letting it reach the DB as an unhandled
    # IntegrityError on commit.
    update_data = body.model_dump(exclude_unset=True)
    if "transaction_date" in update_data:
        if update_data["transaction_date"] is None:
            raise HTTPException(422, "transactionDate cannot be null")
        update_list.transaction_date = update_data["transaction_date"]
    if "quarter" in update_data:
        update_list.quarter = update_data["quarter"]
    if "year" in update_data:
        update_list.year = update_data["year"]

    await db.commit()
    await db.refresh(update_list)
    _log.info(
        "Update tracking list updated", user_id=user_id, update_tracking_list_id=str(update_list.id)
    )
    return update_list


@router.delete("/update-lists/{list_id}", status_code=204, response_model=None)
async def delete_update_tracking_list(list_id: uuid.UUID, user_id: UserId, db: DB) -> None:
    from fastapi.responses import Response

    update_list = await _get_list_or_404(list_id, user_id, db)
    await db.delete(update_list)  # DB-level ON DELETE CASCADE removes balance rows
    await db.commit()
    _log.info("Update tracking list deleted", user_id=user_id, update_tracking_list_id=str(list_id))
    return Response(status_code=204)


# ── Detail: full hierarchy + balances + read-time deltas ────────────────────


@router.get("/update-lists/{list_id}/detail", response_model=UpdateTrackingListDetailOut)
async def get_update_tracking_list_detail(
    list_id: uuid.UUID, user_id: UserId, db: DB
) -> UpdateTrackingListDetailOut:
    uid = uuid.UUID(user_id)
    detail = await get_update_list_detail(db, list_id=list_id, user_id=uid)
    if detail is None:
        raise HTTPException(404, "Update tracking list not found")

    return UpdateTrackingListDetailOut(
        list=UpdateTrackingListOut.model_validate(detail.list),
        previous_list_id=detail.previous_list_id,
        categories=[
            UpdateTrackingListDetailCategory(
                id=cat.id,
                name=cat.name,
                order_index=cat.order_index,
                sub_categories=[
                    UpdateTrackingListDetailSubCategory(
                        id=sub.id,
                        name=sub.name,
                        order_index=sub.order_index,
                        items=[
                            UpdateTrackingListDetailItem(
                                id=it.id,
                                name=it.name,
                                type=it.type,
                                order_index=it.order_index,
                                balance=it.balance,
                                previous_balance=it.previous_balance,
                                delta_amount=it.delta_amount,
                                delta_percent=it.delta_percent,
                                has_previous_data=it.has_previous_data,
                            )
                            for it in sub.items
                        ],
                    )
                    for sub in cat.sub_categories
                ],
            )
            for cat in detail.categories
        ],
    )


# ── Bulk balance upsert ───────────────────────────────────────────────────────


@router.put("/update-lists/{list_id}/balances", response_model=list[UpdateTrackingListBalanceOut])
async def upsert_update_tracking_list_balances(
    list_id: uuid.UUID, body: BalanceUpsertRequest, user_id: UserId, db: DB
) -> list[UpdateTrackingListBalance]:
    update_list = await _get_list_or_404(list_id, user_id, db)
    uid = uuid.UUID(user_id)

    if not body.balances:
        return []

    requested_ids = {b.tracking_item_id for b in body.balances}

    # Validate EVERY id resolves to a tracking item under THIS list's own
    # tracking_set_id (not merely the same user) before writing anything.
    valid_result = await db.execute(
        select(TrackingItem.id)
        .join(SubCategory, TrackingItem.sub_category_id == SubCategory.id)
        .join(Category, SubCategory.category_id == Category.id)
        .where(
            TrackingItem.id.in_(requested_ids),
            TrackingItem.user_id == uid,
            Category.tracking_set_id == update_list.tracking_set_id,
        )
    )
    valid_ids = {row[0] for row in valid_result.all()}
    invalid_ids = requested_ids - valid_ids
    if invalid_ids:
        invalid_str = ", ".join(str(i) for i in sorted(invalid_ids, key=str))
        raise HTTPException(
            400,
            f"Invalid trackingItemId(s) for this tracking set: {invalid_str}",
        )

    # All-or-nothing upsert: load existing rows for the requested items,
    # then update-in-place or insert, and commit exactly once.
    existing_result = await db.execute(
        select(UpdateTrackingListBalance).where(
            UpdateTrackingListBalance.update_tracking_list_id == update_list.id,
            UpdateTrackingListBalance.tracking_item_id.in_(requested_ids),
        )
    )
    existing_by_item = {row.tracking_item_id: row for row in existing_result.scalars().all()}

    ordered_ids: list[uuid.UUID] = []
    for b in body.balances:
        if b.tracking_item_id not in ordered_ids:
            ordered_ids.append(b.tracking_item_id)

        row = existing_by_item.get(b.tracking_item_id)
        if row is None:
            row = UpdateTrackingListBalance(
                user_id=uid,
                update_tracking_list_id=update_list.id,
                tracking_item_id=b.tracking_item_id,
                balance=b.balance,
            )
            db.add(row)
            existing_by_item[b.tracking_item_id] = row
        else:
            row.balance = b.balance

    await db.commit()
    written = [existing_by_item[item_id] for item_id in ordered_ids]
    for row in written:
        await db.refresh(row)

    _log.info(
        "Update tracking list balances upserted",
        user_id=user_id,
        update_tracking_list_id=str(list_id),
        count=len(written),
    )
    return written
