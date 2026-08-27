r"""split_quarter_year_label_into_quarter_and_year

Revision ID: d112fa78e9c2
Revises: c001eb66b381
Create Date: 2026-08-27 10:00:00

Replaces the free-text `quarter_year_label` (String(50), nullable) column on
`ft_update_tracking_list` with two nullable integer columns, `quarter`
(1-4) and `year`, so a future Phase 3 dashboard can group/aggregate
snapshots by quarter/year without parsing a label string.

Backfill: dev-DB investigation prior to writing this migration found rows
using at least two different label separators — space (`"Q1 2026"`) and
slash (`"Q4/2022"`). The backfill regex `Q(\d)[^\d]{0,3}(\d{4})`
(case-insensitive) is deliberately permissive about the 0-3 characters
between the quarter digit and the year so it matches both observed styles
(and other minor variants like `"Q1-2026"` or `"Q1_2026"`) without being so
loose it would misfire on unrelated text. Any row whose label does not
match the pattern is left with `quarter`/`year` NULL rather than erroring
the migration — this is a best-effort backfill of an unstructured text
field, not a strict parser, and the source column is being dropped either
way.

Downgrade caveat: reconstructing `quarter_year_label` from `quarter`/`year`
is LOSSY — the original separator style (space vs slash vs other) is not
recoverable, so downgrade always regenerates the label as `'Q<n> <year>'`
(space-separated). Rows where either `quarter` or `year` is NULL get a NULL
label back, same as if they'd never matched on the way up.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "d112fa78e9c2"
down_revision: Union[str, None] = "c001eb66b381"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Matches "Q1 2026", "Q4/2022", "Q1-2026", "Q1_2026", etc. Case-insensitive.
# Kept as a module constant so upgrade() (WHERE guard) and downgrade()
# (documentation only, not run as SQL) stay in obvious sync if ever revisited.
_QUARTER_YEAR_PATTERN = r"Q(\d)[^\d]{0,3}(\d{4})"


def upgrade() -> None:
    op.add_column("ft_update_tracking_list", sa.Column("quarter", sa.Integer(), nullable=True))
    op.add_column("ft_update_tracking_list", sa.Column("year", sa.Integer(), nullable=True))

    # Best-effort backfill from the old label into the two new integer
    # columns. Non-matching rows (including NULL labels) are left NULL —
    # WHERE guard means this UPDATE simply skips them rather than raising.
    op.execute(
        sa.text(
            f"""
            UPDATE ft_update_tracking_list
            SET quarter = substring(quarter_year_label from 'Q(\\d)')::int,
                year = substring(quarter_year_label from '(\\d{{4}})')::int
            WHERE quarter_year_label ~* '{_QUARTER_YEAR_PATTERN}'
            """
        )
    )

    op.drop_column("ft_update_tracking_list", "quarter_year_label")


def downgrade() -> None:
    op.add_column(
        "ft_update_tracking_list", sa.Column("quarter_year_label", sa.String(length=50), nullable=True)
    )

    # Lossy best-effort reconstruction — see module docstring. Original
    # separator style is not recoverable; always regenerated space-separated.
    op.execute(
        sa.text(
            """
            UPDATE ft_update_tracking_list
            SET quarter_year_label = 'Q' || quarter || ' ' || year
            WHERE quarter IS NOT NULL AND year IS NOT NULL
            """
        )
    )

    op.drop_column("ft_update_tracking_list", "quarter")
    op.drop_column("ft_update_tracking_list", "year")
