r"""item_type_config — configurable tracking-item types + capability registry

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-06 12:00:00

ADR-027. Replaces the closed 7-value ``ft_tracking_item.type`` CHECK enum
with an FK to a new admin-managed ``ft_item_type`` table, plus a code-owned
capability join table. Every step is additive until the very end, so the
migration is safe to run against a populated, still-running pre-deploy app —
``type_id`` is nullable during the old app's writes and the sync trigger's
ELSE branch preserves the old string path.

Ordered upgrade (design §C):
  1. create ``ft_item_type`` + ``ft_item_type_capability``
  2. seed the 7 current types as ``is_system`` rows with FIXED literal UUIDs
     (imported from ``app.models.item_type.SYSTEM_ITEM_TYPE_SEED`` — plain
     data, safe to import into a migration) + their capability rows
  3. add nullable ``ft_tracking_item.type_id`` FK (ON DELETE RESTRICT)
  4. backfill by EXACT ``label == old type string`` match; HARD ABORT guard
     (mirrors the ``ea8407e31992`` guard style) if any row is left unmapped
  5. ``SET NOT NULL`` + create ``ix_ft_tracking_item_type_id``
  6. add BEFORE INSERT OR UPDATE trigger ``ft_tracking_item_sync_type``
  7. drop ``ck_ft_tracking_item_type``

Downgrade is GUARDED and lossless ONLY in the safe window (no custom type
row exists AND no system row's label differs from its seed). Past that point
the ``type`` string column holds values outside the original 7-value CHECK
(a custom label, or a renamed system label), so the downgrade RAISES with
the offending rows listed — exactly like ``ea8407e31992``'s
"still have type='BOND'" guard. The ``type`` string column is NOT dropped
here; a separate follow-up migration drops it once no code reads it.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.item_type import SYSTEM_ITEM_TYPE_SEED

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TYPE_CK = "ck_ft_tracking_item_type"
_TYPES_7 = (
    "'Bank account','Property','Investment Account','TaxSaving',"
    "'Materials','Insurance','BOND'"
)

_SYNC_FN = "ft_tracking_item_sync_type_fn"
_SYNC_TRIGGER = "ft_tracking_item_sync_type"


def upgrade() -> None:
    # 1. ── new tables ────────────────────────────────────────────────────────
    op.create_table(
        "ft_item_type",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("slug", name="uq_ft_item_type_slug"),
        sa.CheckConstraint("slug ~ '^[a-z0-9_]+$'", name="ck_ft_item_type_slug_format"),
    )
    # Case-insensitive, trim-insensitive label uniqueness (OQ-6).
    op.create_index(
        "uq_ft_item_type_label_ci",
        "ft_item_type",
        [sa.text("lower(trim(label))")],
        unique=True,
    )
    # Hot "active picker" query: filter archived out, order by sort_order.
    op.create_index(
        "ix_ft_item_type_active",
        "ft_item_type",
        ["sort_order"],
        postgresql_where=sa.text("is_archived = false"),
    )

    op.create_table(
        "ft_item_type_capability",
        sa.Column(
            "item_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_item_type.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("capability_key", sa.String(length=50), primary_key=True),
        # NO DB CHECK on capability_key — see ADR-027 / the model docstring.
    )

    # 2. ── seed the 7 system rows + capability rows ──────────────────────────
    item_type_tbl = sa.table(
        "ft_item_type",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("slug", sa.String),
        sa.column("label", sa.String),
        sa.column("sort_order", sa.Integer),
        sa.column("is_system", sa.Boolean),
        sa.column("is_archived", sa.Boolean),
    )
    capability_tbl = sa.table(
        "ft_item_type_capability",
        sa.column("item_type_id", postgresql.UUID(as_uuid=True)),
        sa.column("capability_key", sa.String),
    )

    op.bulk_insert(
        item_type_tbl,
        [
            {
                "id": row["id"],
                "slug": row["slug"],
                "label": row["label"],
                "sort_order": row["sort_order"],
                "is_system": True,
                "is_archived": False,
            }
            for row in SYSTEM_ITEM_TYPE_SEED
        ],
    )
    cap_rows = [
        {"item_type_id": row["id"], "capability_key": key}
        for row in SYSTEM_ITEM_TYPE_SEED
        for key in row["capabilities"]
    ]
    if cap_rows:
        op.bulk_insert(capability_tbl, cap_rows)

    # 3. ── nullable FK column ───────────────────────────────────────────────
    op.add_column(
        "ft_tracking_item",
        sa.Column("type_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_ft_tracking_item_type_id",
        "ft_tracking_item",
        "ft_item_type",
        ["type_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # 4. ── backfill by exact label match + hard abort guard ─────────────────
    op.execute(
        """
        UPDATE ft_tracking_item t
           SET type_id = it.id
          FROM ft_item_type it
         WHERE it.is_system = true
           AND it.label = t.type
        """
    )
    bind = op.get_bind()
    unmapped = bind.execute(
        sa.text("SELECT count(*) FROM ft_tracking_item WHERE type_id IS NULL")
    ).scalar_one()
    if unmapped:
        sample = bind.execute(
            sa.text(
                "SELECT DISTINCT type FROM ft_tracking_item "
                "WHERE type_id IS NULL ORDER BY type LIMIT 20"
            )
        ).scalars().all()
        raise RuntimeError(
            f"Cannot complete {revision}: {unmapped} ft_tracking_item row(s) hold a "
            f"`type` string outside the known 7 seed labels and could not be "
            f"back-filled. Offending distinct type value(s): {list(sample)}. "
            "Investigate and re-point those rows before re-running — the migration "
            "will NOT silently default them."
        )

    # 5. ── enforce NOT NULL + index ────────────────────────────────────────
    op.alter_column("ft_tracking_item", "type_id", nullable=False, existing_type=postgresql.UUID(as_uuid=True))
    op.create_index("ix_ft_tracking_item_type_id", "ft_tracking_item", ["type_id"])

    # 6. ── denormalised-column sync trigger (transition window, §C.6) ───────
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {_SYNC_FN}() RETURNS trigger AS $$
        BEGIN
          IF NEW.type_id IS NOT NULL THEN
            NEW.type := (SELECT label FROM ft_item_type WHERE id = NEW.type_id);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_SYNC_TRIGGER}
          BEFORE INSERT OR UPDATE ON ft_tracking_item
          FOR EACH ROW EXECUTE FUNCTION {_SYNC_FN}();
        """
    )

    # 7. ── drop the now-obsolete 7-value CHECK ─────────────────────────────
    # Once type_id is NOT NULL + FK-guarded, this CHECK would reject the first
    # custom type's label the moment the sync trigger writes it.
    op.drop_constraint(_TYPE_CK, "ft_tracking_item", type_="check")

    # DEVIATION FROM DESIGN (surfaced to the user): §B.8 keeps
    # ``ft_tracking_item.type`` at VARCHAR(30), but ``ft_item_type.label`` is
    # VARCHAR(100) and the sync trigger copies label -> type. A custom type
    # whose label exceeds 30 chars would make EVERY insert/update of an item
    # of that type fail with StringDataRightTruncation. Widen the transitional
    # column to match the label width. Lossless; the follow-up migration drops
    # the column entirely.
    op.alter_column(
        "ft_tracking_item",
        "type",
        type_=sa.String(length=100),
        existing_type=sa.String(length=30),
        existing_nullable=False,
    )


