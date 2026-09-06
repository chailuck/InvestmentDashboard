"""Pydantic schemas for the configurable tracking-item type registry
(ADR-027, design §E).

Response bodies are camelCase (`sortOrder`, `isSystem`, ...) via
`CamelModel`, matching every other schema in this service. Reorder reuses the
app-wide `ReorderRequest` shape (`{ items: [{ id, order }] }`) already used
by categories / sub-categories / items.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import ConfigDict, Field, field_validator

from app.schemas.category import ReorderItem, ReorderRequest  # noqa: F401  (re-export)
from app.schemas.common import CamelModel, CamelRequestModel

_LABEL_MAX = 100


def _clean_label(v: str) -> str:
    """Trim outer whitespace, preserve interior. Reject blank / over-long
    AFTER trimming. Any printable Unicode (Thai, emoji) is allowed — `slug`
    is the machine key (OQ-6)."""
    if not isinstance(v, str):
        raise ValueError("label must be a string")
    cleaned = v.strip()
    if not cleaned:
        raise ValueError("label must not be blank")
    if len(cleaned) > _LABEL_MAX:
        raise ValueError(f"label must be at most {_LABEL_MAX} characters")
    return cleaned


class ItemTypeOut(CamelModel):
    id: uuid.UUID
    slug: str
    label: str
    sort_order: int
    is_system: bool
    is_archived: bool
    capabilities: list[str] = Field(default_factory=list)
    # Present only on the admin list response (delete-guard UI); omitted
    # (None) elsewhere.
    item_count: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("capabilities", mode="before")
    @classmethod
    def _normalise_capabilities(cls, v: object) -> list[str]:
        if v is None:
            return []
        out: list[str] = []
        for entry in v:  # type: ignore[union-attr]
            key = getattr(entry, "capability_key", entry)
            out.append(str(key))
        return sorted(out)


class ItemTypeCreate(CamelRequestModel):
    model_config = ConfigDict(extra="forbid")  # sending `slug` (or anything unknown) -> 422

    label: str
    sort_order: int | None = Field(default=None, ge=0)
    capabilities: list[str] | None = None

    @field_validator("label")
    @classmethod
    def _clean(cls, v: str) -> str:
        return _clean_label(v)


class ItemTypeUpdate(CamelRequestModel):
    model_config = ConfigDict(extra="forbid")  # `slug` in the body -> 422

    label: str | None = Field(default=None)
    sort_order: int | None = Field(default=None, ge=0)
    capabilities: list[str] | None = None

    @field_validator("label")
    @classmethod
    def _clean_optional(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _clean_label(v)
