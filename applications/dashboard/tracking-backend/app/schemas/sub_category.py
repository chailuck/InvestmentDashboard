from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel, CamelRequestModel


class SubCategoryCreate(CamelRequestModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


class SubCategoryUpdate(CamelRequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


class SubCategoryOut(CamelModel):
    id: uuid.UUID
    category_id: uuid.UUID
    name: str
    description: str | None
    order: int = Field(validation_alias="order_index", serialization_alias="order")
    created_at: datetime
    updated_at: datetime
