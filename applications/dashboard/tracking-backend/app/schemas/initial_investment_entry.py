from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, CamelRequestModel

_NOTE_MAX = 500
_LABEL_MAX = 100  # `code` / `name` free-text labels


def _validate_nonzero(v: Decimal) -> Decimal:
    if v == 0:
        raise ValueError("amount must not be zero (positive = increase, negative = decrease)")
    return v


def _coerce_blank(v: str | None) -> str | None:
    """A missing value and a whitespace-only value both mean "absent" -> NULL.
    Anything else is stored verbatim — no trimming, no normalisation — so
    Thai text, leading/trailing spaces that are meaningful, and multi-line
    content all round-trip unchanged.

    Shared by `note`, and by the `code` / `name` labels added for the BOND
    register feature. `_coerce_blank_note` is kept as a backwards-compatible
    alias for any external importer.
    """
    if v is None:
        return None
    return None if v.strip() == "" else v


# Backwards-compatible alias (previous name of `_coerce_blank`).
_coerce_blank_note = _coerce_blank


class EntryCreate(CamelRequestModel):
    amount: Decimal
    entry_date: date
    note: str | None = Field(default=None, max_length=_NOTE_MAX)
    code: str | None = Field(default=None, max_length=_LABEL_MAX)
    name: str | None = Field(default=None, max_length=_LABEL_MAX)

    _validate_amount = field_validator("amount")(_validate_nonzero)
    _clean_note = field_validator("note")(_coerce_blank)
    _clean_code = field_validator("code")(_coerce_blank)
    _clean_name = field_validator("name")(_coerce_blank)


class EntryUpdate(CamelRequestModel):
    amount: Decimal | None = None
    entry_date: date | None = None
    note: str | None = Field(default=None, max_length=_NOTE_MAX)
    code: str | None = Field(default=None, max_length=_LABEL_MAX)
    name: str | None = Field(default=None, max_length=_LABEL_MAX)

    @field_validator("amount")
    @classmethod
    def _validate_amount_optional(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        return _validate_nonzero(v)

    _clean_note = field_validator("note")(_coerce_blank)
    _clean_code = field_validator("code")(_coerce_blank)
    _clean_name = field_validator("name")(_coerce_blank)


class EntryOut(CamelModel):
    id: uuid.UUID
    tracking_item_id: uuid.UUID
    amount: Decimal
    entry_date: date
    note: str | None
    code: str | None
    name: str | None
    created_at: datetime
    updated_at: datetime


class RunningTotalRow(CamelModel):
    id: uuid.UUID
    entry_date: date
    amount: Decimal
    running_total: Decimal
    note: str | None
    code: str | None
    name: str | None


class CurrentValueSlot(CamelModel):
    """The (year, quarter) grid slot a `currentValue` figure was read from —
    the most-recent populated balance slot for that tracking item."""

    year: int
    quarter: int


class ProfitVsOriginalOut(CamelModel):
    """Read-time "profit vs original investment" figures for a single item.
    Always present on `RunningTotalOut`; every inner field is null when the
    underlying data is absent (no entries, or no balance snapshot)."""

    net_original_investment: Decimal | None
    current_value: Decimal | None
    current_value_slot: CurrentValueSlot | None
    profit: Decimal | None
    profit_percent: Decimal | None
    is_covered: bool


class RunningTotalOut(CamelModel):
    item_id: uuid.UUID
    current_total: Decimal
    entries: list[RunningTotalRow]
    profit_vs_original: ProfitVsOriginalOut
