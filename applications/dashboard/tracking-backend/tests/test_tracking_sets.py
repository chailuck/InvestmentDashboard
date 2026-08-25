"""Tracking Set CRUD, cascade-creation, ownership isolation, duplicate-name
conflict, and rollback-on-failure atomicity."""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import tracking_sets as tracking_sets_module
from app.models.category import Category
from app.models.sub_category import SubCategory
from app.models.tracking_set import TrackingSet

PREFIX = "/api/v1/tracking"


# ── Happy path CRUD ───────────────────────────────────────────────────────────

async def test_create_tracking_set_returns_201(auth_client):
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": "My Finances", "description": "desc"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "My Finances"
    assert body["description"] == "desc"
    assert "id" in body
    assert "createdAt" in body and "updatedAt" in body


async def test_create_tracking_set_without_description(auth_client):
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": "No Desc Set"})
    assert resp.status_code == 201
    assert resp.json()["description"] is None


@pytest.mark.parametrize("name", ["", "x" * 256])
async def test_create_tracking_set_invalid_name_returns_422(auth_client, name):
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": name})
    assert resp.status_code == 422


async def test_list_tracking_sets_returns_only_callers_sets(auth_client, auth_client_b):
    await auth_client.post(f"{PREFIX}/sets", json={"name": "A's Set"})
    await auth_client_b.post(f"{PREFIX}/sets", json={"name": "B's Set"})

    resp_a = await auth_client.get(f"{PREFIX}/sets")
    names_a = [s["name"] for s in resp_a.json()]
    assert "A's Set" in names_a
    assert "B's Set" not in names_a


async def test_get_tracking_set_by_id(auth_client):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "Gettable Set"})
    set_id = create.json()["id"]
    resp = await auth_client.get(f"{PREFIX}/sets/{set_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == set_id


async def test_get_nonexistent_tracking_set_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_update_tracking_set_partial(auth_client):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "Original", "description": "orig"})
    set_id = create.json()["id"]

    resp = await auth_client.put(f"{PREFIX}/sets/{set_id}", json={"description": "updated"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Original"  # untouched
    assert body["description"] == "updated"


async def test_update_tracking_set_emits_audit_log(auth_client):
    """AC-BA-008: every UPDATE must be logged with user_id + entity id (Gate 4)."""
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "Audited Set"})
    set_id = create.json()["id"]

    with patch.object(tracking_sets_module, "_log") as mock_log:
        resp = await auth_client.put(f"{PREFIX}/sets/{set_id}", json={"description": "audited"})
    assert resp.status_code == 200

    mock_log.info.assert_called_once()
    args, kwargs = mock_log.info.call_args
    assert args[0] == "Tracking set updated"
    assert kwargs["tracking_set_id"] == set_id
    assert "user_id" in kwargs


async def test_reorder_categories_emits_single_batch_audit_log(auth_client):
    """Reorder must log once per batch (with a count), not once per item."""
    set_id = (await auth_client.post(f"{PREFIX}/sets", json={"name": "Audited Reorder Set"})).json()["id"]
    cats = (await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")).json()

    with patch.object(tracking_sets_module, "_log") as mock_log:
        resp = await auth_client.put(
            f"{PREFIX}/sets/{set_id}/categories/reorder",
            json={"items": [{"id": c["id"], "order": c["order"]} for c in cats]},
        )
    assert resp.status_code == 200

    mock_log.info.assert_called_once()
    args, kwargs = mock_log.info.call_args
    assert args[0] == "Categories reordered"
    assert kwargs["tracking_set_id"] == set_id
    assert kwargs["count"] == len(cats)


async def test_delete_tracking_set_cascades_to_children(auth_client, db_session):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "To Delete"})
    set_id = create.json()["id"]

    resp = await auth_client.delete(f"{PREFIX}/sets/{set_id}")
    assert resp.status_code == 204

    # Verify DB-level ON DELETE CASCADE actually removed the default categories.
    result = await db_session.execute(
        select(Category).where(Category.tracking_set_id == uuid.UUID(set_id))
    )
    assert result.scalars().all() == []

    get_resp = await auth_client.get(f"{PREFIX}/sets/{set_id}")
    assert get_resp.status_code == 404


async def test_delete_nonexistent_tracking_set_returns_404(auth_client):
    resp = await auth_client.delete(f"{PREFIX}/sets/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation (404, never 403) ─────────────────────────────────────

async def test_cross_user_get_returns_404_not_403(auth_client, auth_client_b):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "A's Private Set"})
    set_id = create.json()["id"]

    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}")
    assert resp.status_code == 404  # never 403 — existence must not leak


async def test_cross_user_update_returns_404(auth_client, auth_client_b):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "A's Set To Protect"})
    set_id = create.json()["id"]

    resp = await auth_client_b.put(f"{PREFIX}/sets/{set_id}", json={"name": "hijacked"})
    assert resp.status_code == 404


