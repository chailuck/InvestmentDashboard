"""refactor review items to unified buy/sell legs per position

Revision ID: c9e3a1f82b5d
Revises: b7d4e2f19a3c
Create Date: 2026-06-13 16:00:00.000000+00:00

Replaces the single transaction_date/price/size columns with explicit buy and
sell leg columns so one row represents an entire position (opened and/or closed
during the week).  item_type values change from BUY|SELL|HOLD → TRADE|HOLD.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c9e3a1f82b5d"
down_revision: Union[str, None] = "b7d4e2f19a3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old single-leg columns
    op.drop_column("weekly_review_items", "transaction_date")
    op.drop_column("weekly_review_items", "price")
    op.drop_column("weekly_review_items", "size")

    # Add buy leg
    op.add_column("weekly_review_items", sa.Column("buy_date",  sa.Date(),           nullable=True))
    op.add_column("weekly_review_items", sa.Column("buy_price", sa.Numeric(14, 4),   nullable=True))
    op.add_column("weekly_review_items", sa.Column("buy_size",  sa.Integer(),         nullable=True))

    # Add sell leg
    op.add_column("weekly_review_items", sa.Column("sell_date",  sa.Date(),           nullable=True))
    op.add_column("weekly_review_items", sa.Column("sell_price", sa.Numeric(14, 4),   nullable=True))
    op.add_column("weekly_review_items", sa.Column("sell_size",  sa.Integer(),         nullable=True))

    # Week price snapshot (Monday / Friday of the review week)
    op.add_column("weekly_review_items", sa.Column("week_open_price",  sa.Numeric(14, 4), nullable=True))
    op.add_column("weekly_review_items", sa.Column("week_close_price", sa.Numeric(14, 4), nullable=True))

    # Migrate existing item_type values: BUY → TRADE, SELL → TRADE (HOLD stays)
    op.execute("UPDATE weekly_review_items SET item_type = 'TRADE' WHERE item_type IN ('BUY', 'SELL')")


def downgrade() -> None:
    op.drop_column("weekly_review_items", "week_close_price")
    op.drop_column("weekly_review_items", "week_open_price")
    op.drop_column("weekly_review_items", "sell_size")
    op.drop_column("weekly_review_items", "sell_price")
    op.drop_column("weekly_review_items", "sell_date")
    op.drop_column("weekly_review_items", "buy_size")
    op.drop_column("weekly_review_items", "buy_price")
    op.drop_column("weekly_review_items", "buy_date")

    op.add_column("weekly_review_items", sa.Column("transaction_date", sa.Date(),         nullable=True))
    op.add_column("weekly_review_items", sa.Column("price",            sa.Numeric(14, 4), nullable=True))
    op.add_column("weekly_review_items", sa.Column("size",             sa.Integer(),       nullable=True))

    op.execute("UPDATE weekly_review_items SET item_type = 'BUY' WHERE item_type = 'TRADE'")