def downgrade() -> None:
    bind = op.get_bind()

    # GUARD — the "point of no return" (design §C.7). Refuse a lossy downgrade
    # rather than corrupt data, matching the ea8407e31992 precedent.
    custom = bind.execute(
        sa.text("SELECT count(*) FROM ft_item_type WHERE is_system = false")
    ).scalar_one()

    seed_label_by_slug = {row["slug"]: row["label"] for row in SYSTEM_ITEM_TYPE_SEED}
    system_rows = bind.execute(
        sa.text("SELECT slug, label FROM ft_item_type WHERE is_system = true")
    ).all()
    renamed = [
        (slug, label)
        for slug, label in system_rows
        if seed_label_by_slug.get(slug) != label
    ]

    if custom or renamed:
        raise RuntimeError(
            f"Cannot downgrade {revision}: the safe window has closed. "
            f"custom (is_system=false) type rows: {custom}; renamed system rows: "
            f"{renamed}. The `type` string column now holds values outside the "
            "original 7-value CHECK. Re-point/delete custom-typed items and revert "
            "system-label renames before downgrading."
        )

    # Safe window: schema-only, lossless. The `type` string column values were
    # never touched, so every item keeps its original type. In this window
    # every `type` value is one of the original 7 seed labels (<= 19 chars),
    # so narrowing back to VARCHAR(30) cannot truncate.
    op.execute(f"DROP TRIGGER IF EXISTS {_SYNC_TRIGGER} ON ft_tracking_item")
    op.execute(f"DROP FUNCTION IF EXISTS {_SYNC_FN}()")

    op.alter_column(
        "ft_tracking_item",
        "type",
        type_=sa.String(length=30),
        existing_type=sa.String(length=100),
        existing_nullable=False,
    )

    op.drop_index("ix_ft_tracking_item_type_id", table_name="ft_tracking_item")
    op.drop_constraint("fk_ft_tracking_item_type_id", "ft_tracking_item", type_="foreignkey")
    op.drop_column("ft_tracking_item", "type_id")

    op.create_check_constraint(_TYPE_CK, "ft_tracking_item", f"type IN ({_TYPES_7})")

    op.drop_table("ft_item_type_capability")
    op.drop_index("ix_ft_item_type_active", table_name="ft_item_type")
    op.drop_index("uq_ft_item_type_label_ci", table_name="ft_item_type")
    op.drop_table("ft_item_type")
