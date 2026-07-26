"""Add acc_pnl column to daily_performance table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-26 09:00:00.000000+00:00

Changes applied
---------------
  1. ALTER TABLE daily_performance
       ADD COLUMN acc_pnl NUMERIC(18,4) nullable

     acc_pnl: Accumulated realised P&L from all sold positions up to and
     including the snapshot date.  During a historical backfill the value is
     computed as a running sum across days (oldest → newest).  During a live
     daily snapshot it is computed as prior_day_acc_pnl + today_realised_pnl,
     where prior_day_acc_pnl is fetched from the most-recent existing row.

Rollback
--------
  Drops the acc_pnl column from daily_performance.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "daily_performance",
        sa.Column("acc_pnl", sa.Numeric(18, 4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daily_performance", "acc_pnl")
