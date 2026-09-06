"""`ItemTypeRegistry` — a request-scoped, in-memory resolver for the whole
`ft_item_type` set (ADR-027, design §B.5).

The table is a handful of rows, so the registry loads EVERY type + EVERY
capability grant in ONE query pair and serves ``has_capability`` from memory.
The balance-grid service, the bond gate and the item routers read from this
instead of touching the old ``type`` string or issuing a per-item query
(Risk R-3 — no N+1 on the hot balance-grid path).

Not cached across requests in v1: instantiation is two cheap indexed reads
and per-request freshness means an admin rename/capability edit is visible on
the very next request with no invalidation plumbing. A short TTL process
cache is a safe future optimisation (design §B.5) but is intentionally not
built yet.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload

from app.models.item_type import ItemType, ItemTypeCapability


@dataclass(frozen=True)
class ResolvedItemType:
    """An immutable, fully-resolved view of one ``ft_item_type`` row."""

    id: uuid.UUID
    slug: str
    label: str
    sort_order: int
    is_system: bool
    is_archived: bool
    capabilities: frozenset[str]

    def has_capability(self, key: str) -> bool:
        return key in self.capabilities


class ItemTypeRegistry:
    """Load once, resolve many. Build with :meth:`create`."""

    def __init__(self, resolved: list[ResolvedItemType]) -> None:
        self._all = resolved
        self.by_id: dict[uuid.UUID, ResolvedItemType] = {r.id: r for r in resolved}
        self.by_slug: dict[str, ResolvedItemType] = {r.slug: r for r in resolved}

    @classmethod
    async def create(cls, db: AsyncSession) -> "ItemTypeRegistry":
        # Exactly ONE query pair, regardless of row count. `lazyload` overrides
        # the model's default `selectin` on `ItemType.capabilities` so the
        # first SELECT does not also fire a third (redundant) capability query
        # — the grants are loaded once, explicitly, below.
        type_rows = list(
            (
                await db.execute(select(ItemType).options(lazyload(ItemType.capabilities)))
            ).scalars().all()
        )
        cap_rows = list((await db.execute(select(ItemTypeCapability))).scalars().all())

        caps_by_type: dict[uuid.UUID, set[str]] = {}
        for c in cap_rows:
            caps_by_type.setdefault(c.item_type_id, set()).add(c.capability_key)

        resolved = [
            ResolvedItemType(
                id=t.id,
                slug=t.slug,
                label=t.label,
                sort_order=t.sort_order,
                is_system=t.is_system,
                is_archived=t.is_archived,
                capabilities=frozenset(caps_by_type.get(t.id, set())),
            )
            for t in type_rows
        ]
        return cls(resolved)

    def get(self, type_id: uuid.UUID | None) -> ResolvedItemType | None:
        if type_id is None:
            return None
        return self.by_id.get(type_id)

    def require(self, type_id: uuid.UUID) -> ResolvedItemType:
        """Resolve or raise ``KeyError`` — for call sites where a missing type
        is a server-side invariant violation, not user input."""
        rt = self.by_id.get(type_id)
        if rt is None:
            raise KeyError(f"item type {type_id} is not in the registry")
        return rt

    def all_ordered(self) -> list[ResolvedItemType]:
        return sorted(self._all, key=lambda r: (r.sort_order, r.label.lower()))

    def active_ordered(self) -> list[ResolvedItemType]:
        return [r for r in self.all_ordered() if not r.is_archived]

    def active_count(self) -> int:
        return sum(1 for r in self._all if not r.is_archived)
