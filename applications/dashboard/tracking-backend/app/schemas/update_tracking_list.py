from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field

from app.schemas.common import CamelModel, CamelRequestModel

# ── Header ────────────────────────────────────────────────────────────────────


class UpdateTrackingListCreate(CamelRequestModel):
    transaction_date: date
    quarter: int | None = Field(default=None, ge=1, le=4)
    year: int | None = Field(default=None, ge=2000, le=2100)


class UpdateTrackingListUpdate(CamelRequestModel):
    transaction_date: date | None = None
    quarter: int | None = Field(default=None, ge=1, le=4)
    year: int | None = Field(default=None, ge=2000, le=2100)


class UpdateTrackingListOut(CamelModel):
    id: uuid.UUID
    tracking_set_id: uuid.UUID
    transaction_date: date
    quarter: int | None
    year: int | None
    created_at: datetime
    updated_at: datetime


# ── Balances ──────────────────────────────────────────────────────────────────


class BalanceUpsertItem(CamelRequestModel):
    tracking_item_id: uuid.UUID
    # Explicit null clears an existing balance; the field may also be
    # omitted entirely from the JSON object, which is treated the same way
    # (both mean "no value" — the default below covers the omitted case).
    balance: Decimal | None = None


class BalanceUpsertRequest(CamelRequestModel):
    balances: list[BalanceUpsertItem]


class UpdateTrackingListBalanceOut(CamelModel):
    id: uuid.UUID
    update_tracking_list_id: uuid.UUID
    tracking_item_id: uuid.UUID
    balance: Decimal | None
    created_at: datetime
    updated_at: datetime


# ── Detail: full hierarchy + read-time deltas ────────────────────────────────
#
# NOTE: `orderIndex` (not the `order` alias TrackingItemOut/CategoryOut/
# SubCategoryOut use elsewhere in this service) — the approved API contract
# for this specific composite explicitly names the field `orderIndex`, so
# these DTOs deliberately do NOT reuse the `order`-aliased `order_index`
# pattern from app/schemas/{category,sub_category,tracking_item}.py.


class UpdateTrackingListDetailItem(CamelModel):
    id: uuid.UUID
    name: str
    type: str
    order_index: int
    balance: Decimal | None
    previous_balance: Decimal | None
    delta_amount: Decimal | None
    delta_percent: Decimal | None
    has_previous_data: bool


class UpdateTrackingListDetailSubCategory(CamelModel):
    id: uuid.UUID
    name: str
    order_index: int
    items: list[UpdateTrackingListDetailItem]


class UpdateTrackingListDetailCategory(CamelModel):
    id: uuid.UUID
    name: str
    order_index: int
    sub_categories: list[UpdateTrackingListDetailSubCategory]


class UpdateTrackingListDetailOut(CamelModel):
    list: UpdateTrackingListOut
    previous_list_id: uuid.UUID | None
    categories: list[UpdateTrackingListDetailCategory]
