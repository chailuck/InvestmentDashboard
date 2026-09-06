"""Pydantic v2 request / response schemas for the BOND register.

Style mirrors ``app/schemas/initial_investment_entry.py`` — camelCase wire
keys via ``CamelModel`` / ``CamelRequestModel``, ``field_validator``-based
cleaning, and presence-aware update semantics.

Key rules:
  - ``code`` is REQUIRED and must be non-blank (after ``strip()``), max 100.
    On update it may be omitted (untouched) but never set to ``null`` / blank.
  - ``issuer`` is optional, max 200, blank -> ``None``.
  - ``amount`` is a ``Decimal`` that must be ``>= 0`` (zero allowed).
  - ``start_date`` / ``expired_date`` are optional and independently
    clearable via ``null`` on update.
  - ``status`` on :class:`BondOut` is NOT a model column — the endpoint
    computes it with :func:`app.services.bond_status.compute_bond_status`
    and passes it into the constructor explicitly.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, CamelRequestModel
from app.schemas.initial_investment_entry import _coerce_blank
from app.services.bond_status import BondStatus

_CODE_MAX = 100
_ISSUER_MAX = 200


def _validate_amount_nonneg(v: Decimal) -> Decimal:
    if v < 0:
        raise ValueError("amount must be greater than or equal to 0")
    return v


def _validate_interest_rate_range(v: Decimal | None) -> Decimal | None:
    if v is None:
        return v
    if v < 0 or v > 100:
        raise ValueError("interestRate must be between 0 and 100 (inclusive)")
    return v


def _validate_code_required(v: str) -> str:
    """`code` is stored verbatim (no trimming) but must not be blank."""
    if v is None or v.strip() == "":
        raise ValueError("code must not be blank")
    return v


class BondCreate(CamelRequestModel):
    code: str = Field(max_length=_CODE_MAX)
    issuer: str | None = Field(default=None, max_length=_ISSUER_MAX)
    start_date: date | None = None
    expired_date: date | None = None
    amount: Decimal
    interest_rate: Decimal | None = None

    _validate_code = field_validator("code")(_validate_code_required)
    _clean_issuer = field_validator("issuer")(_coerce_blank)
    _validate_amount = field_validator("amount")(_validate_amount_nonneg)
    _validate_interest_rate = field_validator("interest_rate")(_validate_interest_rate_range)


class BondUpdate(CamelRequestModel):
    """All fields optional / presence-aware. An omitted key leaves the column
    untouched; an explicit ``null`` clears ``issuer`` / ``start_date`` /
    ``expired_date``. ``code`` and ``amount`` are NOT NULL at the DB layer, so
    an explicit ``null`` for either is a client error handled by the endpoint
    (422), not a clear-to-null request."""

    code: str | None = Field(default=None, max_length=_CODE_MAX)
    issuer: str | None = Field(default=None, max_length=_ISSUER_MAX)
    start_date: date | None = None
    expired_date: date | None = None
    amount: Decimal | None = None
    interest_rate: Decimal | None = None

    @field_validator("code")
    @classmethod
    def _validate_code_optional(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_code_required(v)

    _clean_issuer = field_validator("issuer")(_coerce_blank)

    @field_validator("amount")
    @classmethod
    def _validate_amount_optional(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        return _validate_amount_nonneg(v)

    @field_validator("interest_rate")
    @classmethod
    def _validate_interest_rate_optional(cls, v: Decimal | None) -> Decimal | None:
        # None passes through — an explicit `null` is a legal clear, like `issuer`.
        return _validate_interest_rate_range(v)


class BondOut(CamelModel):
    id: uuid.UUID
    tracking_item_id: uuid.UUID
    code: str
    issuer: str | None
    start_date: date | None
    expired_date: date | None
    amount: Decimal
    interest_rate: Decimal | None
    status: BondStatus
    years: int | None
    created_at: datetime
    updated_at: datetime
