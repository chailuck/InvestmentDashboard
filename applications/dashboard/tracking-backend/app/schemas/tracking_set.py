from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel, CamelRequestModel


class TrackingSetCreate(CamelRequestModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class TrackingSetUpdate(CamelRequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class TrackingSetOut(CamelModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
