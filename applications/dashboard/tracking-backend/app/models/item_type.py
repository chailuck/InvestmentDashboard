"""`ft_item_type` + `ft_item_type_capability` — the configurable tracking-item
type registry (ADR-027).

North star: *labels are data, capabilities are code.* A type is an
admin-managed row (`label`, `sort_order`, `is_archived`); the behaviours a
type carries are a fixed, code-owned set (`app/services/item_type_capabilities.py`)
attached through the join table under service-layer rules only.

`ft_tracking_item.type_id` is a nullable-first FK cutover of the old
`ft_tracking_item.type` VARCHAR (see the `c2d3e4f5a6b7` migration). The
`type` string column lingers as a denormalised, trigger-synced read-through
for one release, then a follow-up migration drops it.

Style mirrors `app/models/category.py` / `app/models/bond.py`: UUID pk with a
DB-side ``uuid_generate_v4()`` default, timezone-aware ``created_at`` /
``updated_at`` with ``func.now()`` server defaults and ``onupdate``.

NOTE — no DB CHECK on ``capability_key``: adding a capability in a future
release must be a code-only change, so ``capability_key`` values are
validated against the code enum at the service layer on every write, not by
the database. See `app/services/item_type_capabilities.py`.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base

# ── Fixed seed identity (golden fixture) ────────────────────────────────────
#
# The 7 current tracking-item types, seeded by the `c2d3e4f5a6b7` migration as
# ``is_system = true`` rows with these EXACT literal UUIDs so the same ids
# exist in every environment and parity tests can pin them. ``label`` is
# verbatim the pre-migration enum string (backfill matches on it 1:1);
# ``sort_order`` is today's frontend array index (0..6).
#
# The migration imports THIS tuple — it is plain data (UUID/str), stable
# across schema history, so importing it into an Alembic revision is safe
# where importing the ORM model would not be.
SYSTEM_ITEM_TYPE_SEED: tuple[dict, ...] = (
    {"id": "11111111-1111-4111-8111-111111111111", "slug": "bank_account",
     "label": "Bank account", "sort_order": 0, "capabilities": ()},
    {"id": "22222222-2222-4222-8222-222222222222", "slug": "property",
     "label": "Property", "sort_order": 1, "capabilities": ("counts_as_property",)},
    {"id": "33333333-3333-4333-8333-333333333333", "slug": "investment_account",
     "label": "Investment Account", "sort_order": 2, "capabilities": ()},
    {"id": "44444444-4444-4444-8444-444444444444", "slug": "tax_saving",
     "label": "TaxSaving", "sort_order": 3, "capabilities": ()},
    {"id": "55555555-5555-4555-8555-555555555555", "slug": "materials",
     "label": "Materials", "sort_order": 4, "capabilities": ()},
    {"id": "66666666-6666-4666-8666-666666666666", "slug": "insurance",
     "label": "Insurance", "sort_order": 5, "capabilities": ()},
    {"id": "77777777-7777-4777-8777-777777777777", "slug": "bond",
     "label": "BOND", "sort_order": 6, "capabilities": ("bond_register",)},
)

# label -> uuid string; slug -> uuid string. Importable by the test suite.
SYSTEM_ITEM_TYPE_IDS: dict[str, str] = {row["label"]: row["id"] for row in SYSTEM_ITEM_TYPE_SEED}
SYSTEM_ITEM_TYPE_IDS_BY_SLUG: dict[str, str] = {row["slug"]: row["id"] for row in SYSTEM_ITEM_TYPE_SEED}


class ItemType(Base):
    """`ft_item_type` — one configurable tracking-item type."""

    __tablename__ = "ft_item_type"
    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9_]+$'", name="ck_ft_item_type_slug_format"),
        # Case-insensitive, trim-insensitive label uniqueness (OQ-6). The
        # migration creates the identical functional index; declared here too
        # so `Base.metadata.create_all` (test schema) carries it.
        Index(
            "uq_ft_item_type_label_ci",
            func.lower(func.trim(text("label"))),
            unique=True,
        ),
        Index("ix_ft_item_type_active", "sort_order", postgresql_where=text("is_archived = false")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    slug: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    capabilities: Mapped[list["ItemTypeCapability"]] = relationship(
        "ItemTypeCapability",
        back_populates="item_type",
        cascade="all, delete-orphan",
        lazy="selectin",
        passive_deletes=True,
    )

    @property
    def capability_keys(self) -> list[str]:
        """Sorted list of capability key strings — the shape `ItemTypeOut`
        serialises. Stable ordering keeps golden-fixture assertions simple."""
        return sorted(c.capability_key for c in self.capabilities)


class ItemTypeCapability(Base):
    """`ft_item_type_capability` — a (type, capability) grant.

    ``ON DELETE CASCADE`` so deleting a custom type drops its grants
    automatically. NO DB CHECK on ``capability_key`` — see module docstring.
    """

    __tablename__ = "ft_item_type_capability"

    item_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ft_item_type.id", ondelete="CASCADE"),
        primary_key=True,
    )
    capability_key: Mapped[str] = mapped_column(String(50), primary_key=True)

    item_type: Mapped["ItemType"] = relationship("ItemType", back_populates="capabilities")
