"""Export endpoint — Financial Tracker: a full, restorable snapshot of one
Tracking Set (`GET /sets/{set_id}/export`).

Ownership: reuses `_get_or_404` from `tracking_sets.py` rather than
duplicating it — same bare-404-never-403 behavior as every other resource in
this service (see that module's docstring), so a cross-user request never
distinguishes "doesn't exist" from "exists but isn't yours."

Business logic lives here rather than in a separate service module: unlike
`dashboard_balance_grid.py` there is no computation to perform (no deltas,
no rollups, no winner selection) — this is a pure read-and-assemble of rows
that already exist, so a dedicated service module would just be an
unnecessary indirection over what is effectively one function.

Scoping: every query below is scoped by the FK chain down from the
already-verified `tracking_set_id` (mirrors `dashboard_balance_grid.py` and
the nested-list endpoints in `tracking_sets.py`/`categories.py`), AND
additionally filtered by `user_id` as belt-and-suspenders defense-in-depth —
this endpoint hands back a full data dump intended for later re-import, so
an extra, redundant ownership filter on each query costs nothing and means
a future bug that ever let `tracking_set_id` be resolved for the wrong
tracking set could not also leak another user's rows through this endpoint.

Performance: one query per table (7 total, after the ownership check) is
fine for a low-frequency, read-only export operation — no N+1 concern at
this scale, matching the reasoning in `dashboard_balance_grid.py`'s
module docstring.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.tracking_sets import _get_or_404
from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.models.category import Category
from app.models.initial_investment_entry import InitialInvestmentEntry
from app.models.sub_category import SubCategory
from app.models.tracking_item import TrackingItem
from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance
from app.schemas.export import (
    EXPORT_VERSION,
    CategoryExport,
    InitialInvestmentEntryExport,
    SubCategoryExport,
    TrackingExportOut,
    TrackingItemExport,
    TrackingSetExport,
    UpdateTrackingListBalanceExport,
    UpdateTrackingListExport,
)

router = APIRouter(tags=["Export"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/sets/{set_id}/export", response_model=TrackingExportOut)
async def export_tracking_set(set_id: uuid.UUID, user_id: UserId, db: DB) -> TrackingExportOut:
    tracking_set = await _get_or_404(set_id, user_id, db)
    uid = uuid.UUID(user_id)

    categories_result = await db.execute(
        select(Category)
        .where(Category.tracking_set_id == tracking_set.id, Category.user_id == uid)
        .order_by(Category.order_index.asc())
    )
    categories = list(categories_result.scalars().all())
    category_ids = [c.id for c in categories]

    sub_categories: list[SubCategory] = []
    if category_ids:
        sub_categories_result = await db.execute(
            select(SubCategory)
            .where(SubCategory.category_id.in_(category_ids), SubCategory.user_id == uid)
            .order_by(SubCategory.order_index.asc())
        )
        sub_categories = list(sub_categories_result.scalars().all())
    sub_category_ids = [s.id for s in sub_categories]

    tracking_items: list[TrackingItem] = []
    if sub_category_ids:
        tracking_items_result = await db.execute(
            select(TrackingItem)
            .where(
                TrackingItem.sub_category_id.in_(sub_category_ids),
                TrackingItem.user_id == uid,
            )
            .order_by(TrackingItem.order_index.asc())
        )
        tracking_items = list(tracking_items_result.scalars().all())
    tracking_item_ids = [i.id for i in tracking_items]

    update_tracking_lists_result = await db.execute(
        select(UpdateTrackingList)
        .where(
            UpdateTrackingList.tracking_set_id == tracking_set.id,
            UpdateTrackingList.user_id == uid,
        )
        .order_by(UpdateTrackingList.transaction_date.asc(), UpdateTrackingList.created_at.asc())
    )
    update_tracking_lists = list(update_tracking_lists_result.scalars().all())
    update_tracking_list_ids = [u.id for u in update_tracking_lists]

    update_tracking_list_balances: list[UpdateTrackingListBalance] = []
    if update_tracking_list_ids:
        balances_result = await db.execute(
            select(UpdateTrackingListBalance).where(
                UpdateTrackingListBalance.update_tracking_list_id.in_(update_tracking_list_ids),
                UpdateTrackingListBalance.user_id == uid,
            )
        )
        update_tracking_list_balances = list(balances_result.scalars().all())

    initial_investment_entries: list[InitialInvestmentEntry] = []
    if tracking_item_ids:
        entries_result = await db.execute(
            select(InitialInvestmentEntry)
            .where(
                InitialInvestmentEntry.tracking_item_id.in_(tracking_item_ids),
                InitialInvestmentEntry.user_id == uid,
            )
            .order_by(InitialInvestmentEntry.entry_date.asc())
        )
        initial_investment_entries = list(entries_result.scalars().all())

    return TrackingExportOut(
        export_version=EXPORT_VERSION,
        exported_at=datetime.now(timezone.utc).isoformat(),
        tracking_set=TrackingSetExport.model_validate(tracking_set),
        categories=[CategoryExport.model_validate(c) for c in categories],
        sub_categories=[SubCategoryExport.model_validate(s) for s in sub_categories],
        tracking_items=[TrackingItemExport.model_validate(i) for i in tracking_items],
        update_tracking_lists=[
            UpdateTrackingListExport.model_validate(u) for u in update_tracking_lists
        ],
        update_tracking_list_balances=[
            UpdateTrackingListBalanceExport.model_validate(b)
            for b in update_tracking_list_balances
        ],
        initial_investment_entries=[
            InitialInvestmentEntryExport.model_validate(e) for e in initial_investment_entries
        ],
    )
