"""Split feeling into buy_feeling and sell_feeling

Revision ID: d4f8c2e73b1a
Revises: c9e3a1f82b5d
Create Date: 2026-06-14 09:00:00.000000+00:00

Renames the existing single 'feeling' column to 'buy_feeling' and adds a
separate 'sell_feeling' column so users can rate the buy decision and the
sell decision independently.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f8c2e73b1a"
down_revision: Union[str, None] = "c9e3a1f82b5d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("weekly_review_items", "feeling", new_column_name="buy_feeling")
    op.add_column("weekly_review_items", sa.Column("sell_feeling", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("weekly_review_items", "sell_feeling")
    op.alter_column("weekly_review_items", "buy_feeling", new_column_name="feeling")
