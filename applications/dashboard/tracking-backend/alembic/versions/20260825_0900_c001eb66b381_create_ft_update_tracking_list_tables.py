"""create_ft_update_tracking_list_tables

Revision ID: c001eb66b381
Revises: f1a2b3c4d5e6
Create Date: 2026-08-25 09:00:00

Creates the 2 Financial Tracker tables for Phase 2 ("Update Tracking
Lists"): dated balance-snapshot headers (`ft_update_tracking_list`) and
their per-item balance line rows (`ft_update_tracking_list_balance`). Both
are prefixed `ft_` and carry NO foreign keys into any table owned by
applications/dashboard/backend — the `user_id` columns are bare UUIDs,
ownership is enforced at the application layer only (bounded-context
isolation), matching revision f1a2b3c4d5e6. The `uuid-ossp` extension is
assumed already enabled on this Postgres instance.

Delta computation (current vs. previous list balance, per item) is NEVER
stored — it is computed at read time by app/services/update_tracking.py —
so neither table below carries any delta/previous-balance column.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c001eb66b381"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ft_update_tracking_list ──────────────────────────────────────────────
    op.create_table(
        "ft_update_tracking_list",
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
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("quarter_year_label", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ft_update_tracking_list_user_id", "ft_update_tracking_list", ["user_id"])
    op.create_index(
        "ix_ft_update_tracking_list_tracking_set_id", "ft_update_tracking_list", ["tracking_set_id"]
    )
    op.create_index(
        "ix_ft_update_tracking_list_set_date",
        "ft_update_tracking_list",
        ["tracking_set_id", "transaction_date"],
    )

    # ── ft_update_tracking_list_balance ──────────────────────────────────────
    op.create_table(
        "ft_update_tracking_list_balance",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "update_tracking_list_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_update_tracking_list.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tracking_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("balance", sa.Numeric(19, 4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "update_tracking_list_id",
            "tracking_item_id",
            name="uq_ft_update_tracking_list_balance_list_item",
        ),
    )
    op.create_index(
        "ix_ft_update_tracking_list_balance_user_id", "ft_update_tracking_list_balance", ["user_id"]
    )
    op.create_index(
        "ix_ft_update_tracking_list_balance_update_tracking_list_id",
        "ft_update_tracking_list_balance",
        ["update_tracking_list_id"],
    )
    op.create_index(
        "ix_ft_update_tracking_list_balance_tracking_item_id",
        "ft_update_tracking_list_balance",
        ["tracking_item_id"],
    )


def downgrade() -> None:
    # Reverse dependency order
    op.drop_table("ft_update_tracking_list_balance")
    op.drop_table("ft_update_tracking_list")
