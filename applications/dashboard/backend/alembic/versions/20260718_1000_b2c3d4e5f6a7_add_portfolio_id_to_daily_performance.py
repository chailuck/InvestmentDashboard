"""Add portfolio_id column to daily_performance table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-18 10:00:00.000000+00:00

Extends the daily_performance table to scope snapshots to individual
portfolios rather than to users.  Prior to this migration the table carried
only a user_id FK and a UNIQUE(user_id, date) constraint, meaning only one
snapshot per user per day was possible.  Because positions are scoped to
portfolios (via portfolio_positions_db.portfolio_id), each daily snapshot
must carry a portfolio_id to allow one record per portfolio per day.

Changes applied
---------------
  1. ADD COLUMN portfolio_id UUID NOT NULL  FK → portfolios.id  ON DELETE CASCADE
  2. DROP CONSTRAINT uq_daily_performance_user_date
  3. ADD CONSTRAINT uq_daily_performance_portfolio_date  UNIQUE (portfolio_id, date)
  4. ADD INDEX ix_daily_performance_portfolio_id

Rollback
--------
  Reverses all four operations in reverse order and restores the original
  uq_daily_performance_user_date UNIQUE (user_id, date) constraint.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add portfolio_id FK, swap unique constraint to portfolio-scoped, and add index.

    Uses a three-phase NOT NULL strategy so the migration is safe regardless of
    whether the daily_performance table contains existing rows at run time:

    Phase 1  Add the column as nullable — no server_default required; existing
             rows (if any) receive NULL which is temporarily allowed.
    Phase 2  Delete any rows that were created before portfolio_id existed.
             These rows cannot be unambiguously attributed to a single portfolio
             when multiple portfolios share the same user_id, so data loss on
             the pre-portfolio snapshots is intentional and documented here.
             On a fresh deployment (table empty) this is a no-op.
    Phase 3  Tighten the column to NOT NULL once all rows carry a portfolio_id.
    """
    # Phase 1: add nullable column + FK
    op.add_column(
        "daily_performance",
        sa.Column("portfolio_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_daily_performance_portfolio_id",
        "daily_performance",
        "portfolios",
        ["portfolio_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Phase 2: remove any pre-existing rows that have NULL portfolio_id.
    # Existing snapshots were computed from user-scoped (not portfolio-scoped)
    # position queries and are therefore invalid under the new schema.
    op.execute("DELETE FROM daily_performance WHERE portfolio_id IS NULL")

    # Phase 3: enforce NOT NULL now that all remaining rows have a portfolio_id
    op.alter_column("daily_performance", "portfolio_id", nullable=False)

    # Swap unique constraint from (user_id, date) to (portfolio_id, date)
    op.drop_constraint(
        "uq_daily_performance_user_date",
        "daily_performance",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_daily_performance_portfolio_date",
        "daily_performance",
        ["portfolio_id", "date"],
    )
    op.create_index(
        "ix_daily_performance_portfolio_id",
        "daily_performance",
        ["portfolio_id"],
    )


def downgrade() -> None:
    """Reverse all changes introduced by upgrade() and restore the user-scoped constraint."""
    op.drop_index(
        "ix_daily_performance_portfolio_id",
        table_name="daily_performance",
    )
    op.drop_constraint(
        "uq_daily_performance_portfolio_date",
        "daily_performance",
        type_="unique",
    )
    op.drop_constraint(
        "fk_daily_performance_portfolio_id",
        "daily_performance",
        type_="foreignkey",
    )
    op.drop_column("daily_performance", "portfolio_id")
    op.create_unique_constraint(
        "uq_daily_performance_user_date",
        "daily_performance",
        ["user_id", "date"],
    )
