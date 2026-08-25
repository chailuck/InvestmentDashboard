"""Tracking-set creation cascade.

Creating a TrackingSet must, in a SINGLE database transaction, also create
the default category/sub-category skeleton:

    Assets (order 1)
        Current Assets (order 1)
        Long-term Investment (order 2)
        Property (order 3)
    Liabilities (order 2)
        Current Liabilities (order 1)
        Long-term Liabilities (order 2)

All 8 rows (1 set + 2 categories + 5 sub-categories, wait: 1 + 2 + 5 = 8) are
inserted against ONE AsyncSession and committed exactly once by the caller
(the endpoint, via the `get_db` dependency's commit-on-success behavior) —
this function itself does NOT call db.commit(). If any insert fails (e.g. a
duplicate tracking-set name violates the unique constraint on flush), the
whole session rolls back and NOTHING is persisted — there is no partial
"orphaned tracking_set without its defaults" state.

Nothing here is flagged as a "default" vs. "user-created" row — per the
approved design, every row created by this cascade is fully editable and
deletable afterward via normal CRUD, indistinguishable from anything the
user creates by hand.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.sub_category import SubCategory
from app.models.tracking_set import TrackingSet

DEFAULT_CATEGORIES: list[tuple[str, int, list[str]]] = [
    ("Assets", 1, ["Current Assets", "Long-term Investment", "Property"]),
    ("Liabilities", 2, ["Current Liabilities", "Long-term Liabilities"]),
]


async def create_tracking_set_with_defaults(
    db: AsyncSession,
    *,
    user_id_uuid,
    name: str,
    description: str | None,
) -> TrackingSet:
    """Insert a TrackingSet plus its default category/sub-category skeleton.

    Uses `db.flush()` (not `db.commit()`) after each insert so that
    subsequent inserts can reference the just-generated primary keys while
    everything still lives in the same, uncommitted transaction. The caller
    (the `get_db` FastAPI dependency) commits once, after the endpoint
    handler returns normally — or rolls back the entire transaction if any
    exception propagates (e.g. IntegrityError from the unique-name
    constraint), leaving no orphaned rows behind.
    """
    tracking_set = TrackingSet(user_id=user_id_uuid, name=name, description=description)
    db.add(tracking_set)
    await db.flush()  # assigns tracking_set.id without committing

    for cat_name, cat_order, sub_names in DEFAULT_CATEGORIES:
        category = Category(
            user_id=user_id_uuid,
            tracking_set_id=tracking_set.id,
            name=cat_name,
            order_index=cat_order,
        )
        db.add(category)
        await db.flush()  # assigns category.id

        for sub_order, sub_name in enumerate(sub_names, start=1):
            db.add(
                SubCategory(
                    user_id=user_id_uuid,
                    category_id=category.id,
                    name=sub_name,
                    order_index=sub_order,
                )
            )

    await db.flush()
    return tracking_set
