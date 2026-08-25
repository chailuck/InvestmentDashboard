from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel, CamelRequestModel


class CategoryCreate(CamelRequestModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


class CategoryUpdate(CamelRequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


class CategoryOut(CamelModel):
    id: uuid.UUID
    tracking_set_id: uuid.UUID
    name: str
    description: str | None
    order: int = Field(validation_alias="order_index", serialization_alias="order")
    created_at: datetime
    updated_at: datetime


class ReorderItem(CamelRequestModel):
    id: uuid.UUID
    order: int = Field(ge=0)


class ReorderRequest(CamelRequestModel):
    items: list[ReorderItem]
