"""Add sell_reason and sell_feel columns to portfolio_positions_db

Revision ID: f6g7h8i9j0k1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-26 11:00:00.000000+00:00

Adds two nullable annotation columns to portfolio_positions_db:
  - sell_reason  (Text)        : free-text rationale for the sell decision
  - sell_feel    (SmallInteger): sentiment rating 1–5 at time of sell decision
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6g7h8i9j0k1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "portfolio_positions_db",
        sa.Column("sell_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "portfolio_positions_db",
        sa.Column("sell_feel", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("portfolio_positions_db", "sell_feel")
    op.drop_column("portfolio_positions_db", "sell_reason")
