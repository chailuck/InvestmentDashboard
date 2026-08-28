"""Dashboard endpoints — Phase 3 of the Financial Tracker: response schemas
for the read-only quarterly/yearly balance-grid rollup.

There is no request body (GET, no query params beyond the path's `set_id`),
so this module carries outbound (`CamelModel`) schemas only — no
`CamelRequestModel` counterpart, unlike `app/schemas/update_tracking_list.py`.

Positional-alignment contract (enforced by the service layer, not by these
schemas): every `cells` / `subtotal` / `grand_total` / `property_total` /
`non_property_total` array has exactly `len(years) * 4` entries, ordered by
iterating `years` (already descending) top-to-bottom and, for each year,
iterating quarters `[1, 2, 3, 4]` ascending. A blank quarter is still a
present entry (`has_data=False`, `balance=None`, ...), never omitted.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.schemas.common import CamelModel


class BalanceCell(CamelModel):
    year: int
    quarter: int  # 1..4
    balance: Decimal | None
    delta_amount: Decimal | None
    delta_percent: Decimal | None
    has_data: bool  # this exact (year, quarter) has a real value for this row
    has_previous_data: bool  # a nearest-earlier populated value was found (for delta)


class DashboardYearColumn(CamelModel):
    year: int
    quarters: list[int]  # ALWAYS [1, 2, 3, 4]


class DashboardItemRow(CamelModel):
    id: uuid.UUID
    name: str
    type: str
    order_index: int
    exclusive: bool
    cells: list[BalanceCell]  # positionally aligned to the flattened years/quarters order


class DashboardSubCategoryRow(CamelModel):
    id: uuid.UUID
    name: str
    order_index: int
    items: list[DashboardItemRow]
    subtotal: list[BalanceCell]  # excludes exclusive items


class DashboardCategoryRow(CamelModel):
    id: uuid.UUID
    name: str
    order_index: int
    sub_categories: list[DashboardSubCategoryRow]
    subtotal: list[BalanceCell]  # excludes exclusive items, across all its sub-categories


class DashboardPropertyBreakdown(CamelModel):
    property_total: list[BalanceCell]  # non-exclusive items with type == "Property"
    non_property_total: list[BalanceCell]  # non-exclusive items with type != "Property"


class DashboardBalanceGridOut(CamelModel):
    tracking_set_id: uuid.UUID
    years: list[DashboardYearColumn]  # DESCENDING by year
    categories: list[DashboardCategoryRow]
    grand_total: list[BalanceCell]  # excludes exclusive items, entire set
    property_breakdown: DashboardPropertyBreakdown