async def test_cross_user_delete_returns_404(auth_client, auth_client_b):
    create = await auth_client.post(f"{PREFIX}/sets", json={"name": "A's Set To Keep"})
    set_id = create.json()["id"]

    resp = await auth_client_b.delete(f"{PREFIX}/sets/{set_id}")
    assert resp.status_code == 404

    # Confirm it's genuinely still there for the real owner.
    still_there = await auth_client.get(f"{PREFIX}/sets/{set_id}")
    assert still_there.status_code == 200


# ── Duplicate name conflict ───────────────────────────────────────────────────

async def test_duplicate_name_same_user_returns_409(auth_client):
    await auth_client.post(f"{PREFIX}/sets", json={"name": "Unique Name"})
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": "Unique Name"})
    assert resp.status_code == 409
    assert "detail" in resp.json()


async def test_same_name_different_users_is_allowed(auth_client, auth_client_b):
    resp_a = await auth_client.post(f"{PREFIX}/sets", json={"name": "Shared Name OK"})
    resp_b = await auth_client_b.post(f"{PREFIX}/sets", json={"name": "Shared Name OK"})
    assert resp_a.status_code == 201
    assert resp_b.status_code == 201


# ── Cascade creation: default skeleton, atomicity, rollback ─────────────────

async def test_cascade_creates_full_default_skeleton(auth_client, db_session):
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": "Skeleton Test"})
    assert resp.status_code == 201
    set_id = uuid.UUID(resp.json()["id"])

    cat_result = await db_session.execute(
        select(Category).where(Category.tracking_set_id == set_id).order_by(Category.order_index)
    )
    categories = cat_result.scalars().all()
    assert [c.name for c in categories] == ["Assets", "Liabilities"]
    assert [c.order_index for c in categories] == [1, 2]

    assets_id = categories[0].id
    liabilities_id = categories[1].id

    assets_subs = (
        await db_session.execute(
            select(SubCategory).where(SubCategory.category_id == assets_id).order_by(SubCategory.order_index)
        )
    ).scalars().all()
    assert [s.name for s in assets_subs] == ["Current Assets", "Long-term Investment", "Property"]
    assert [s.order_index for s in assets_subs] == [1, 2, 3]

    liab_subs = (
        await db_session.execute(
            select(SubCategory)
            .where(SubCategory.category_id == liabilities_id)
            .order_by(SubCategory.order_index)
        )
    ).scalars().all()
    assert [s.name for s in liab_subs] == ["Current Liabilities", "Long-term Liabilities"]

    # Total rows created atomically: 1 set + 2 categories + 5 sub-categories = 8
    total_rows = 1 + len(categories) + len(assets_subs) + len(liab_subs)
    assert total_rows == 8


async def test_cascade_defaults_are_fully_editable_and_deletable(auth_client, db_session):
    """Nothing created by the cascade is 'locked' — normal CRUD must work on it."""
    resp = await auth_client.post(f"{PREFIX}/sets", json={"name": "Editable Defaults"})
    set_id = resp.json()["id"]

    cats = await auth_client.get(f"{PREFIX}/sets/{set_id}/categories")
    assets_category = next(c for c in cats.json() if c["name"] == "Assets")

    # Editable
    upd = await auth_client.put(
        f"{PREFIX}/categories/{assets_category['id']}", json={"name": "Renamed Assets"}
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "Renamed Assets"

    # Deletable
    delete_resp = await auth_client.delete(f"{PREFIX}/categories/{assets_category['id']}")
    assert delete_resp.status_code == 204


async def test_cascade_rollback_leaves_no_orphaned_tracking_set(auth_client, db_session):
    """Simulate a mid-cascade failure (duplicate tracking-set name triggers an
    IntegrityError on flush) and verify the transaction rolled back completely
    — no half-created tracking_set/category/sub-category rows survive."""
    first = await auth_client.post(f"{PREFIX}/sets", json={"name": "Rollback Target"})
    assert first.status_code == 201

    before_count = len(
        (await db_session.execute(select(TrackingSet))).scalars().all()
    )

    # Same name for the same user -> unique constraint violation mid-transaction
    conflict = await auth_client.post(f"{PREFIX}/sets", json={"name": "Rollback Target"})
    assert conflict.status_code == 409

    after_count = len(
        (await db_session.execute(select(TrackingSet))).scalars().all()
    )
    assert after_count == before_count  # no orphaned/duplicate row was persisted

    # And the successful first set's own skeleton must still be intact
    # (the failed second attempt must not have corrupted or duplicated it).
    first_id = uuid.UUID(first.json()["id"])
    cats = (
        await db_session.execute(select(Category).where(Category.tracking_set_id == first_id))
    ).scalars().all()
    assert len(cats) == 2
