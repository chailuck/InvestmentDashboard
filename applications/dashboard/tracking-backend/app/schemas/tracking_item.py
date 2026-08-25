from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.models.tracking_item import TRACKING_ITEM_TYPES
from app.schemas.common import CamelModel, CamelRequestModel


def _validate_type(v: str) -> str:
    if v not in TRACKING_ITEM_TYPES:
        raise ValueError(
            f"type must be one of {list(TRACKING_ITEM_TYPES)}, got {v!r}"
        )
    return v


class TrackingItemCreate(CamelRequestModel):
    name: str = Field(min_length=1, max_length=255)
    type: str
    initial_investment_tracking: bool = False
    exclusive: bool = False
    order: int | None = Field(default=None, ge=0)
    description: str | None = None
    account_name: str | None = Field(default=None, max_length=255)
    remark: str | None = None

    _validate_type = field_validator("type")(_validate_type)


class TrackingItemUpdate(CamelRequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    type: str | None = None
    initial_investment_tracking: bool | None = None
    exclusive: bool | None = None
    order: int | None = Field(default=None, ge=0)
    description: str | None = None
    account_name: str | None = Field(default=None, max_length=255)
    remark: str | None = None

    @field_validator("type")
    @classmethod
    def _validate_type_optional(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_type(v)


class TrackingItemOut(CamelModel):
    id: uuid.UUID
    sub_category_id: uuid.UUID
    name: str
    type: str
    initial_investment_tracking: bool
    exclusive: bool
    order: int = Field(validation_alias="order_index", serialization_alias="order")
    description: str | None
    account_name: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime
