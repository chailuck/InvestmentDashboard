from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, CamelRequestModel


def _validate_nonzero(v: Decimal) -> Decimal:
    if v == 0:
        raise ValueError("amount must not be zero (positive = increase, negative = decrease)")
    return v


class EntryCreate(CamelRequestModel):
    amount: Decimal
    entry_date: date

    _validate_amount = field_validator("amount")(_validate_nonzero)


class EntryUpdate(CamelRequestModel):
    amount: Decimal | None = None
    entry_date: date | None = None

    @field_validator("amount")
    @classmethod
    def _validate_amount_optional(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        return _validate_nonzero(v)


class EntryOut(CamelModel):
    id: uuid.UUID
    tracking_item_id: uuid.UUID
    amount: Decimal
    entry_date: date
    created_at: datetime
    updated_at: datetime


class RunningTotalRow(CamelModel):
    id: uuid.UUID
    entry_date: date
    amount: Decimal
    running_total: Decimal


class RunningTotalOut(CamelModel):
    item_id: uuid.UUID
    current_total: Decimal
    entries: list[RunningTotalRow]
