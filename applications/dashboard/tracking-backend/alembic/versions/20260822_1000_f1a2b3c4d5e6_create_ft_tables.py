"""create_ft_tables

Revision ID: f1a2b3c4d5e6
Revises:
Create Date: 2026-08-22 10:00:00

Creates the 5 Financial Tracker tables (Phase 1: CRUD only — no dashboard/
update-aggregation features). All tables are prefixed `ft_` and carry NO
foreign keys into any table owned by applications/dashboard/backend — the
`user_id` columns are bare UUIDs, ownership is enforced at the application
layer only (bounded-context isolation). The `uuid-ossp` extension is assumed
already enabled on this Postgres instance (created by the main backend).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ft_tracking_set ──────────────────────────────────────────────────────
    op.create_table(
        "ft_tracking_set",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "name", name="uq_ft_tracking_set_user_id_name"),
    )
    op.create_index("ix_ft_tracking_set_user_id", "ft_tracking_set", ["user_id"])

    # ── ft_category ──────────────────────────────────────────────────────────
    op.create_table(
        "ft_category",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "tracking_set_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_tracking_set.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ft_category_tracking_set_id", "ft_category", ["tracking_set_id"])
    op.create_index("ix_ft_category_user_id", "ft_category", ["user_id"])
    op.create_index("ix_ft_category_set_order", "ft_category", ["tracking_set_id", "order_index"])

    # ── ft_sub_category ──────────────────────────────────────────────────────
    op.create_table(
        "ft_sub_category",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_category.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ft_sub_category_category_id", "ft_sub_category", ["category_id"])
    op.create_index("ix_ft_sub_category_user_id", "ft_sub_category", ["user_id"])
    op.create_index("ix_ft_sub_category_cat_order", "ft_sub_category", ["category_id", "order_index"])

    # ── ft_tracking_item ─────────────────────────────────────────────────────
    op.create_table(
        "ft_tracking_item",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "sub_category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_sub_category.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column(
            "initial_investment_tracking", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("exclusive", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("account_name", sa.String(length=255), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "type IN ('Bank account','Property','Investment Account','TaxSaving','Materials','Insurance')",
            name="ck_ft_tracking_item_type",
        ),
    )
    op.create_index("ix_ft_tracking_item_sub_category_id", "ft_tracking_item", ["sub_category_id"])
    op.create_index("ix_ft_tracking_item_user_id", "ft_tracking_item", ["user_id"])
    op.create_index(
        "ix_ft_tracking_item_subcat_order", "ft_tracking_item", ["sub_category_id", "order_index"]
    )

    # ── ft_initial_investment_entry ──────────────────────────────────────────
    op.create_table(
        "ft_initial_investment_entry",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "tracking_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount <> 0", name="ck_ft_entry_amount_nonzero"),
    )
    op.create_index("ix_ft_entry_tracking_item_id", "ft_initial_investment_entry", ["tracking_item_id"])
    op.create_index(
        "ix_ft_entry_item_date", "ft_initial_investment_entry", ["tracking_item_id", "entry_date"]
    )


def downgrade() -> None:
    # Reverse dependency order
    op.drop_table("ft_initial_investment_entry")
    op.drop_table("ft_tracking_item")
    op.drop_table("ft_sub_category")
    op.drop_table("ft_category")
    op.drop_table("ft_tracking_set")
