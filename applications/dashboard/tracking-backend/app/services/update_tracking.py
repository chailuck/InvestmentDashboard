"""Read-time delta computation for the Update Tracking List detail view
(Phase 2 of the Financial Tracker).

Deltas are NEVER stored — every call recomputes them from the current and
previous UpdateTrackingList's balance rows, so editing an older list's
balance immediately changes what a newer list's detail reports (see
tests/test_update_tracking_lists.py's
test_detail_delta_reflects_edit_to_older_list_at_read_time).

Mirrors app/services/cascade.py's role as a service module for cross-entity
logic that doesn't belong in a single endpoints file — this function is
consumed by exactly one endpoint (GET /update-lists/{list_id}/detail in
app/api/v1/endpoints/update_tracking_lists.py) but is kept out of that file
because assembling the previous-list lookup, the full current hierarchy,
and the per-item delta math is business logic, not request/response wiring
(CLAUDE.md: "NEVER place business logic inside controllers/handlers").
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.sub_category import SubCategory
from app.models.tracking_item import TrackingItem
from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance


@dataclass
class ItemDelta:
    id: uuid.UUID
    name: str
    type: str
    order_index: int
    balance: Decimal | None
    previous_balance: Decimal | None
    delta_amount: Decimal | None
    delta_percent: Decimal | None
    has_previous_data: bool


@dataclass
class SubCategoryDetail:
    id: uuid.UUID
    name: str
    order_index: int
    items: list[ItemDelta] = field(default_factory=list)


@dataclass
class CategoryDetail:
    id: uuid.UUID
    name: str
    order_index: int
    sub_categories: list[SubCategoryDetail] = field(default_factory=list)


@dataclass
class UpdateTrackingListDetail:
    list: UpdateTrackingList
    previous_list_id: uuid.UUID | None
    categories: list[CategoryDetail]


async def get_update_list_detail(
    db: AsyncSession, *, list_id: uuid.UUID, user_id: uuid.UUID
) -> UpdateTrackingListDetail | None:
    """Assembles the full category -> sub-category -> tracking-item
    hierarchy for `list_id`'s tracking set, with each item's current
    balance, previous-list balance, and computed delta.

    Returns None (never raises) when the list doesn't exist or isn't owned
    by `user_id` — the caller (the endpoint) converts that into a bare 404,
    consistent with every other resource in this service.
    """
    # 1. Load header, confirm ownership.
    result = await db.execute(
        select(UpdateTrackingList).where(
            UpdateTrackingList.id == list_id, UpdateTrackingList.user_id == user_id
        )
    )
    current_list = result.scalar_one_or_none()
    if current_list is None:
        return None

    # 2. Find the previous list (same tracking set, strictly earlier).
    previous_list = await _find_previous_list(db, current_list)

    # 3. Previous list's balances, keyed by tracking_item_id. Absent list,
    # absent row, and row.balance IS NULL all collapse to "no previous data"
    # via a plain dict .get() returning None.
    previous_balances: dict[uuid.UUID, Decimal | None] = {}
    if previous_list is not None:
        prev_result = await db.execute(
            select(UpdateTrackingListBalance).where(
                UpdateTrackingListBalance.update_tracking_list_id == previous_list.id
            )
        )
        for row in prev_result.scalars().all():
            previous_balances[row.tracking_item_id] = row.balance

    # 4. Full CURRENT hierarchy for the tracking set — every item must
    # appear even if it has no balance row on this list (e.g. added to the
    # set after this list was created).
    cat_result = await db.execute(
        select(Category)
        .where(Category.tracking_set_id == current_list.tracking_set_id)
        .order_by(Category.order_index.asc())
    )
    categories = list(cat_result.scalars().all())

    sub_categories: list[SubCategory] = []
    if categories:
        sub_result = await db.execute(
            select(SubCategory)
            .where(SubCategory.category_id.in_([c.id for c in categories]))
            .order_by(SubCategory.order_index.asc())
        )
        sub_categories = list(sub_result.scalars().all())

    items: list[TrackingItem] = []
    if sub_categories:
        item_result = await db.execute(
            select(TrackingItem)
            .where(TrackingItem.sub_category_id.in_([s.id for s in sub_categories]))
            .order_by(TrackingItem.order_index.asc())
        )
        items = list(item_result.scalars().all())

    # 5. CURRENT list's balances, keyed by tracking_item_id.
    current_result = await db.execute(
        select(UpdateTrackingListBalance).where(
            UpdateTrackingListBalance.update_tracking_list_id == current_list.id
        )
    )
    current_balances: dict[uuid.UUID, Decimal | None] = {
        row.tracking_item_id: row.balance for row in current_result.scalars().all()
    }

    # 6. Assemble hierarchy with per-item deltas.
    items_by_sub: dict[uuid.UUID, list[TrackingItem]] = {}
    for it in items:
        items_by_sub.setdefault(it.sub_category_id, []).append(it)

    subs_by_cat: dict[uuid.UUID, list[SubCategory]] = {}
    for sub in sub_categories:
        subs_by_cat.setdefault(sub.category_id, []).append(sub)

    category_details: list[CategoryDetail] = []
    for cat in categories:
        sub_details: list[SubCategoryDetail] = []
        for sub in subs_by_cat.get(cat.id, []):
            item_deltas = [
                _compute_item_delta(it, current_balances, previous_balances)
                for it in items_by_sub.get(sub.id, [])
            ]
            sub_details.append(
                SubCategoryDetail(
                    id=sub.id, name=sub.name, order_index=sub.order_index, items=item_deltas
                )
            )
        category_details.append(
            CategoryDetail(
                id=cat.id, name=cat.name, order_index=cat.order_index, sub_categories=sub_details
            )
        )

    return UpdateTrackingListDetail(
        list=current_list,
        previous_list_id=previous_list.id if previous_list is not None else None,
        categories=category_details,
    )


def _compute_item_delta(
    item: TrackingItem,
    current_balances: dict[uuid.UUID, Decimal | None],
    previous_balances: dict[uuid.UUID, Decimal | None],
) -> ItemDelta:
    balance = current_balances.get(item.id)
    previous_balance = previous_balances.get(item.id)
    has_previous_data = previous_balance is not None

    delta_amount: Decimal | None = None
    if balance is not None and previous_balance is not None:
        delta_amount = balance - previous_balance

    # Avoid ZeroDivisionError: a zero previous balance always yields
    # delta_percent=None, even when delta_amount is computable.
    delta_percent: Decimal | None = None
    if delta_amount is not None and previous_balance is not None and previous_balance != 0:
        delta_percent = (delta_amount / previous_balance) * 100

    return ItemDelta(
        id=item.id,
        name=item.name,
        type=item.type,
        order_index=item.order_index,
        balance=balance,
        previous_balance=previous_balance,
        delta_amount=delta_amount,
        delta_percent=delta_percent,
        has_previous_data=has_previous_data,
    )


async def _find_previous_list(
    db: AsyncSession, current_list: UpdateTrackingList
) -> UpdateTrackingList | None:
    """The row in the same tracking set with the greatest
    (transaction_date, created_at, id) tuple strictly less than the current
    list's own tuple.

    All three fields are compared together as a single ordered tuple, not
    "greatest date" alone — so two lists on the same date are correctly
    ordered by created_at, and two lists with the same date AND created_at
    (a legitimate possibility: no DB-level uniqueness constraint forbids
    duplicate dates) fall back to id as the final, deterministic tiebreak.
    Expressed as an explicit OR-of-ANDs rather than SQLAlchemy's `tuple_()`
    row-comparison helper, to avoid relying on composite ROW() comparison
    semantics that could vary across dialects/drivers.
    """
    strictly_before = or_(
        UpdateTrackingList.transaction_date < current_list.transaction_date,
        and_(
            UpdateTrackingList.transaction_date == current_list.transaction_date,
            UpdateTrackingList.created_at < current_list.created_at,
        ),
        and_(
            UpdateTrackingList.transaction_date == current_list.transaction_date,
            UpdateTrackingList.created_at == current_list.created_at,
            UpdateTrackingList.id < current_list.id,
        ),
    )
    result = await db.execute(
        select(UpdateTrackingList)
        .where(
            UpdateTrackingList.tracking_set_id == current_list.tracking_set_id,
            UpdateTrackingList.id != current_list.id,
            strictly_before,
        )
        .order_by(
            UpdateTrackingList.transaction_date.desc(),
            UpdateTrackingList.created_at.desc(),
            UpdateTrackingList.id.desc(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()
