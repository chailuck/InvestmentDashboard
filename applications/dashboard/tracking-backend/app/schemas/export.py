"""Export schemas — Financial Tracker: a full, restorable snapshot of one
Tracking Set (`GET /sets/{set_id}/export`).

Field lists below were verified directly against the current SQLAlchemy
models (`app/models/*.py`) rather than trusted from the architectural draft
— every field name, type, and nullability here matches its model 1:1. No
deviations were found; in particular `TrackingItem.remark`/`account_name`
and `InitialInvestmentEntry.amount`/`entry_date` all exist exactly as drafted.

`TrackingSetExport` deliberately OMITS `user_id`: this payload is meant to be
re-importable later (a restore/import endpoint is a natural follow-up), and a
client-supplied `user_id` in that flow would let one account claim rows that
originally belonged to another — restoring must always target the caller's
own account, never a value read back out of the export.

`order_index` (not the `order` alias `CategoryOut`/`SubCategoryOut`/
`TrackingItemOut` use for their CRUD responses elsewhere in this service) is
used verbatim here, matching the precedent already set by
`UpdateTrackingListDetailItem` in `app/schemas/update_tracking_list.py` for
this same reason: this is a distinct, purpose-built composite (a full-fidelity
export/restore snapshot), not a CRUD response, so it is not bound to the CRUD
schemas' `order` aliasing convention.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from app.schemas.common import CamelModel

EXPORT_VERSION = 1


class TrackingSetExport(CamelModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class CategoryExport(CamelModel):
    id: uuid.UUID
    tracking_set_id: uuid.UUID
    name: str
    description: str | None
    order_index: int
    created_at: datetime
    updated_at: datetime


class SubCategoryExport(CamelModel):
    id: uuid.UUID
    category_id: uuid.UUID
    name: str
    description: str | None
    order_index: int
    created_at: datetime
    updated_at: datetime


class TrackingItemExport(CamelModel):
    id: uuid.UUID
    sub_category_id: uuid.UUID
    name: str
    type: str
    initial_investment_tracking: bool
    exclusive: bool
    order_index: int
    description: str | None
    account_name: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime


class UpdateTrackingListExport(CamelModel):
    id: uuid.UUID
    tracking_set_id: uuid.UUID
    transaction_date: date
    quarter: int | None
    year: int | None
    created_at: datetime
    updated_at: datetime


class UpdateTrackingListBalanceExport(CamelModel):
    id: uuid.UUID
    update_tracking_list_id: uuid.UUID
    tracking_item_id: uuid.UUID
    balance: Decimal | None
    created_at: datetime
    updated_at: datetime


class InitialInvestmentEntryExport(CamelModel):
    id: uuid.UUID
    tracking_item_id: uuid.UUID
    amount: Decimal
    entry_date: date
    created_at: datetime
    updated_at: datetime


class TrackingExportOut(CamelModel):
    export_version: int
    exported_at: str  # ISO8601 UTC, e.g. "2026-08-29T12:00:00+00:00"
    tracking_set: TrackingSetExport
    categories: list[CategoryExport]
    sub_categories: list[SubCategoryExport]
    tracking_items: list[TrackingItemExport]
    update_tracking_lists: list[UpdateTrackingListExport]
    update_tracking_list_balances: list[UpdateTrackingListBalanceExport]
    initial_investment_entries: list[InitialInvestmentEntryExport]
