"""Tracking Item CRUD, type resolution via `typeId` (ADR-027), ownership
isolation, and reorder.

Type is a row reference now: the create/update request field is `typeId`
(uuid), resolved against `ft_item_type`. Unknown -> 404; archived on create
or switch-to-archived on update -> 400; keeping an already-assigned archived
type -> allowed (Phase-1 BR). The response embeds `itemType` and keeps a
`type` label string during the transition window.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.item_type import SYSTEM_ITEM_TYPE_SEED

PREFIX = "/api/v1/tracking"

_SEED_LABELS = [row["label"] for row in SYSTEM_ITEM_TYPE_SEED]


async def _make_sub_category(client, set_name="Set", cat_name="Cat", sub_name="Sub"):
    set_id = (await client.post(f"{PREFIX}/sets", json={"name": set_name})).json()["id"]
    cat_id = (
        await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": cat_name})
    ).json()["id"]
    sub_id = (
        await client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": sub_name})
    ).json()["id"]
    return sub_id


async def _make_archived_type(admin_client, label: str) -> str:
    """Create a custom type and archive it; return its id."""
    created = await admin_client.post(f"{PREFIX}/item-types", json={"label": label})
    assert created.status_code == 201, created.text
    tid = created.json()["id"]
    archived = await admin_client.put(f"{PREFIX}/item-types/{tid}/archive")
    assert archived.status_code == 200, archived.text
    return tid


@pytest.mark.parametrize("row", SYSTEM_ITEM_TYPE_SEED, ids=[r["slug"] for r in SYSTEM_ITEM_TYPE_SEED])
async def test_create_tracking_item_accepts_every_seeded_type(auth_client, row):
    sub_id = await _make_sub_category(
        auth_client, f"S-{row['slug']}", f"C-{row['slug']}", f"Sub-{row['slug']}"
    )
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Item", "typeId": row["id"]},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["typeId"] == row["id"]
    assert body["type"] == row["label"]  # transition-window label field
    assert body["itemType"]["slug"] == row["slug"]
    assert body["itemType"]["label"] == row["label"]
    assert sorted(body["itemType"]["capabilities"]) == sorted(row["capabilities"])


async def test_create_tracking_item_unknown_type_id_returns_404(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-unknown", "C-unknown", "Sub-unknown")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Bad Item", "typeId": str(uuid.uuid4())},
    )
    assert resp.status_code == 404


async def test_create_tracking_item_missing_type_id_returns_422(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-missing", "C-missing", "Sub-missing")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "No Type"}
    )
    assert resp.status_code == 422


async def test_create_tracking_item_archived_type_rejected_400(auth_client, admin_client):
    archived_id = await _make_archived_type(admin_client, f"Archived-{uuid.uuid4()}")
    sub_id = await _make_sub_category(auth_client, "S-arch", "C-arch", "Sub-arch")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Item", "typeId": archived_id},
    )
    assert resp.status_code == 400


async def test_create_tracking_item_full_fields(auth_client):
    sub_id = await _make_sub_category(auth_client, "S-full", "C-full", "Sub-full")
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={
            "name": "Savings",
            "typeId": SYSTEM_ITEM_TYPE_SEED[0]["id"],  # Bank account
            "initialInvestmentTracking": True,
            "exclusive": True,
            "description": "main savings",
            "accountName": "1234567890",
            "remark": "note",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["initialInvestmentTracking"] is True
    assert body["exclusive"] is True
    assert body["accountName"] == "1234567890"
    assert body["subCategoryId"] == sub_id


async def test_create_tracking_item_on_nonexistent_sub_category_returns_404(auth_client):
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{uuid.uuid4()}/items",
        json={"name": "Orphan", "typeId": SYSTEM_ITEM_TYPE_SEED[1]["id"]},
    )
    assert resp.status_code == 404


async def test_get_update_delete_tracking_item(auth_client):
    materials = next(r for r in SYSTEM_ITEM_TYPE_SEED if r["slug"] == "materials")
    insurance = next(r for r in SYSTEM_ITEM_TYPE_SEED if r["slug"] == "insurance")
    sub_id = await _make_sub_category(auth_client, "S-crud", "C-crud", "Sub-crud")
    create = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Temp Item", "typeId": materials["id"]},
    )
    item_id = create.json()["id"]

    get_resp = await auth_client.get(f"{PREFIX}/items/{item_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["itemType"]["slug"] == "materials"

    upd = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"remark": "updated remark"})
    assert upd.status_code == 200
    assert upd.json()["remark"] == "updated remark"
    assert upd.json()["type"] == "Materials"  # untouched

    upd_type = await auth_client.put(
        f"{PREFIX}/items/{item_id}", json={"typeId": insurance["id"]}
    )
    assert upd_type.status_code == 200
    assert upd_type.json()["type"] == "Insurance"
    assert upd_type.json()["typeId"] == insurance["id"]
    assert upd_type.json()["itemType"]["slug"] == "insurance"

    bad_type = await auth_client.put(
        f"{PREFIX}/items/{item_id}", json={"typeId": str(uuid.uuid4())}
    )
    assert bad_type.status_code == 404

    delete_resp = await auth_client.delete(f"{PREFIX}/items/{item_id}")
    assert delete_resp.status_code == 204

    gone = await auth_client.get(f"{PREFIX}/items/{item_id}")
    assert gone.status_code == 404


async def test_update_switch_to_archived_type_rejected_400(auth_client, admin_client):
    archived_id = await _make_archived_type(admin_client, f"ArchSwitch-{uuid.uuid4()}")
    sub_id = await _make_sub_category(auth_client, "S-sw", "C-sw", "Sub-sw")
    item_id = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items",
            json={"name": "Item", "typeId": SYSTEM_ITEM_TYPE_SEED[0]["id"]},
        )
    ).json()["id"]

    resp = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"typeId": archived_id})
    assert resp.status_code == 400


async def test_update_keeping_already_archived_type_is_allowed(auth_client, admin_client):
    """An item assigned a type that is LATER archived can still be updated
    (other fields) — the archived type is kept, not switched (Phase-1 BR)."""
    custom = await admin_client.post(
        f"{PREFIX}/item-types", json={"label": f"KeepArch-{uuid.uuid4()}"}
    )
    tid = custom.json()["id"]
    sub_id = await _make_sub_category(auth_client, "S-keep", "C-keep", "Sub-keep")
    item_id = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items",
            json={"name": "Item", "typeId": tid},
        )
    ).json()["id"]

    archived = await admin_client.put(f"{PREFIX}/item-types/{tid}/archive")
    assert archived.status_code == 200

    # Update an unrelated field — typeId omitted -> the archived type is kept.
    resp = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["typeId"] == tid

    # Re-sending the SAME (archived) typeId is a no-op, not a switch -> allowed.
    resp2 = await auth_client.put(f"{PREFIX}/items/{item_id}", json={"typeId": tid})
    assert resp2.status_code == 200


async def test_tracking_item_not_found_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/items/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Ownership isolation ───────────────────────────────────────────────────────

async def test_cross_user_tracking_item_access_returns_404(auth_client, auth_client_b):
    sub_id = await _make_sub_category(auth_client, "Priv Set 3", "Priv Cat 3", "Priv Sub 3")
    create = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": "Private Item", "typeId": SYSTEM_ITEM_TYPE_SEED[3]["id"]},
    )
    item_id = create.json()["id"]

    assert (await auth_client_b.get(f"{PREFIX}/items/{item_id}")).status_code == 404
    assert (
        await auth_client_b.put(f"{PREFIX}/items/{item_id}", json={"name": "x"})
    ).status_code == 404
    assert (await auth_client_b.delete(f"{PREFIX}/items/{item_id}")).status_code == 404


async def test_cross_user_cannot_list_items_of_others_sub_category(auth_client, auth_client_b):
    sub_id = await _make_sub_category(auth_client, "Hidden Set 3", "Hidden Cat 3", "Hidden Sub 3")
    resp = await auth_client_b.get(f"{PREFIX}/sub-categories/{sub_id}/items")
    assert resp.status_code == 404


# ── Reorder ────────────────────────────────────────────────────────────────────

async def test_reorder_tracking_items_atomic(auth_client):
    prop_id = SYSTEM_ITEM_TYPE_SEED[1]["id"]
    sub_id = await _make_sub_category(auth_client, "Reorder Set 3", "Reorder Cat 3", "Reorder Sub 3")
    a = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "A", "typeId": prop_id}
        )
    ).json()
    b = (
        await auth_client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "B", "typeId": prop_id}
        )
    ).json()

    resp = await auth_client.put(
        f"{PREFIX}/sub-categories/{sub_id}/items/reorder",
        json={"items": [{"id": a["id"], "order": 9}, {"id": b["id"], "order": 1}]},
    )
    assert resp.status_code == 200

    after = (await auth_client.get(f"{PREFIX}/sub-categories/{sub_id}/items")).json()
    assert [i["name"] for i in after] == ["B", "A"]


async def test_reorder_tracking_items_rejects_foreign_id(auth_client, auth_client_b):
    prop_id = SYSTEM_ITEM_TYPE_SEED[1]["id"]
    sub_id = await _make_sub_category(auth_client, "Guard Set 2", "Guard Cat 2", "Guard Sub 2")
    other_sub_id = await _make_sub_category(auth_client_b, "Other Set 2", "Other Cat 2", "Other Sub 2")
    other_item = (
        await auth_client_b.post(
            f"{PREFIX}/sub-categories/{other_sub_id}/items",
            json={"name": "Foreign", "typeId": prop_id},
        )
    ).json()

    resp = await auth_client.put(
        f"{PREFIX}/sub-categories/{sub_id}/items/reorder",
        json={"items": [{"id": other_item["id"], "order": 1}]},
    )
    assert resp.status_code == 400
