r"""add_note_to_ft_initial_investment_entry

Revision ID: e7c4d9b21a83
Revises: d112fa78e9c2
Create Date: 2026-08-30 14:30:00

Adds a single additive, nullable free-text column `note` (String(500)) to
`ft_initial_investment_entry` so a ledger entry can carry a short
human-written annotation (e.g. "เงินโบนัส", "sold half the position").

Additive + nullable + NO backfill: every existing row simply gets `note`
NULL on upgrade — there is no historical value to reconstruct and the column
has no default. No index, no CHECK, no constraint is added; the two existing
indexes (`ix_ft_entry_tracking_item_id`, `ix_ft_entry_item_date`) and the
`ck_ft_entry_amount_nonzero` check constraint are left untouched.

Downgrade caveat: `downgrade()` is LOSSY — dropping the column permanently
discards every `note` value that was written while this revision was applied.
This is the same posture as revision d112fa78e9c2's lossy downgrade of
`quarter_year_label`: the drop is intentional and unrecoverable, not a
best-effort round-trip.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e7c4d9b21a83"
down_revision: Union[str, None] = "d112fa78e9c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ft_initial_investment_entry",
        sa.Column("note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    # LOSSY — see module docstring. Every `note` value written under this
    # revision is permanently discarded.
    op.drop_column("ft_initial_investment_entry", "note")
