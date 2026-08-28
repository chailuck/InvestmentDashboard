"""Dashboard endpoint — Phase 3 of the Financial Tracker: a single read-only
route exposing the quarterly/yearly balance-grid rollup for a Tracking Set.

Split into its own router module (mirrors how `update_tracking_lists.py` is
kept separate from `tracking_sets.py`, and how `categories.py` nests its own
sub-resource routes): all aggregation logic lives in
`app/services/dashboard_balance_grid.py`, not here — this module only wires
the request/response, per CLAUDE.md's "NEVER place business logic inside
controllers/handlers."

Ownership: reuses `_get_set_or_404` from `update_tracking_lists.py` rather
than duplicating it — same bare-404-never-403 behavior as every other
resource in this service, so a cross-user request never distinguishes
"doesn't exist" from "exists but isn't yours."
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.update_tracking_lists import _get_set_or_404
from app.auth.dependencies import get_current_user_id
from app.database.session import get_db
from app.schemas.dashboard import (
    BalanceCell,
    DashboardBalanceGridOut,
    DashboardCategoryRow,
    DashboardItemRow,
    DashboardPropertyBreakdown,
    DashboardSubCategoryRow,
    DashboardYearColumn,
)
from app.services.dashboard_balance_grid import BalanceGridResult, Cell, get_balance_grid

router = APIRouter(tags=["Dashboard"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


def _to_cells(cells: list[Cell]) -> list[BalanceCell]:
    return [
        BalanceCell(
            year=c.year,
            quarter=c.quarter,
            balance=c.balance,
            delta_amount=c.delta_amount,
            delta_percent=c.delta_percent,
            has_data=c.has_data,
            has_previous_data=c.has_previous_data,
        )
        for c in cells
    ]


def _to_response(result: BalanceGridResult) -> DashboardBalanceGridOut:
    return DashboardBalanceGridOut(
        tracking_set_id=result.tracking_set_id,
        years=[DashboardYearColumn(year=y, quarters=[1, 2, 3, 4]) for y in result.years],
        categories=[
            DashboardCategoryRow(
                id=cat.id,
                name=cat.name,
                order_index=cat.order_index,
                sub_categories=[
                    DashboardSubCategoryRow(
                        id=sub.id,
                        name=sub.name,
                        order_index=sub.order_index,
                        items=[
                            DashboardItemRow(
                                id=it.id,
                                name=it.name,
                                type=it.type,
                                order_index=it.order_index,
                                exclusive=it.exclusive,
                                cells=_to_cells(it.cells),
                            )
                            for it in sub.items
                        ],
                        subtotal=_to_cells(sub.subtotal),
                    )
                    for sub in cat.sub_categories
                ],
                subtotal=_to_cells(cat.subtotal),
            )
            for cat in result.categories
        ],
        grand_total=_to_cells(result.grand_total),
        property_breakdown=DashboardPropertyBreakdown(
            property_total=_to_cells(result.property_breakdown.property_total),
            non_property_total=_to_cells(result.property_breakdown.non_property_total),
        ),
    )


@router.get(
    "/sets/{set_id}/dashboard/balance-grid",
    response_model=DashboardBalanceGridOut,
)
async def get_dashboard_balance_grid(
    set_id: uuid.UUID, user_id: UserId, db: DB
) -> DashboardBalanceGridOut:
    tracking_set = await _get_set_or_404(set_id, user_id, db)
    result = await get_balance_grid(db, tracking_set_id=tracking_set.id)
    return _to_response(result)
