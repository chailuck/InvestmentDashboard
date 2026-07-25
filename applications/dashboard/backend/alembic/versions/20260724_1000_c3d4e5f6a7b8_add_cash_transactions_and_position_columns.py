"""Add portfolio_cash_transactions table and purchased/sold position columns

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-24 10:00:00.000000+00:00

Changes applied
---------------
  1. CREATE TABLE portfolio_cash_transactions
       - id UUID PK
       - portfolio_id UUID NOT NULL FK → portfolios.id ON DELETE CASCADE
       - date DATE NOT NULL
       - amount NUMERIC(16,2) NOT NULL  (positive = deposit, negative = withdrawal)
       - note VARCHAR(255) nullable
       - created_at TIMESTAMPTZ server default now()
     INDEX ix_pct_portfolio_date ON (portfolio_id, date)

  2. ALTER TABLE daily_performance
       ADD COLUMN purchased_positions JSONB nullable
       ADD COLUMN sold_positions      JSONB nullable

     Schema for each JSONB item:
       {symbol, buy_price, close_price, pnl, pnl_pct}

     purchased_positions: positions whose entry_date == snapshot_date (opened that day)
     sold_positions:      positions whose exit_date == snapshot_date  (closed that day)

Rollback
--------
  Drops both JSONB columns and the portfolio_cash_transactions table + index.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create portfolio_cash_transactions table ───────────────────────────
    op.create_table(
        "portfolio_cash_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "portfolio_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_pct_portfolio_date",
        "portfolio_cash_transactions",
        ["portfolio_id", "date"],
    )

    # ── 2. Add purchased_positions and sold_positions to daily_performance ────
    op.add_column(
        "daily_performance",
        sa.Column("purchased_positions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "daily_performance",
        sa.Column("sold_positions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    # Remove new daily_performance columns
    op.drop_column("daily_performance", "sold_positions")
    op.drop_column("daily_performance", "purchased_positions")

    # Drop cash transactions table + index
    op.drop_index("ix_pct_portfolio_date", table_name="portfolio_cash_transactions")
    op.drop_table("portfolio_cash_transactions")
