"""Configurable tracking-item type registry — `/api/v1/tracking/item-types`
(ADR-027, design §E).

GET is open to any authenticated tracker user; every mutation requires the
signed JWT `role == "admin"` (OQ-3). Covers the admin rule matrix: no delete
of a system type, no delete of an in-use custom type, delete OK for a
zero-item custom type, system capabilities locked, `bond_register` never
grantable, cannot archive the last active type, label uniqueness / length,
reorder completeness, and `counts_as_property` grantable to custom types.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.item_type import SYSTEM_ITEM_TYPE_IDS

PREFIX = "/api/v1/tracking"
IT = f"{PREFIX}/item-types"

PROPERTY_ID = SYSTEM_ITEM_TYPE_IDS["Property"]
BOND_ID = SYSTEM_ITEM_TYPE_IDS["BOND"]
BANK_ID = SYSTEM_ITEM_TYPE_IDS["Bank account"]


async def _new_label(prefix: str = "Custom") -> str:
    return f"{prefix}-{uuid.uuid4()}"


async def _make_item_of_type(auth_client, type_id: str) -> str:
    set_id = (await auth_client.post(f"{PREFIX}/sets", json={"name": f"S-{uuid.uuid4()}"})).json()["id"]
    cat_id = (
        await auth_client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "C"})
    ).json()["id"]
    sub_id = (
        await auth_client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Sub"})
    ).json()["id"]
    resp = await auth_client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items", json={"name": "I", "typeId": type_id}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ── GET list ──────────────────────────────────────────────────────────────


async def test_list_item_types_open_to_any_authed_user(auth_client):
    resp = await auth_client.get(IT)
    assert resp.status_code == 200
    assert resp.headers.get("cache-control") == "private, max-age=60"
    rows = resp.json()
    slugs = {r["slug"] for r in rows}
    assert {"bank_account", "property", "investment_account", "tax_saving",
            "materials", "insurance", "bond"} <= slugs
    prop = next(r for r in rows if r["slug"] == "property")
    assert prop["isSystem"] is True
    assert prop["capabilities"] == ["counts_as_property"]
    assert "itemCount" in prop
    # ordered by sortOrder asc
    orders = [r["sortOrder"] for r in rows]
    assert orders == sorted(orders)


async def test_list_unauthenticated_401(client):
    assert (await client.get(IT)).status_code == 401


async def test_list_excludes_archived_by_default_but_includes_with_flag(admin_client):
    created = await admin_client.post(IT, json={"label": await _new_label("Arc")})
    tid = created.json()["id"]
    await admin_client.put(f"{IT}/{tid}/archive")

    default = await admin_client.get(IT)
    assert tid not in {r["id"] for r in default.json()}

    incl = await admin_client.get(IT, params={"includeArchived": "true"})
    assert tid in {r["id"] for r in incl.json()}


async def test_item_count_reflects_assigned_items(admin_client, auth_client):
    created = await admin_client.post(IT, json={"label": await _new_label("Counted")})
    tid = created.json()["id"]
    await _make_item_of_type(auth_client, tid)
    await _make_item_of_type(auth_client, tid)

    rows = (await admin_client.get(IT)).json()
    row = next(r for r in rows if r["id"] == tid)
    assert row["itemCount"] == 2


# ── Admin gate ────────────────────────────────────────────────────────────


async def test_non_admin_cannot_mutate(auth_client):
    # auth_client's token carries NO role claim -> 403 on every write.
    assert (await auth_client.post(IT, json={"label": "X"})).status_code == 403
    assert (await auth_client.put(f"{IT}/{PROPERTY_ID}", json={"label": "Y"})).status_code == 403
    assert (await auth_client.put(f"{IT}/{PROPERTY_ID}/archive")).status_code == 403
    assert (await auth_client.put(f"{IT}/{PROPERTY_ID}/unarchive")).status_code == 403
    assert (await auth_client.put(f"{IT}/order", json={"items": []})).status_code == 403
    assert (await auth_client.delete(f"{IT}/{PROPERTY_ID}")).status_code == 403


# ── Create ────────────────────────────────────────────────────────────────


async def test_create_custom_type_minimal(admin_client):
    label = await _new_label("Crypto")
    resp = await admin_client.post(IT, json={"label": label})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["label"] == label
    assert body["isSystem"] is False
    assert body["isArchived"] is False
    assert body["capabilities"] == []
    assert body["slug"] and all(c.islower() or c.isdigit() or c == "_" for c in body["slug"])


async def test_create_with_counts_as_property_capability(admin_client, auth_client):
    label = await _new_label("Land")
    resp = await admin_client.post(
        IT, json={"label": label, "capabilities": ["counts_as_property"]}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["capabilities"] == ["counts_as_property"]


async def test_create_rejects_bond_register_capability_422(admin_client):
    resp = await admin_client.post(
        IT, json={"label": await _new_label("FakeBond"), "capabilities": ["bond_register"]}
    )
    assert resp.status_code == 422


async def test_create_rejects_unknown_capability_422(admin_client):
    resp = await admin_client.post(
        IT, json={"label": await _new_label("Weird"), "capabilities": ["teleport"]}
    )
    assert resp.status_code == 422


async def test_create_duplicate_label_case_insensitive_409(admin_client):
    label = await _new_label("Dup")
    assert (await admin_client.post(IT, json={"label": label})).status_code == 201
    assert (await admin_client.post(IT, json={"label": label.upper()})).status_code == 409
    assert (await admin_client.post(IT, json={"label": f"  {label}  "})).status_code == 409


async def test_create_blank_label_422(admin_client):
    for bad in ("", "   ", "\t\n"):
        assert (await admin_client.post(IT, json={"label": bad})).status_code == 422


async def test_create_label_over_100_chars_422(admin_client):
    assert (await admin_client.post(IT, json={"label": "L" * 101})).status_code == 422


async def test_create_label_exactly_100_chars_ok(admin_client):
    label = "L" * 96 + hex(uuid.uuid4().int)[2:6]  # 100 chars, unique-ish
    resp = await admin_client.post(IT, json={"label": label[:100]})
    assert resp.status_code == 201, resp.text


async def test_create_sending_slug_is_422(admin_client):
    resp = await admin_client.post(
        IT, json={"label": await _new_label("Slugged"), "slug": "hacked"}
    )
    assert resp.status_code == 422


async def test_slug_collision_gets_numeric_suffix(admin_client):
    resp1 = await admin_client.post(IT, json={"label": "Crypto Assets"})
    resp2 = await admin_client.post(IT, json={"label": "Crypto-Assets"})
    assert resp1.status_code == 201 and resp2.status_code == 201
    s1, s2 = resp1.json()["slug"], resp2.json()["slug"]
    assert s1 == "crypto_assets"
    assert s2 == "crypto_assets_2"


# ── Update ────────────────────────────────────────────────────────────────


async def test_rename_system_type_allowed_and_syncs_denormalised_type(
    admin_client, auth_client
):
    item_id = await _make_item_of_type(auth_client, SYSTEM_ITEM_TYPE_IDS["Materials"])
    mat_id = SYSTEM_ITEM_TYPE_IDS["Materials"]
    try:
        resp = await admin_client.put(f"{IT}/{mat_id}", json={"label": "Supplies"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["label"] == "Supplies"
        assert resp.json()["slug"] == "materials"  # slug immutable

        got = await auth_client.get(f"{PREFIX}/items/{item_id}")
        assert got.json()["type"] == "Supplies"  # denormalised column followed the rename
        assert got.json()["itemType"]["label"] == "Supplies"
    finally:
        restore = await admin_client.put(f"{IT}/{mat_id}", json={"label": "Materials"})
        assert restore.status_code == 200


async def test_update_system_type_capabilities_422(admin_client):
    resp = await admin_client.put(
        f"{IT}/{PROPERTY_ID}", json={"capabilities": ["counts_as_property"]}
    )
    assert resp.status_code == 422


async def test_update_grant_counts_as_property_to_custom_type(admin_client):
    tid = (await admin_client.post(IT, json={"label": await _new_label("Grant")})).json()["id"]
    resp = await admin_client.put(f"{IT}/{tid}", json={"capabilities": ["counts_as_property"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["capabilities"] == ["counts_as_property"]

    cleared = await admin_client.put(f"{IT}/{tid}", json={"capabilities": []})
    assert cleared.status_code == 200
    assert cleared.json()["capabilities"] == []


async def test_update_grant_bond_register_to_any_type_422(admin_client):
    tid = (await admin_client.post(IT, json={"label": await _new_label("NoBond")})).json()["id"]
    assert (
        await admin_client.put(f"{IT}/{tid}", json={"capabilities": ["bond_register"]})
    ).status_code == 422
    # not even onto the system bond type (which already has it)
    assert (
        await admin_client.put(f"{IT}/{BOND_ID}", json={"capabilities": ["bond_register"]})
    ).status_code == 422


async def test_update_duplicate_label_409(admin_client):
    a = await _new_label("A")
    b = await _new_label("B")
    await admin_client.post(IT, json={"label": a})
    tid_b = (await admin_client.post(IT, json={"label": b})).json()["id"]
    assert (await admin_client.put(f"{IT}/{tid_b}", json={"label": a})).status_code == 409
    # renaming to its own current label is fine (excludes self)
    assert (await admin_client.put(f"{IT}/{tid_b}", json={"label": b})).status_code == 200


async def test_update_sending_slug_422(admin_client):
    tid = (await admin_client.post(IT, json={"label": await _new_label("Sx")})).json()["id"]
    assert (await admin_client.put(f"{IT}/{tid}", json={"slug": "x"})).status_code == 422


async def test_update_unknown_id_404(admin_client):
    assert (
        await admin_client.put(f"{IT}/{uuid.uuid4()}", json={"label": "Z"})
    ).status_code == 404


# ── Archive / unarchive ──────────────────────────────────────────────────


async def test_archive_unarchive_roundtrip_idempotent(admin_client):
    tid = (await admin_client.post(IT, json={"label": await _new_label("Arch")})).json()["id"]
    assert (await admin_client.put(f"{IT}/{tid}/archive")).json()["isArchived"] is True
    assert (await admin_client.put(f"{IT}/{tid}/archive")).status_code == 200  # idempotent
    assert (await admin_client.put(f"{IT}/{tid}/unarchive")).json()["isArchived"] is False
    assert (await admin_client.put(f"{IT}/{tid}/unarchive")).status_code == 200


async def test_cannot_archive_the_last_active_type_409(admin_client):
    """Archive every active type but one, then assert the last archive 409s.
    Everything is restored afterwards so the rest of the suite is unaffected."""
    active = [r for r in (await admin_client.get(IT)).json()]
    ids = [r["id"] for r in active]
    archived_now: list[str] = []
    try:
        for tid in ids[:-1]:
            resp = await admin_client.put(f"{IT}/{tid}/archive")
            assert resp.status_code == 200, resp.text
            archived_now.append(tid)
        last = ids[-1]
        resp = await admin_client.put(f"{IT}/{last}/archive")
        assert resp.status_code == 409
    finally:
        for tid in archived_now:
            await admin_client.put(f"{IT}/{tid}/unarchive")


# ── Delete ───────────────────────────────────────────────────────────────


async def test_cannot_delete_system_type_409(admin_client):
    assert (await admin_client.delete(f"{IT}/{PROPERTY_ID}")).status_code == 409


async def test_cannot_delete_in_use_custom_type_409(admin_client, auth_client):
    tid = (await admin_client.post(IT, json={"label": await _new_label("InUse")})).json()["id"]
    await _make_item_of_type(auth_client, tid)
    assert (await admin_client.delete(f"{IT}/{tid}")).status_code == 409


async def test_delete_zero_item_custom_type_204(admin_client):
    tid = (
        await admin_client.post(
            IT, json={"label": await _new_label("Ghost"), "capabilities": ["counts_as_property"]}
        )
    ).json()["id"]
    assert (await admin_client.delete(f"{IT}/{tid}")).status_code == 204
    # gone
    assert (await admin_client.put(f"{IT}/{tid}", json={"label": "Z"})).status_code == 404


# ── Reorder ──────────────────────────────────────────────────────────────


async def test_reorder_requires_every_id_400_on_partial(admin_client):
    all_rows = (await admin_client.get(IT, params={"includeArchived": "true"})).json()
    partial = [{"id": all_rows[0]["id"], "order": 0}]
    assert (await admin_client.put(f"{IT}/order", json={"items": partial})).status_code == 400


async def test_reorder_rewrites_sort_order(admin_client):
    all_rows = (await admin_client.get(IT, params={"includeArchived": "true"})).json()
    ids = [r["id"] for r in all_rows]
    original = {r["id"]: r["sortOrder"] for r in all_rows}
    n = len(ids)
    payload = {"items": [{"id": tid, "order": n - 1 - i} for i, tid in enumerate(ids)]}
    resp = await admin_client.put(f"{IT}/order", json=payload)
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    try:
        after = (await admin_client.get(IT, params={"includeArchived": "true"})).json()
        assert [r["id"] for r in after] == list(reversed(ids))
    finally:
        restore = {"items": [{"id": tid, "order": o} for tid, o in original.items()]}
        assert (await admin_client.put(f"{IT}/order", json=restore)).status_code == 200
