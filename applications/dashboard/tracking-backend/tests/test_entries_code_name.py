"""`code` / `name` free-text labels on Initial Investment Entries (BOND
register / ledger CODE/NAME feature).

Same posture as `note` (see test_entry_notes.py): verbatim storage incl. Thai
text, blank/whitespace -> NULL coercion, max-length (100) rejection,
presence-aware update (clear via null or blank; omitted keys untouched), and
surfacing on the list + running-total projections.
"""

from __future__ import annotations

import uuid

PREFIX = "/api/v1/tracking"

_THAI = "พันธบัตรรัฐบาล"


async def _make_item(client, *, tracking_enabled: bool = True, name="Item") -> str:
    set_id = (await client.post(f"{PREFIX}/sets", json={"name": f"Set-{uuid.uuid4()}"})).json()["id"]
    cat_id = (
        await client.post(f"{PREFIX}/sets/{set_id}/categories", json={"name": "Cat"})
    ).json()["id"]
    sub_id = (
        await client.post(f"{PREFIX}/categories/{cat_id}/sub-categories", json={"name": "Sub"})
    ).json()["id"]
    item = (
        await client.post(
            f"{PREFIX}/sub-categories/{sub_id}/items",
            json={
                "name": name,
                "type": "Investment Account",
                "initialInvestmentTracking": tracking_enabled,
            },
        )
    ).json()
    return item["id"]


async def _create_entry(client, item_id: str, payload: dict):
    return await client.post(f"{PREFIX}/items/{item_id}/entries", json=payload)


# ── Create ────────────────────────────────────────────────────────────────────


async def test_create_entry_with_code_and_name(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client,
        item_id,
        {"amount": "100", "entryDate": "2026-01-15", "code": "TH0623A", "name": "Gov Bond 2026"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["code"] == "TH0623A"
    assert body["name"] == "Gov Bond 2026"


async def test_create_entry_without_code_name_is_null(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] is None
    assert body["name"] is None


async def test_create_entry_blank_code_name_coerced_to_null(auth_client):
    item_id = await _make_item(auth_client)
    for blank in ("", "   ", "\t\n  "):
        resp = await _create_entry(
            auth_client,
            item_id,
            {"amount": "100", "entryDate": "2026-01-15", "code": blank, "name": blank},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["code"] is None
        assert body["name"] is None


async def test_create_entry_code_name_over_100_chars_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    r1 = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "code": "x" * 101}
    )
    assert r1.status_code == 422
    r2 = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "name": "y" * 101}
    )
    assert r2.status_code == 422


async def test_create_entry_code_name_exactly_100_chars_accepted(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client,
        item_id,
        {"amount": "100", "entryDate": "2026-01-15", "code": "x" * 100, "name": "y" * 100},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == "x" * 100
    assert body["name"] == "y" * 100


async def test_create_entry_code_name_thai_round_trips_verbatim(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client,
        item_id,
        {"amount": "100", "entryDate": "2026-01-15", "code": _THAI, "name": f"  {_THAI}  "},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == _THAI
    assert body["name"] == f"  {_THAI}  "  # surrounding whitespace preserved (not all-blank)


# ── Update (presence-aware) ──────────────────────────────────────────────────


async def _seed_entry(client, item_id: str, **labels):
    body = {"amount": "42", "entryDate": "2026-01-01"}
    body.update(labels)
    return (await _create_entry(client, item_id, body)).json()


async def test_update_code_name_only_leaves_amount_and_date_untouched(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, code="before", name="before-name")

    resp = await auth_client.put(
        f"{PREFIX}/entries/{entry['id']}", json={"code": "after", "name": "after-name"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == "after"
    assert body["name"] == "after-name"
    assert body["amount"] == "42.0000"
    assert body["entryDate"] == "2026-01-01"


async def test_update_clear_code_name_via_explicit_null(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, code="something", name="something")

    resp = await auth_client.put(
        f"{PREFIX}/entries/{entry['id']}", json={"code": None, "name": None}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] is None
    assert body["name"] is None


async def test_update_clear_code_name_via_blank_string(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, code="something", name="something")

    resp = await auth_client.put(
        f"{PREFIX}/entries/{entry['id']}", json={"code": "   ", "name": "\t"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] is None
    assert body["name"] is None


async def test_update_omitting_code_name_leaves_them_untouched(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, code="keep", name="keep-name")

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"amount": "99"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["amount"] == "99.0000"
    assert body["code"] == "keep"
    assert body["name"] == "keep-name"


async def test_update_code_over_100_chars_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id)
    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"code": "z" * 101})
    assert resp.status_code == 422


# ── Projections carry code / name ──────────────────────────────────────────


async def test_list_entries_includes_code_and_name(auth_client):
    item_id = await _make_item(auth_client)
    await _create_entry(
        auth_client,
        item_id,
        {"amount": "10", "entryDate": "2026-01-01", "code": "C1", "name": "N1"},
    )
    await _create_entry(auth_client, item_id, {"amount": "20", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/entries")
    assert resp.status_code == 200
    rows = resp.json()
    by_date = {r["entryDate"]: (r["code"], r["name"]) for r in rows}
    assert by_date == {"2026-01-01": ("C1", "N1"), "2026-02-01": (None, None)}


async def test_running_total_rows_include_code_and_name(auth_client):
    item_id = await _make_item(auth_client)
    await _create_entry(
        auth_client,
        item_id,
        {"amount": "10", "entryDate": "2026-01-01", "code": "first", "name": "first-name"},
    )
    await _create_entry(auth_client, item_id, {"amount": "20", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200
    rows = resp.json()["entries"]
    assert [(r["code"], r["name"]) for r in rows] == [("first", "first-name"), (None, None)]
