from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel, CamelRequestModel
from app.schemas.item_type import ItemTypeOut


class TrackingItemCreate(CamelRequestModel):
    name: str = Field(min_length=1, max_length=255)
    # ADR-027: an item's type is a row reference now. Existence + not-archived
    # validation happens in the endpoint (needs a DB lookup), not here.
    type_id: uuid.UUID
    initial_investment_tracking: bool = False
    exclusive: bool = False
    order: int | None = Field(default=None, ge=0)
    description: str | None = None
    account_name: str | None = Field(default=None, max_length=255)
    remark: str | None = None


class TrackingItemUpdate(CamelRequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    type_id: uuid.UUID | None = None
    initial_investment_tracking: bool | None = None
    exclusive: bool | None = None
    order: int | None = Field(default=None, ge=0)
    description: str | None = None
    account_name: str | None = Field(default=None, max_length=255)
    remark: str | None = None


class TrackingItemOut(CamelModel):
    id: uuid.UUID
    sub_category_id: uuid.UUID
    name: str
    type_id: uuid.UUID
    item_type: ItemTypeOut
    # Transition-window back-compat field: the type's current label. Any
    # un-migrated client still reads `type`; dropped with the column later.
    type: str
    initial_investment_tracking: bool
    exclusive: bool
    order: int = Field(validation_alias="order_index", serialization_alias="order")
    description: str | None
    account_name: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime
