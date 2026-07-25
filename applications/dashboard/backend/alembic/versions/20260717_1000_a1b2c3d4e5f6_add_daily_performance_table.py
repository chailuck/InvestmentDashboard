"""Add daily_performance table

Revision ID: a1b2c3d4e5f6
Revises: f6g7h8i9j0k1
Create Date: 2026-07-17 10:00:00.000000+00:00

Creates the daily_performance table that stores end-of-day portfolio
snapshots for each user: capital deployed, realised P&L, and unrealised
P&L with per-position breakdown in a JSONB column.

Schema summary
--------------
  daily_performance
    id              UUID         PK
    user_id         UUID         FK → users.id CASCADE DELETE
    date            DATE         NOT NULL
    investment      NUMERIC(16,2) NOT NULL DEFAULT 0
    closed_pnl      NUMERIC(16,2) NOT NULL DEFAULT 0
    closed_pnl_pct  NUMERIC(8,4)  NOT NULL DEFAULT 0
    open_pnl        NUMERIC(16,2) NOT NULL DEFAULT 0
    open_pnl_pct    NUMERIC(8,4)  NOT NULL DEFAULT 0
    open_positions  JSONB         NULLABLE
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()

  UNIQUE (user_id, date)  →  uq_daily_performance_user_date
  INDEX  ix_daily_performance_user_id
  INDEX  ix_daily_performance_date
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f6g7h8i9j0k1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create daily_performance table with indexes and unique constraint."""
    op.create_table(
        "daily_performance",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "investment",
            sa.Numeric(16, 2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "closed_pnl",
            sa.Numeric(16, 2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "closed_pnl_pct",
            sa.Numeric(8, 4),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "open_pnl",
            sa.Numeric(16, 2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "open_pnl_pct",
            sa.Numeric(8, 4),
            nullable=False,
            server_default="0",
        ),
        sa.Column("open_positions", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "date",
            name="uq_daily_performance_user_date",
        ),
    )
    op.create_index(
        op.f("ix_daily_performance_user_id"),
        "daily_performance",
        ["user_id"],
    )
    op.create_index(
        op.f("ix_daily_performance_date"),
        "daily_performance",
        ["date"],
    )


def downgrade() -> None:
    """Drop daily_performance table and its indexes."""
    op.drop_index(
        op.f("ix_daily_performance_date"),
        table_name="daily_performance",
    )
    op.drop_index(
        op.f("ix_daily_performance_user_id"),
        table_name="daily_performance",
    )
    op.drop_table("daily_performance")
