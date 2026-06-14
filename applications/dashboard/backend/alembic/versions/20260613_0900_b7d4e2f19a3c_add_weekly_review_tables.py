"""add weekly review tables

Revision ID: b7d4e2f19a3c
Revises: a6bcb833f755
Create Date: 2026-06-13 09:00:00.000000+00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7d4e2f19a3c"
down_revision: Union[str, None] = "a6bcb833f755"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "weekly_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("week_end", sa.Date(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "week_start", name="uq_review_user_week"),
    )
    op.create_index("ix_weekly_reviews_user_id", "weekly_reviews", ["user_id"])

    op.create_table(
        "weekly_review_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("review_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("weekly_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(30), nullable=False),
        sa.Column("item_type", sa.String(10), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=True),
        sa.Column("price", sa.Numeric(14, 4), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("buy_reason", sa.Text(), nullable=True),
        sa.Column("sell_reason", sa.Text(), nullable=True),
        sa.Column("feeling", sa.SmallInteger(), nullable=True),
        sa.Column(
            "source_position_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("portfolio_positions_db.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_weekly_review_items_review_id", "weekly_review_items", ["review_id"])


def downgrade() -> None:
    op.drop_table("weekly_review_items")
    op.drop_table("weekly_reviews")
