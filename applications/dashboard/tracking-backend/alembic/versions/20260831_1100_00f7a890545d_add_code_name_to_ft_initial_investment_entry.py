r"""add_code_name_to_ft_initial_investment_entry

Revision ID: 00f7a890545d
Revises: ea8407e31992
Create Date: 2026-08-31 11:00:00

Adds two additive, nullable free-text label columns to
``ft_initial_investment_entry`` for the BOND register / ledger CODE/NAME
feature:

  - ``code`` — ``String(100)``, nullable
  - ``name`` — ``String(100)``, nullable

Both are additive + nullable + NO backfill: every existing row simply gets
``NULL`` for each on upgrade. No index, no CHECK, no constraint. The existing
indexes (``ix_ft_entry_tracking_item_id``, ``ix_ft_entry_item_date``), the
``ck_ft_entry_amount_nonzero`` CHECK, and the ``note`` column from revision
``e7c4d9b21a83`` are all left untouched.

Downgrade caveat: ``downgrade()`` is LOSSY — dropping the columns permanently
discards every ``code`` / ``name`` value written while this revision was
applied. Same intentional posture as revisions ``e7c4d9b21a83`` (``note``)
and ``d112fa78e9c2`` (``quarter_year_label``): the drop is unrecoverable, not
a best-effort round-trip.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "00f7a890545d"
down_revision: Union[str, None] = "ea8407e31992"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ft_initial_investment_entry",
        sa.Column("code", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "ft_initial_investment_entry",
        sa.Column("name", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    # LOSSY — see module docstring. Every `code` / `name` value written under
    # this revision is permanently discarded.
    op.drop_column("ft_initial_investment_entry", "name")
    op.drop_column("ft_initial_investment_entry", "code")
