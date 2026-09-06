"""Configurable tracking-item type registry endpoints (ADR-027, design §E).

Layering matches the rest of this service: the handler wires request/response
and transaction boundaries; type/capability rules live in
`app/services/item_type_capabilities.py` and the `ItemType` model. Error
bodies follow the service's existing FastAPI `{"detail": "..."}` convention
(OQ-8); the status codes are the contract.

Auth: `GET` is open to any authenticated tracker user (every item picker
needs it). Every mutating route requires `require_admin` — the signed JWT
`role` claim, no `users`-table access (OQ-3).

Every admin mutation emits a structured log line (actor = JWT `sub`, action,
type id, before/after label & capabilities) — OQ-5. No dedicated audit table
in v1.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user_id, require_admin
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.item_type import ItemType, ItemTypeCapability
from app.models.tracking_item import TrackingItem
from app.schemas.category import ReorderRequest
from app.schemas.item_type import ItemTypeCreate, ItemTypeOut, ItemTypeUpdate
from app.services.item_type_capabilities import (
    CapabilityValidationError,
    validate_requested_capabilities,
)

router = APIRouter(prefix="/item-types", tags=["Item Types"])
_log = get_logger("api.item_types")

UserId = Annotated[str, Depends(get_current_user_id)]
AdminId = Annotated[str, Depends(require_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]

_SLUG_RE = re.compile(r"[^a-z0-9_]+")
_SLUG_MAX = 50  # ft_item_type.slug is VARCHAR(50)


# ── Helpers ────────────────────────────────────────────────────────────────


def _slugify(label: str) -> str:
    base = _SLUG_RE.sub("_", label.strip().lower()).strip("_")
    base = base[:_SLUG_MAX].rstrip("_")
    return base or "type"


async def _unique_slug(db: AsyncSession, label: str) -> str:
    """slugify(label) with a numeric ``_2`` / ``_3`` … suffix on collision,
    checked against the current row set inside the caller's transaction.
    Kept within the VARCHAR(50) column even after adding the suffix."""
    existing = set((await db.execute(select(ItemType.slug))).scalars().all())
    candidate = _slugify(label)
    if candidate not in existing:
        return candidate
    n = 2
    while True:
        suffix = f"_{n}"
        trimmed = candidate[: _SLUG_MAX - len(suffix)].rstrip("_") or "type"
        cand = f"{trimmed}{suffix}"
        if cand not in existing:
            return cand
        n += 1


async def _get_type_or_404(type_id: uuid.UUID, db: AsyncSession) -> ItemType:
    obj = (
        await db.execute(
            select(ItemType)
            .options(selectinload(ItemType.capabilities))
            .where(ItemType.id == type_id)
        )
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(404, "Item type not found")
    return obj


async def _reload(type_id: uuid.UUID, db: AsyncSession) -> ItemType:
    """Re-fetch after a commit with capabilities eager-loaded, so `_to_out`
    never triggers an async lazy-load."""
    return (
        await db.execute(
            select(ItemType)
            .options(selectinload(ItemType.capabilities))
            .where(ItemType.id == type_id)
        )
    ).scalar_one()


async def _duplicate_label_exists(
    db: AsyncSession, label: str, *, exclude_id: uuid.UUID | None = None
) -> bool:
    stmt = select(ItemType.id).where(
        func.lower(func.trim(ItemType.label)) == label.strip().lower()
    )
    if exclude_id is not None:
        stmt = stmt.where(ItemType.id != exclude_id)
    return (await db.execute(stmt)).first() is not None


async def _item_counts(db: AsyncSession) -> dict[uuid.UUID, int]:
    rows = await db.execute(
        select(TrackingItem.type_id, func.count())
        .where(TrackingItem.type_id.is_not(None))
        .group_by(TrackingItem.type_id)
    )
    return {tid: n for tid, n in rows.all()}


def _to_out(row: ItemType, *, item_count: int | None = None) -> ItemTypeOut:
    return ItemTypeOut(
        id=row.id,
        slug=row.slug,
        label=row.label,
        sort_order=row.sort_order,
        is_system=row.is_system,
        is_archived=row.is_archived,
        capabilities=list(row.capability_keys),
        item_count=item_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ── GET (any authenticated user) ───────────────────────────────────────────


@router.get("", response_model=list[ItemTypeOut])
async def list_item_types(
    user_id: UserId,
    db: DB,
    response: Response,
    include_archived: Annotated[bool, Query(alias="includeArchived")] = False,
) -> list[ItemTypeOut]:
    stmt = select(ItemType)
    if not include_archived:
        stmt = stmt.where(ItemType.is_archived.is_(False))
    stmt = stmt.order_by(ItemType.sort_order.asc(), ItemType.label.asc())
    rows = list((await db.execute(stmt)).scalars().all())
    counts = await _item_counts(db)
    response.headers["Cache-Control"] = "private, max-age=60"
    return [_to_out(r, item_count=counts.get(r.id, 0)) for r in rows]


# ── Reorder (admin) — declared before /{id} so "order" is never a path id ───


@router.put("/order")
async def reorder_item_types(
    body: ReorderRequest, admin_id: AdminId, db: DB
) -> dict[str, str]:
    all_ids = set((await db.execute(select(ItemType.id))).scalars().all())
    requested = {item.id for item in body.items}
    if requested != all_ids:
        raise HTTPException(
            400,
            "reorder must list every item type id exactly once "
            f"({len(all_ids)} types exist)",
        )
    by_id = {
        r.id: r for r in (await db.execute(select(ItemType))).scalars().all()
    }
    for item in body.items:
        by_id[item.id].sort_order = item.order
    await db.commit()
    _log.info(
        "item types reordered",
        actor=admin_id,
        order={str(i.id): i.order for i in body.items},
    )
    return {"status": "ok"}


# ── Create (admin) ─────────────────────────────────────────────────────────


@router.post("", response_model=ItemTypeOut, status_code=201)
async def create_item_type(
    body: ItemTypeCreate, admin_id: AdminId, db: DB
) -> ItemTypeOut:
    if await _duplicate_label_exists(db, body.label):
        raise HTTPException(409, f"An item type named {body.label!r} already exists")

    try:
        capabilities = validate_requested_capabilities(body.capabilities or [])
    except CapabilityValidationError as exc:
        raise HTTPException(422, str(exc)) from exc

    if body.sort_order is not None:
        sort_order = body.sort_order
    else:
        current_max = (
            await db.execute(select(func.max(ItemType.sort_order)))
        ).scalar_one_or_none()
        sort_order = (current_max or 0) + 1

    try:
        created_by = uuid.UUID(admin_id)
    except ValueError:
        # A verified token whose `sub` is not a UUID must not 500 here;
        # `created_by` is nullable.
        created_by = None

    row = ItemType(
        slug=await _unique_slug(db, body.label),
        label=body.label,
        sort_order=sort_order,
        is_system=False,
        is_archived=False,
        created_by=created_by,
    )
    row.capabilities = [ItemTypeCapability(capability_key=k) for k in capabilities]
    db.add(row)
    await db.commit()
    row = await _reload(row.id, db)

    _log.info(
        "item type created",
        actor=admin_id,
        type_id=str(row.id),
        slug=row.slug,
        label=row.label,
        capabilities=capabilities,
    )
    return _to_out(row)


# ── Update (admin) ─────────────────────────────────────────────────────────


@router.put("/{type_id}", response_model=ItemTypeOut)
async def update_item_type(
    type_id: uuid.UUID, body: ItemTypeUpdate, admin_id: AdminId, db: DB
) -> ItemTypeOut:
    row = await _get_type_or_404(type_id, db)
    fields = body.model_dump(exclude_unset=True)

    before = {"label": row.label, "capabilities": list(row.capability_keys)}

    if "capabilities" in fields:
        if row.is_system:
            raise HTTPException(
                422, "system type capabilities are locked and cannot be edited"
            )
        try:
            new_caps = validate_requested_capabilities(fields["capabilities"] or [])
        except CapabilityValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        # Reassigning the relationship removes the previous grants via the
        # `all, delete-orphan` cascade on `ItemType.capabilities` — no explicit
        # DELETE needed (would be a redundant double-delete).
        row.capabilities = [ItemTypeCapability(capability_key=k) for k in new_caps]

    if "label" in fields and fields["label"] is not None:
        new_label = fields["label"]
        if await _duplicate_label_exists(db, new_label, exclude_id=row.id):
            raise HTTPException(409, f"An item type named {new_label!r} already exists")
        row.label = new_label
        # Transition window (§C.6): keep the denormalised
        # ft_tracking_item.type column in step, in this same transaction.
        await db.execute(
            TrackingItem.__table__.update()
            .where(TrackingItem.type_id == row.id)
            .values(type=new_label)
        )

    if "sort_order" in fields and fields["sort_order"] is not None:
        row.sort_order = fields["sort_order"]

    await db.commit()
    row = await _reload(row.id, db)

    _log.info(
        "item type updated",
        actor=admin_id,
        type_id=str(row.id),
        before=before,
        after={"label": row.label, "capabilities": list(row.capability_keys)},
    )
    return _to_out(row)


# ── Archive / unarchive (admin) ────────────────────────────────────────────


@router.put("/{type_id}/archive", response_model=ItemTypeOut)
async def archive_item_type(
    type_id: uuid.UUID, admin_id: AdminId, db: DB
) -> ItemTypeOut:
    row = await _get_type_or_404(type_id, db)
    if not row.is_archived:
        active = (
            await db.execute(
                select(func.count()).select_from(ItemType).where(ItemType.is_archived.is_(False))
            )
        ).scalar_one()
        if active <= 1:
            raise HTTPException(409, "at least one active item type must remain")
        row.is_archived = True
        await db.commit()
        row = await _reload(row.id, db)
        _log.info("item type archived", actor=admin_id, type_id=str(row.id), label=row.label)
    return _to_out(row)


@router.put("/{type_id}/unarchive", response_model=ItemTypeOut)
async def unarchive_item_type(
    type_id: uuid.UUID, admin_id: AdminId, db: DB
) -> ItemTypeOut:
    row = await _get_type_or_404(type_id, db)
    if row.is_archived:
        row.is_archived = False
        await db.commit()
        row = await _reload(row.id, db)
        _log.info("item type unarchived", actor=admin_id, type_id=str(row.id), label=row.label)
    return _to_out(row)


# ── Delete (admin) ─────────────────────────────────────────────────────────


@router.delete("/{type_id}", status_code=204, response_model=None)
async def delete_item_type(type_id: uuid.UUID, admin_id: AdminId, db: DB) -> Response:
    row = await _get_type_or_404(type_id, db)
    if row.is_system:
        raise HTTPException(409, "system types cannot be deleted; archive instead")

    in_use = (
        await db.execute(
            select(func.count())
            .select_from(TrackingItem)
            .where(TrackingItem.type_id == row.id)
        )
    ).scalar_one()
    if in_use:
        raise HTTPException(409, f"{in_use} item(s) still use this type; archive instead")

    await db.delete(row)  # capability rows cascade (ON DELETE CASCADE)
    await db.commit()
    _log.info("item type deleted", actor=admin_id, type_id=str(type_id), label=row.label)
    return Response(status_code=204)
