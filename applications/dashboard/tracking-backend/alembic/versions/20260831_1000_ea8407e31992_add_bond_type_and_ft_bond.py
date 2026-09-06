r"""add_bond_type_and_ft_bond

Revision ID: ea8407e31992
Revises: e7c4d9b21a83
Create Date: 2026-08-31 10:00:00

BOND register feature — two changes to the schema:

1. Widen the ``ck_ft_tracking_item_type`` CHECK constraint on
   ``ft_tracking_item`` from the 6-value list to a 7-value list, adding
   ``'BOND'``. This is purely additive at the value level — no existing row
   can violate the wider constraint, so the drop+recreate is safe with data
   present.

2. Create ``ft_bond`` — one row per registered bond holding, attached to a
   ``ft_tracking_item`` of type ``BOND`` via ``tracking_item_id`` with
   ``ON DELETE CASCADE`` (a bond cannot outlive its item). No ``user_id``
   column: ownership is resolved by joining to ``ft_tracking_item.user_id``,
   matching this service's bounded-context isolation. ``amount`` is
   ``Numeric(19, 4)`` with a ``ck_ft_bond_amount_nonneg`` CHECK
   (``amount >= 0``); ``code`` is ``NOT NULL``; ``issuer`` / ``start_date`` /
   ``expired_date`` are nullable. One index, ``ix_ft_bond_tracking_item_id``,
   on the FK column.

Downgrade is LOSSY and GUARDED:
  - It raises ``RuntimeError`` if any ``ft_tracking_item`` row still has
    ``type = 'BOND'`` — those rows would violate the narrowed 6-value CHECK,
    and silently deleting or rewriting user rows in a downgrade is not
    acceptable. Re-point or delete those items first, then downgrade.
  - Dropping ``ft_bond`` permanently discards every registered bond. This is
    the same intentional, unrecoverable posture as revision ``e7c4d9b21a83``'s
    lossy drop of the ``note`` column — not a best-effort round-trip.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "ea8407e31992"
down_revision: Union[str, None] = "e7c4d9b21a83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TYPE_CK = "ck_ft_tracking_item_type"
_TYPES_7 = "'Bank account','Property','Investment Account','TaxSaving','Materials','Insurance','BOND'"
_TYPES_6 = "'Bank account','Property','Investment Account','TaxSaving','Materials','Insurance'"


def upgrade() -> None:
    # 1. Widen the tracking-item type CHECK to include 'BOND'.
    op.drop_constraint(_TYPE_CK, "ft_tracking_item", type_="check")
    op.create_check_constraint(_TYPE_CK, "ft_tracking_item", f"type IN ({_TYPES_7})")

    # 2. Create ft_bond.
    op.create_table(
        "ft_bond",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "tracking_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ft_tracking_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("issuer", sa.String(length=200), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("expired_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("amount >= 0", name="ck_ft_bond_amount_nonneg"),
    )
    op.create_index("ix_ft_bond_tracking_item_id", "ft_bond", ["tracking_item_id"])


def downgrade() -> None:
    # GUARD — refuse to narrow the CHECK while 'BOND' items exist (see docstring).
    bind = op.get_bind()
    bond_items = bind.execute(
        sa.text("SELECT count(*) FROM ft_tracking_item WHERE type = 'BOND'")
    ).scalar_one()
    if bond_items:
        raise RuntimeError(
            f"Cannot downgrade {revision}: {bond_items} ft_tracking_item row(s) still have "
            "type='BOND', which the narrowed 6-value ck_ft_tracking_item_type CHECK would "
            "reject. Re-point or delete those items before downgrading."
        )

    # LOSSY — dropping ft_bond permanently discards every registered bond.
    op.drop_index("ix_ft_bond_tracking_item_id", table_name="ft_bond")
    op.drop_table("ft_bond")

    op.drop_constraint(_TYPE_CK, "ft_tracking_item", type_="check")
    op.create_check_constraint(_TYPE_CK, "ft_tracking_item", f"type IN ({_TYPES_6})")
