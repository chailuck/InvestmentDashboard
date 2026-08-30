"""`note` field on Initial Investment Entries (ADR-018): verbatim storage
(incl. Thai text), blank/whitespace -> NULL coercion, max-length rejection,
presence-aware update (clear via null or blank; omitted keys untouched;
amount/entryDate still reject explicit null), and that `note` surfaces on
the list and running-total projections. Plus one model-level round-trip
proving the migration column persists.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models.initial_investment_entry import InitialInvestmentEntry

PREFIX = "/api/v1/tracking"

_THAI = "เงินโบนัส"


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


async def test_create_entry_stores_note_verbatim_including_thai(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "note": _THAI}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["note"] == _THAI


async def test_create_entry_without_note_is_null(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15"})
    assert resp.status_code == 201
    assert resp.json()["note"] is None


async def test_create_entry_blank_and_whitespace_note_coerced_to_null(auth_client):
    item_id = await _make_item(auth_client)
    for blank in ("", "   ", "\t\n  "):
        resp = await _create_entry(
            auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "note": blank}
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["note"] is None


async def test_create_entry_note_preserves_meaningful_surrounding_whitespace(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "note": "  sold half  "}
    )
    assert resp.status_code == 201
    assert resp.json()["note"] == "  sold half  "  # not stripped — only all-blank becomes NULL


async def test_create_entry_note_over_500_chars_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "note": "x" * 501}
    )
    assert resp.status_code == 422


async def test_create_entry_note_exactly_500_chars_accepted(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_entry(
        auth_client, item_id, {"amount": "100", "entryDate": "2026-01-15", "note": "x" * 500}
    )
    assert resp.status_code == 201
    assert resp.json()["note"] == "x" * 500


# ── Update (presence-aware) ──────────────────────────────────────────────────


async def _seed_entry(client, item_id: str, note: str | None = "original"):
    body = {"amount": "42", "entryDate": "2026-01-01"}
    if note is not None:
        body["note"] = note
    return (await _create_entry(client, item_id, body)).json()


async def test_update_note_only_leaves_amount_and_date_untouched(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, note="before")

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"note": "after"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["note"] == "after"
    assert body["amount"] == "42.0000"
    assert body["entryDate"] == "2026-01-01"


async def test_update_clear_note_via_explicit_null(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, note="something")

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"note": None})
    assert resp.status_code == 200
    assert resp.json()["note"] is None


async def test_update_clear_note_via_blank_string(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, note="something")

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"note": "   "})
    assert resp.status_code == 200
    assert resp.json()["note"] is None


async def test_update_omitting_note_leaves_it_untouched(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id, note="keep me")

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"amount": "99"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["amount"] == "99.0000"
    assert body["note"] == "keep me"


async def test_update_amount_explicit_null_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id)

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"amount": None})
    assert resp.status_code == 422


async def test_update_entry_date_explicit_null_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id)

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"entryDate": None})
    assert resp.status_code == 422


async def test_update_note_over_500_chars_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    entry = await _seed_entry(auth_client, item_id)

    resp = await auth_client.put(f"{PREFIX}/entries/{entry['id']}", json={"note": "y" * 501})
    assert resp.status_code == 422


# ── Projections carry the note ──────────────────────────────────────────────


async def test_list_entries_includes_note(auth_client):
    item_id = await _make_item(auth_client)
    await _create_entry(
        auth_client, item_id, {"amount": "10", "entryDate": "2026-01-01", "note": _THAI}
    )
    await _create_entry(auth_client, item_id, {"amount": "20", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/entries")
    assert resp.status_code == 200
    rows = resp.json()
    notes = {r["entryDate"]: r["note"] for r in rows}
    assert notes == {"2026-01-01": _THAI, "2026-02-01": None}


async def test_running_total_rows_include_note(auth_client):
    item_id = await _make_item(auth_client)
    await _create_entry(
        auth_client, item_id, {"amount": "10", "entryDate": "2026-01-01", "note": "first"}
    )
    await _create_entry(auth_client, item_id, {"amount": "20", "entryDate": "2026-02-01"})

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/running-total")
    assert resp.status_code == 200
    rows = resp.json()["entries"]
    assert [r["note"] for r in rows] == ["first", None]


# ── Model-level round-trip (proves the migration column maps + persists) ────


async def test_note_round_trips_through_the_orm_model(auth_client, db_session):
    """The API create above already proves DB persistence; this additionally
    proves the SQLAlchemy model reads the column back (not just the response
    schema)."""
    item_id = await _make_item(auth_client)
    created = await _create_entry(
        auth_client, item_id, {"amount": "5", "entryDate": "2026-03-03", "note": _THAI}
    )
    entry_id = uuid.UUID(created.json()["id"])

    row = (
        await db_session.execute(
            select(InitialInvestmentEntry).where(InitialInvestmentEntry.id == entry_id)
        )
    ).scalar_one()
    assert row.note == _THAI

    # And a whitespace-only note stored NULL, not the raw spaces.
    created_blank = await _create_entry(
        auth_client, item_id, {"amount": "6", "entryDate": "2026-03-04", "note": "   "}
    )
    blank_id = uuid.UUID(created_blank.json()["id"])
    blank_row = (
        await db_session.execute(
            select(InitialInvestmentEntry).where(InitialInvestmentEntry.id == blank_id)
        )
    ).scalar_one()
    assert blank_row.note is None
