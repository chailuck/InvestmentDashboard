"""Read-time aggregation for the Dashboard "profit vs original investment"
rollup — one row per tracking item that has `initial_investment_tracking`
enabled, comparing the signed sum of its ledger entries (its *net original
investment*) against its most-recent recorded balance (its *current value*).

Mirrors `app/services/dashboard_balance_grid.py`'s role and posture: this is
a cross-entity read-time view, so it lives in a service module rather than
in `app/api/v1/endpoints/dashboard.py` (CLAUDE.md: "NEVER place business
logic inside controllers/handlers"). Nothing is stored — every call
recomputes from the current entries and balance snapshots, so editing either
immediately changes what this reports. The profit / profit-% formula itself
is NOT re-implemented here; it is delegated wholesale to
`app/services/profit_math.py::compute_profit`.

Query budget — a fixed ceiling, no query inside any per-item / per-slot loop:
  1. (caller) ownership check on the TrackingSet
  2. every UpdateTrackingList row for the set (via get_balance_grid)
  3. balances for the winning lists           (via get_balance_grid)
  4. Category rows for the set                 (via get_balance_grid)
  5. SubCategory rows for those categories     (via get_balance_grid)
  6. TrackingItem rows for those sub-categories(via get_balance_grid)
  7. Query A — the in-scope tracking-item ids (`initial_investment_tracking`
     = true) under this set's sub-categories
  8. Query B — every ft_initial_investment_entry row for those ids in ONE
     query; signed amounts are summed per item in Python
Queries 3, 5, 6 and 8 are skipped when their scope is empty — identical
conditional-skip behaviour to `dashboard_balance_grid.py` — so a
fully-populated set costs 8 and a sparse one costs fewer.

`exclusive` items are excluded entirely (not in `items`, not in the coverage
`total_count`, not in `totals`) — the same rule the balance grid's rollups
apply.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.initial_investment_entry import InitialInvestmentEntry
from app.models.tracking_item import TrackingItem
from app.services.dashboard_balance_grid import (
    CurrentValue,
    ItemRow,
    current_value_by_item,
    get_balance_grid,
)
from app.services.profit_math import compute_profit

# ── Result dataclasses (wire-shaped; mapped to CamelModel in the endpoint) ──


@dataclass(frozen=True)
class RollupItem:
    item_id: uuid.UUID
    item_name: str
    category_name: str
    sub_category_name: str
    net_original_investment: Decimal | None
    current_value: Decimal | None
    current_value_slot: CurrentValue | None
    profit: Decimal | None
    profit_percent: Decimal | None
    is_covered: bool


@dataclass(frozen=True)
class RollupCoverage:
    shown_count: int  # items with is_covered True
    total_count: int  # in-scope non-exclusive items (M)
    excluded_item_names: list[str]  # in-scope items where is_covered is False


@dataclass(frozen=True)
class RollupTotals:
    net_original_investment: Decimal | None
    current_value: Decimal | None
    profit: Decimal | None
    profit_percent: Decimal | None


@dataclass(frozen=True)
class OriginalInvestmentRollupResult:
    tracking_set_id: uuid.UUID
    generated_at: str  # ISO-8601 UTC
    coverage: RollupCoverage
    items: list[RollupItem]
    totals: RollupTotals


async def get_original_investment_rollup(
    db: AsyncSession, *, tracking_set_id: uuid.UUID, user_id: uuid.UUID
) -> OriginalInvestmentRollupResult:
    """Ownership must already have been checked by the caller (the endpoint,
    via `_get_set_or_404`) — this trusts `tracking_set_id` unconditionally,
    the same division of responsibility as `get_balance_grid`. `user_id` is
    passed through purely as a redundant, defence-in-depth filter on the two
    queries this function issues itself."""

    grid = await get_balance_grid(db, tracking_set_id=tracking_set_id)
    cv_by_item = current_value_by_item(grid)

    # Flatten the grid tree (already ordered by order_index at every tier)
    # into an ordered (category_name, sub_name, ItemRow) list, and collect
    # the sub-category ids for Query A.
    ordered_items: list[tuple[str, str, ItemRow]] = []
    sub_ids: list[uuid.UUID] = []
    for cat in grid.categories:
        for sub in cat.sub_categories:
            sub_ids.append(sub.id)
            for item in sub.items:
                ordered_items.append((cat.name, sub.name, item))

    # Query A — in-scope ids: items with the flag on. The redundant
    # user_id filter is defence in depth (the set was already ownership-checked).
    in_scope_ids: set[uuid.UUID] = set()
    if sub_ids:
        rows_a = await db.execute(
            select(TrackingItem.id).where(
                TrackingItem.sub_category_id.in_(sub_ids),
                TrackingItem.initial_investment_tracking.is_(True),
                TrackingItem.user_id == user_id,
            )
        )
        in_scope_ids = {row[0] for row in rows_a.all()}

    # M — in-scope AND non-exclusive, kept in grid (display) order.
    m_items = [
        (cat_name, sub_name, item)
        for (cat_name, sub_name, item) in ordered_items
        if item.id in in_scope_ids and not item.exclusive
    ]
    m_ids = [item.id for (_, _, item) in m_items]

    # Query B — every entry for the M ids in ONE query; sum signed per item.
    net_by_item: dict[uuid.UUID, Decimal] = {}
    if m_ids:
        rows_b = await db.execute(
            select(InitialInvestmentEntry).where(
                InitialInvestmentEntry.tracking_item_id.in_(m_ids),
                InitialInvestmentEntry.user_id == user_id,
            )
        )
        for entry in rows_b.scalars().all():
            net_by_item[entry.tracking_item_id] = (
                net_by_item.get(entry.tracking_item_id, Decimal("0")) + entry.amount
            )

    items_out: list[RollupItem] = []
    covered_net: list[Decimal] = []
    covered_cv: list[Decimal] = []
    excluded_names: list[str] = []

    for cat_name, sub_name, item in m_items:
        net = net_by_item[item.id] if item.id in net_by_item else None
        cv = cv_by_item.get(item.id)
        figs = compute_profit(
            net_original_investment=net,
            current_value=(cv.value if cv is not None else None),
        )
        items_out.append(
            RollupItem(
                item_id=item.id,
                item_name=item.name,
                category_name=cat_name,
                sub_category_name=sub_name,
                net_original_investment=figs.net_original_investment,
                current_value=figs.current_value,
                current_value_slot=cv,
                profit=figs.profit,
                profit_percent=figs.profit_percent,
                is_covered=figs.is_covered,
            )
        )
        if figs.is_covered:
            # is_covered guarantees both are non-None.
            covered_net.append(net)  # type: ignore[arg-type]
            covered_cv.append(cv.value)  # type: ignore[union-attr]
        else:
            excluded_names.append(item.name)

    shown_count = len(covered_net)
    if shown_count == 0:
        totals_figs = compute_profit(net_original_investment=None, current_value=None)
    else:
        totals_figs = compute_profit(
            net_original_investment=sum(covered_net, Decimal("0")),
            current_value=sum(covered_cv, Decimal("0")),
        )

    return OriginalInvestmentRollupResult(
        tracking_set_id=tracking_set_id,
        generated_at=datetime.now(timezone.utc).isoformat(),
        coverage=RollupCoverage(
            shown_count=shown_count,
            total_count=len(m_items),
            excluded_item_names=excluded_names,
        ),
        items=items_out,
        totals=RollupTotals(
            net_original_investment=totals_figs.net_original_investment,
            current_value=totals_figs.current_value,
            profit=totals_figs.profit,
            profit_percent=totals_figs.profit_percent,
        ),
    )
