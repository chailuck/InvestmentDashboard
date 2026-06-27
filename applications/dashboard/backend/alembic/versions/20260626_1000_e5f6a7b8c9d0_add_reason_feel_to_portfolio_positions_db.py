"""Add reason and feel columns to portfolio_positions_db

Revision ID: e5f6a7b8c9d0
Revises: d4f8c2e73b1a
Create Date: 2026-06-26 10:00:00.000000+00:00

Adds two nullable annotation columns to portfolio_positions_db:
  - reason  (Text)        : free-text rationale for the position decision
  - feel    (SmallInteger): sentiment rating 1–5 at time of entry/exit decision
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4f8c2e73b1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "portfolio_positions_db",
        sa.Column("reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "portfolio_positions_db",
        sa.Column("feel", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("portfolio_positions_db", "feel")
    op.drop_column("portfolio_positions_db", "reason")
