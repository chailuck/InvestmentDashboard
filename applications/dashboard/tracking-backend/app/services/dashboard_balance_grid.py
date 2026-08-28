"""Read-time aggregation for the Dashboard quarterly/yearly balance-grid view
(Phase 3 of the Financial Tracker).

Mirrors `app/services/update_tracking.py`'s role: this is business logic that
assembles a cross-entity view of the tracking-set hierarchy, so it lives in
its own service module rather than inside
`app/api/v1/endpoints/dashboard.py` (CLAUDE.md: "NEVER place business logic
inside controllers/handlers").

Nothing here is stored — every call recomputes the entire grid, including
every delta, from the current `UpdateTrackingList` / `UpdateTrackingListBalance`
rows, so editing history immediately changes what this endpoint reports.

Performance: exactly 6 queries regardless of how many years/quarters/items
exist for the set —
  1. (caller) ownership check on the TrackingSet
  2. every UpdateTrackingList row for the set with year AND quarter set
  3. every UpdateTrackingListBalance row for the winning lists from #2
  4. Category rows for the set
  5. SubCategory rows for those categories
  6. TrackingItem rows for those sub-categories
No query is issued inside a per-item, per-slot, or per-tier loop — all
grouping, winner selection, summation, and delta computation happens
in-memory in Python against data already loaded above.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.sub_category import SubCategory
from app.models.tracking_item import TrackingItem
from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance

# A "slot" is a (year, quarter) pair — the atomic column of the grid.
Slot = tuple[int, int]


def _slot_sort_key(slot: Slot) -> int:
    """Ascending chronological ordering for delta computation — separate
    from the descending-by-year DISPLAY order built in `get_balance_grid`."""
    year, quarter = slot
    return year * 4 + quarter


# ── Generic series-delta engine ─────────────────────────────────────────────


@dataclass(frozen=True)
class CellMath:
    """The computed math for one populated-or-blank slot in a single series
    (an item's own balances, or a rollup tier's summed balances). Carries no
    year/quarter — those are supplied positionally by the caller when this is
    materialized against the display slot order."""

    balance: Decimal | None
    delta_amount: Decimal | None
    delta_percent: Decimal | None
    has_data: bool
    has_previous_data: bool


_BLANK_CELL_MATH = CellMath(
    balance=None, delta_amount=None, delta_percent=None, has_data=False, has_previous_data=False
)


def compute_series_deltas(
    values_by_slot: dict[Slot, Decimal],
    ascending_slots: list[Slot],
) -> dict[Slot, CellMath]:
    """The ONE delta engine reused for every row and every rollup tier in the
    grid (items, sub-category subtotals, category subtotals, grand total,
    property/non-property breakdown) — see module docstring.

    `values_by_slot` carries ONLY populated slots for this series; a slot's
    absence means "blank" regardless of why (no winning list that quarter, or
    a winning list with no value for this series). `ascending_slots` is the
    full ordered set of slots to walk — every slot present in the tracking
    set's data, oldest first, so a delta can look arbitrarily far back for
    its comparison point without an extra query.

    For each slot, in ascending order:
      - not in `values_by_slot` -> blank cell; `last_seen` is NOT advanced,
        so a later populated slot still diffs against the last REAL value.
      - in `values_by_slot` -> balance is that value; delta_amount is
        `balance - last_seen` when a previous value exists (else None,
        never 0 — a first data point has no delta, not a zero delta);
        delta_percent is `delta_amount / last_seen * 100` unless last_seen
        is None or exactly zero (avoids ZeroDivisionError and a meaningless
        infinite percentage); `last_seen` becomes `balance` for the next slot.
    """
    result: dict[Slot, CellMath] = {}
    last_seen: Decimal | None = None
    for slot in ascending_slots:
        if slot not in values_by_slot:
            result[slot] = _BLANK_CELL_MATH
            continue

        balance = values_by_slot[slot]
        has_previous_data = last_seen is not None

        delta_amount: Decimal | None = None
        delta_percent: Decimal | None = None
        if last_seen is not None:
            delta_amount = balance - last_seen
            if last_seen != 0:
                delta_percent = (delta_amount / last_seen) * 100

        result[slot] = CellMath(
            balance=balance,
            delta_amount=delta_amount,
            delta_percent=delta_percent,
            has_data=True,
            has_previous_data=has_previous_data,
        )
        last_seen = balance

    return result


def _rollup_values(
    items_subset: list[TrackingItem],
    ascending_slots: list[Slot],
    item_values_by_id: dict[uuid.UUID, dict[Slot, Decimal]],
) -> dict[Slot, Decimal]:
    """Sums `items_subset`'s populated values for each slot, contributing
    only the items that actually have data that slot ("at least one
    populated" rule) — a subtotal must not vanish just because one item in
    the group has no history yet. A slot with zero contributing items is
    left absent from the result (blank), not zero."""
    result: dict[Slot, Decimal] = {}
    for slot in ascending_slots:
        total: Decimal | None = None
        for item in items_subset:
            value = item_values_by_id[item.id].get(slot)
            if value is not None:
                total = value if total is None else total + value
        if total is not None:
            result[slot] = total
    return result


# ── Wire-shaped result dataclasses (one field per BalanceCell field) ────────


@dataclass(frozen=True)
class Cell:
    """A fully positioned grid cell — the exact shape of the `BalanceCell`
    response schema, built by materializing a `CellMath` series against the
    grid's display slot order."""

    year: int
    quarter: int
    balance: Decimal | None
    delta_amount: Decimal | None
    delta_percent: Decimal | None
    has_data: bool
    has_previous_data: bool


def _materialize(series: dict[Slot, CellMath], display_slots: list[Slot]) -> list[Cell]:
    cells: list[Cell] = []
    for year, quarter in display_slots:
        math = series.get((year, quarter), _BLANK_CELL_MATH)
        cells.append(
            Cell(
                year=year,
                quarter=quarter,
                balance=math.balance,
                delta_amount=math.delta_amount,
                delta_percent=math.delta_percent,
                has_data=math.has_data,
                has_previous_data=math.has_previous_data,
            )
        )
    return cells


@dataclass
class ItemRow:
    id: uuid.UUID
    name: str
    type: str
    order_index: int
    exclusive: bool
    cells: list[Cell] = field(default_factory=list)


@dataclass
class SubCategoryRow:
    id: uuid.UUID
    name: str
    order_index: int
    items: list[ItemRow] = field(default_factory=list)
    subtotal: list[Cell] = field(default_factory=list)


@dataclass
class CategoryRow:
    id: uuid.UUID
    name: str
    order_index: int
    sub_categories: list[SubCategoryRow] = field(default_factory=list)
    subtotal: list[Cell] = field(default_factory=list)


@dataclass
class PropertyBreakdown:
    property_total: list[Cell]
    non_property_total: list[Cell]


@dataclass
class BalanceGridResult:
    tracking_set_id: uuid.UUID
    years: list[int]  # DESCENDING
    categories: list[CategoryRow]
    grand_total: list[Cell]
    property_breakdown: PropertyBreakdown


# ── Main assembly ────────────────────────────────────────────────────────────


async def get_balance_grid(db: AsyncSession, *, tracking_set_id: uuid.UUID) -> BalanceGridResult:
    """Assembles the full balance grid for `tracking_set_id`. Ownership must
    already have been checked by the caller (the endpoint, via
    `_get_set_or_404`) — this function trusts `tracking_set_id` unconditionally,
    the same division of responsibility as `get_update_list_detail` trusts a
    pre-validated `list_id` internally after its own ownership check."""

    # 1. Every UpdateTrackingList row for this set with BOTH year and quarter
    # set — rows missing either are excluded from this report entirely (not
    # an error, just no column to place them in).
    list_result = await db.execute(
        select(UpdateTrackingList).where(
            UpdateTrackingList.tracking_set_id == tracking_set_id,
            UpdateTrackingList.year.is_not(None),
            UpdateTrackingList.quarter.is_not(None),
        )
    )
    valid_lists = list(list_result.scalars().all())

    # 2. Group by (year, quarter); the winner per slot is the
    # most-recently-created row, id descending as the final tiebreak. This is
    # done in Python since all candidate rows are already loaded — NOT a
    # second query per group.
    groups: dict[Slot, list[UpdateTrackingList]] = {}
    for lst in valid_lists:
        groups.setdefault((lst.year, lst.quarter), []).append(lst)  # type: ignore[arg-type]

    winner_by_slot: dict[Slot, UpdateTrackingList] = {
        slot: sorted(rows, key=lambda item: (item.created_at, item.id), reverse=True)[0]
        for slot, rows in groups.items()
    }

    # 3. Balances for the winning lists only.
    balance_by_list_and_item: dict[uuid.UUID, dict[uuid.UUID, Decimal]] = {}
    if winner_by_slot:
        winner_ids = [lst.id for lst in winner_by_slot.values()]
        balance_result = await db.execute(
            select(UpdateTrackingListBalance).where(
                UpdateTrackingListBalance.update_tracking_list_id.in_(winner_ids)
            )
        )
        for row in balance_result.scalars().all():
            if row.balance is not None:
                balance_by_list_and_item.setdefault(row.update_tracking_list_id, {})[
                    row.tracking_item_id
                ] = row.balance

    # 4-6. Full CURRENT hierarchy for the set, identical query shape to
    # `update_tracking.py` — every item must appear even with zero data.
    cat_result = await db.execute(
        select(Category)
        .where(Category.tracking_set_id == tracking_set_id)
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

    # ── In-memory assembly (zero further queries below this line) ──────────

    ascending_slots = sorted(winner_by_slot.keys(), key=_slot_sort_key)
    distinct_years = sorted({slot[0] for slot in winner_by_slot}, reverse=True)
    display_slots: list[Slot] = [(year, q) for year in distinct_years for q in (1, 2, 3, 4)]

    # Each item's own populated values, keyed by slot — the base data every
    # rollup tier sums over.
    item_values_by_id: dict[uuid.UUID, dict[Slot, Decimal]] = {}
    for it in items:
        values: dict[Slot, Decimal] = {}
        for slot, winning_list in winner_by_slot.items():
            balance = balance_by_list_and_item.get(winning_list.id, {}).get(it.id)
            if balance is not None:
                values[slot] = balance
        item_values_by_id[it.id] = values

    items_by_sub: dict[uuid.UUID, list[TrackingItem]] = {}
    for it in items:
        items_by_sub.setdefault(it.sub_category_id, []).append(it)

    item_rows_by_sub: dict[uuid.UUID, list[ItemRow]] = {}
    for it in items:
        series = compute_series_deltas(item_values_by_id[it.id], ascending_slots)
        item_rows_by_sub.setdefault(it.sub_category_id, []).append(
            ItemRow(
                id=it.id,
                name=it.name,
                type=it.type,
                order_index=it.order_index,
                exclusive=it.exclusive,
                cells=_materialize(series, display_slots),
            )
        )

    subs_by_cat: dict[uuid.UUID, list[SubCategory]] = {}
    for sub in sub_categories:
        subs_by_cat.setdefault(sub.category_id, []).append(sub)

    category_rows: list[CategoryRow] = []
    for cat in categories:
        sub_rows: list[SubCategoryRow] = []
        # Category subtotal sums directly over ALL of the category's
        # non-exclusive LEAF items (not by re-summing sub-category subtotal
        # cells), so the "at least one populated" rule is applied once, at
        # the leaf-item level, rather than compounding across two
        # granularities.
        cat_non_exclusive_items: list[TrackingItem] = []

        for sub in subs_by_cat.get(cat.id, []):
            sub_items = items_by_sub.get(sub.id, [])
            non_exclusive_sub_items = [it for it in sub_items if not it.exclusive]
            cat_non_exclusive_items.extend(non_exclusive_sub_items)

            sub_values = _rollup_values(non_exclusive_sub_items, ascending_slots, item_values_by_id)
            sub_series = compute_series_deltas(sub_values, ascending_slots)
            sub_rows.append(
                SubCategoryRow(
                    id=sub.id,
                    name=sub.name,
                    order_index=sub.order_index,
                    items=item_rows_by_sub.get(sub.id, []),
                    subtotal=_materialize(sub_series, display_slots),
                )
            )

        cat_values = _rollup_values(cat_non_exclusive_items, ascending_slots, item_values_by_id)
        cat_series = compute_series_deltas(cat_values, ascending_slots)
        category_rows.append(
            CategoryRow(
                id=cat.id,
                name=cat.name,
                order_index=cat.order_index,
                sub_categories=sub_rows,
                subtotal=_materialize(cat_series, display_slots),
            )
        )

    # Grand total and the property/non-property breakdown both partition ALL
    # non-exclusive items in the entire set — zero extra queries, the same
    # in-memory `items` list re-partitioned by a different predicate.
    all_non_exclusive_items = [it for it in items if not it.exclusive]

    grand_values = _rollup_values(all_non_exclusive_items, ascending_slots, item_values_by_id)
    grand_total = _materialize(compute_series_deltas(grand_values, ascending_slots), display_slots)

    property_items = [it for it in all_non_exclusive_items if it.type == "Property"]
    non_property_items = [it for it in all_non_exclusive_items if it.type != "Property"]

    property_values = _rollup_values(property_items, ascending_slots, item_values_by_id)
    non_property_values = _rollup_values(non_property_items, ascending_slots, item_values_by_id)
    property_breakdown = PropertyBreakdown(
        property_total=_materialize(
            compute_series_deltas(property_values, ascending_slots), display_slots
        ),
        non_property_total=_materialize(
            compute_series_deltas(non_property_values, ascending_slots), display_slots
        ),
    )

    return BalanceGridResult(
        tracking_set_id=tracking_set_id,
        years=distinct_years,
        categories=category_rows,
        grand_total=grand_total,
        property_breakdown=property_breakdown,
    )
