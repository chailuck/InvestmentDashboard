r"""add_interest_rate_to_ft_bond

Revision ID: b1c2d3e4f5a6
Revises: 00f7a890545d
Create Date: 2026-09-02 12:00:00

Adds one additive, nullable numeric column to ``ft_bond`` for the BOND
register interest-rate feature:

  - ``interest_rate`` — ``Numeric(19, 4)``, nullable

plus a range CHECK:

  - ``ck_ft_bond_interest_rate_range`` — ``interest_rate IS NULL OR
    (interest_rate >= 0 AND interest_rate <= 100)``

The column is additive + nullable + NO backfill: every existing row simply
gets ``NULL`` on upgrade, and ``NULL`` trivially satisfies the CHECK. No
index. The existing ``ck_ft_bond_amount_nonneg`` CHECK and the
``ix_ft_bond_tracking_item_id`` index are left untouched, as is every other
column on the table.

Downgrade caveat: ``downgrade()`` is LOSSY — dropping the column permanently
discards every ``interest_rate`` value written while this revision was
applied. Same intentional posture as revision
``00f7a890545d`` (``code`` / ``name``): the drop is unrecoverable, not a
best-effort round-trip. The CHECK constraint is dropped first so the column
drop cannot fail on a lingering dependency.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "00f7a890545d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ft_bond",
        sa.Column("interest_rate", sa.Numeric(19, 4), nullable=True),
    )
    op.create_check_constraint(
        "ck_ft_bond_interest_rate_range",
        "ft_bond",
        "interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100)",
    )


def downgrade() -> None:
    # LOSSY — see module docstring. Every `interest_rate` value written under
    # this revision is permanently discarded.
    op.drop_constraint("ck_ft_bond_interest_rate_range", "ft_bond", type_="check")
    op.drop_column("ft_bond", "interest_rate")
