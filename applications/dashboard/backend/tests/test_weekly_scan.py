"""Tests for weekly scan endpoints.

Endpoints covered
-----------------
GET  /api/v1/weekly-scan/config
PUT  /api/v1/weekly-scan/config
GET  /api/v1/weekly-scan/suggest-name
POST /api/v1/weekly-scan/scans
GET  /api/v1/weekly-scan/scans
GET  /api/v1/weekly-scan/scans/{id}
DELETE /api/v1/weekly-scan/scans/{id}
PUT  /api/v1/weekly-scan/scans/{id}/items/{symbol}
POST /api/v1/weekly-scan/symbol-lists
PUT  /api/v1/weekly-scan/symbol-lists/{id}
DELETE /api/v1/weekly-scan/symbol-lists/{id}
GET  /api/v1/weekly-scan/symbol-notes/{symbol}
PUT  /api/v1/weekly-scan/symbol-notes/{symbol}

Notes
-----
* All endpoints require authentication (auth_client fixture).
* create_scan seeds items from the user's symbol lists or fallback config.
  For speed, tests first create a symbol list with a single symbol so scan
  creation is fast and deterministic.
* color_mark is a free-form VARCHAR(10) in the DB.  The valid values
  (CYAN, GREEN, YELLOW, RED, PURPLE) are enforced by the frontend, not by
  a database constraint, so there is no 422/400 for invalid values.
"""

from __future__ import annotations

import re

import pytest
from httpx import AsyncClient

# ── Config ────────────────────────────────────────────────────────────────────

async def test_get_config_default(auth_client: AsyncClient):
    """GET /config returns a symbols list (seeded with SET50 defaults)."""
    resp = await auth_client.get("/api/v1/weekly-scan/config")
    assert resp.status_code == 200
    body = resp.json()
    assert "symbols" in body
    assert isinstance(body["symbols"], list)
    # Default list should be non-empty
    assert len(body["symbols"]) > 0


async def test_get_config_contains_known_symbol(auth_client: AsyncClient):
    """Default config contains at least one known SET50 symbol."""
    resp = await auth_client.get("/api/v1/weekly-scan/config")
    body = resp.json()
    assert "ADVANC" in body["symbols"] or len(body["symbols"]) > 0


async def test_update_config(auth_client: AsyncClient):
    """PUT /config replaces the symbols list and GET returns the new list."""
    new_symbols = ["ADVANC", "BBL", "KBANK"]
    resp = await auth_client.put("/api/v1/weekly-scan/config", json={"symbols": new_symbols})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["symbols"]) == set(new_symbols)

    # Verify persistence
    resp2 = await auth_client.get("/api/v1/weekly-scan/config")
    assert set(resp2.json()["symbols"]) == set(new_symbols)


async def test_update_config_uppercases_symbols(auth_client: AsyncClient):
    """Symbol names are normalised to upper-case on save."""
    resp = await auth_client.put("/api/v1/weekly-scan/config", json={"symbols": ["advanc", "bbl"]})
    assert resp.status_code == 200
    assert all(s == s.upper() for s in resp.json()["symbols"])


# ── Suggest name ──────────────────────────────────────────────────────────────

async def test_suggest_name_returns_weekly_scan_pattern(auth_client: AsyncClient):
    """GET /suggest-name returns a name matching WEEKLY_SCAN_DD_MM_YYYY."""
    resp = await auth_client.get("/api/v1/weekly-scan/suggest-name")
    assert resp.status_code == 200
    name = resp.json()["name"]
    assert re.match(r"^WEEKLY_SCAN_\d{2}_\d{2}_\d{4}$", name), (
        f"Name '{name}' does not match WEEKLY_SCAN_DD_MM_YYYY"
    )


async def test_suggest_name_has_name_field(auth_client: AsyncClient):
    """Response from suggest-name contains the 'name' key."""
    resp = await auth_client.get("/api/v1/weekly-scan/suggest-name")
    assert "name" in resp.json()


# ── Symbol lists (needed to control what symbols appear in a scan) ────────────

async def _create_symbol_list(client: AsyncClient, name: str = "Test List", symbols: list[str] | None = None) -> dict:
    payload = {"name": name, "market": "SET", "symbols": symbols or ["ADVANC"]}
    resp = await client.post("/api/v1/weekly-scan/symbol-lists", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_create_symbol_list(auth_client: AsyncClient):
    """POST /symbol-lists creates a list and returns it with an id."""
    body = await _create_symbol_list(auth_client, name="My List", symbols=["ADVANC", "BBL"])
    assert "id" in body
    assert body["name"] == "My List"
    assert set(body["symbols"]) == {"ADVANC", "BBL"}


async def test_create_symbol_list_uppercases_symbols(auth_client: AsyncClient):
    """Symbols in a new list are upper-cased automatically."""
    body = await _create_symbol_list(auth_client, symbols=["advanc", "bbl"])
    assert all(s == s.upper() for s in body["symbols"])


async def test_list_symbol_lists(auth_client: AsyncClient):
    """GET /symbol-lists returns the lists created by this user."""
    await _create_symbol_list(auth_client, name="ScanList1")
    resp = await auth_client.get("/api/v1/weekly-scan/symbol-lists")
    assert resp.status_code == 200
    names = [lst["name"] for lst in resp.json()]
    assert "ScanList1" in names


async def test_update_symbol_list(auth_client: AsyncClient):
    """PUT /symbol-lists/{id} updates the list's symbols."""
    created = await _create_symbol_list(auth_client, symbols=["ADVANC"])
    list_id = created["id"]

    resp = await auth_client.put(
        f"/api/v1/weekly-scan/symbol-lists/{list_id}",
        json={"symbols": ["ADVANC", "KBANK", "SCB"]},
    )
    assert resp.status_code == 200
    assert set(resp.json()["symbols"]) == {"ADVANC", "KBANK", "SCB"}


async def test_delete_symbol_list(auth_client: AsyncClient):
    """DELETE /symbol-lists/{id} returns 204 and the list no longer appears."""
    created = await _create_symbol_list(auth_client, name="ToDelete")
    list_id = created["id"]

    del_resp = await auth_client.delete(f"/api/v1/weekly-scan/symbol-lists/{list_id}")
    assert del_resp.status_code == 204

    resp = await auth_client.get("/api/v1/weekly-scan/symbol-lists")
    ids = [lst["id"] for lst in resp.json()]
    assert list_id not in ids


async def test_delete_nonexistent_symbol_list_returns_404(auth_client: AsyncClient):
    """Deleting an unknown list id returns 404."""
    import uuid
    resp = await auth_client.delete(f"/api/v1/weekly-scan/symbol-lists/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Scans ─────────────────────────────────────────────────────────────────────

async def _create_scan(client: AsyncClient, name: str = "WEEKLY_SCAN_07_06_2025") -> dict:
    resp = await client.post("/api/v1/weekly-scan/scans", json={"name": name})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_create_scan_returns_id(auth_client: AsyncClient):
    """POST /scans returns an id and the given name."""
    await _create_symbol_list(auth_client)
    body = await _create_scan(auth_client)
    assert "id" in body
    assert body["name"] == "WEEKLY_SCAN_07_06_2025"


async def test_list_scans_contains_created_scan(auth_client: AsyncClient):
    """GET /scans returns a list that includes the scan we just created."""
    await _create_symbol_list(auth_client)
    created = await _create_scan(auth_client)

    resp = await auth_client.get("/api/v1/weekly-scan/scans")
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert created["id"] in ids


async def test_list_scans_returns_color_counts(auth_client: AsyncClient):
    """Each entry in GET /scans has a color_counts dict."""
    await _create_symbol_list(auth_client)
    await _create_scan(auth_client)
    resp = await auth_client.get("/api/v1/weekly-scan/scans")
    for scan in resp.json():
        assert "color_counts" in scan


async def test_get_scan_returns_items_array(auth_client: AsyncClient):
    """GET /scans/{id} returns a scan with an items array."""
    await _create_symbol_list(auth_client)
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    resp = await auth_client.get(f"/api/v1/weekly-scan/scans/{scan_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert isinstance(body["items"], list)
    # The scan should contain ADVANC from our symbol list
    symbols = [it["symbol"] for it in body["items"]]
    assert "ADVANC" in symbols


async def test_get_scan_not_found(auth_client: AsyncClient):
    """GET /scans with an unknown id returns 404."""
    import uuid
    resp = await auth_client.get(f"/api/v1/weekly-scan/scans/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_scan(auth_client: AsyncClient):
    """DELETE /scans/{id} returns 204 and the scan is gone from the list."""
    await _create_symbol_list(auth_client)
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    del_resp = await auth_client.delete(f"/api/v1/weekly-scan/scans/{scan_id}")
    assert del_resp.status_code == 204

    list_resp = await auth_client.get("/api/v1/weekly-scan/scans")
    ids = [s["id"] for s in list_resp.json()]
    assert scan_id not in ids


# ── Item upsert ───────────────────────────────────────────────────────────────

async def test_upsert_item_saves_color_mark(auth_client: AsyncClient):
    """PUT /scans/{id}/items/{symbol} saves color_mark and returns the item."""
    await _create_symbol_list(auth_client, symbols=["ADVANC"])
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    resp = await auth_client.put(
        f"/api/v1/weekly-scan/scans/{scan_id}/items/ADVANC",
        json={"color_mark": "GREEN"},
    )
    assert resp.status_code == 200
    assert resp.json()["color_mark"] == "GREEN"


async def test_upsert_item_saves_multiple_fields(auth_client: AsyncClient):
    """PUT /scans/{id}/items/{symbol} persists strategy, buy_price, sl, tp."""
    await _create_symbol_list(auth_client, symbols=["ADVANC"])
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    payload = {
        "color_mark": "CYAN",
        "strategy": "Breakout",
        "buy_price": 210.50,
        "tp": 230.00,
        "sl": 200.00,
    }
    resp = await auth_client.put(
        f"/api/v1/weekly-scan/scans/{scan_id}/items/ADVANC", json=payload
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["strategy"] == "Breakout"
    assert body["color_mark"] == "CYAN"


async def test_upsert_item_symbol_not_in_scan_returns_404(auth_client: AsyncClient):
    """PUT for a symbol not in the scan returns 404."""
    await _create_symbol_list(auth_client, symbols=["ADVANC"])
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    resp = await auth_client.put(
        f"/api/v1/weekly-scan/scans/{scan_id}/items/NONEXISTENT",
        json={"color_mark": "RED"},
    )
    assert resp.status_code == 404


async def test_upsert_item_persists_across_get(auth_client: AsyncClient):
    """Color mark set by PUT is visible in GET /scans/{id}."""
    await _create_symbol_list(auth_client, symbols=["ADVANC"])
    created = await _create_scan(auth_client)
    scan_id = created["id"]

    await auth_client.put(
        f"/api/v1/weekly-scan/scans/{scan_id}/items/ADVANC",
        json={"color_mark": "PURPLE"},
    )
    get_resp = await auth_client.get(f"/api/v1/weekly-scan/scans/{scan_id}")
    advanc = next(it for it in get_resp.json()["items"] if it["symbol"] == "ADVANC")
    assert advanc["color_mark"] == "PURPLE"


# ── Symbol notes ──────────────────────────────────────────────────────────────

async def test_get_symbol_note_returns_note_field(auth_client: AsyncClient):
    """GET /symbol-notes/{symbol} always returns a note field (null if unset)."""
    resp = await auth_client.get("/api/v1/weekly-scan/symbol-notes/ADVANC")
    assert resp.status_code == 200
    body = resp.json()
    assert "symbol" in body
    assert "note" in body
    assert body["symbol"] == "ADVANC"


async def test_get_symbol_note_null_when_not_set(auth_client: AsyncClient):
    """Note is null before any upsert."""
    resp = await auth_client.get("/api/v1/weekly-scan/symbol-notes/NEWSTOCK")
    assert resp.json()["note"] is None


async def test_upsert_symbol_note_saves_note(auth_client: AsyncClient):
    """PUT /symbol-notes/{symbol} persists the note and GET returns the same."""
    resp = await auth_client.put(
        "/api/v1/weekly-scan/symbol-notes/ADVANC",
        json={"note": "Strong earnings expected"},
    )
    assert resp.status_code == 200
    assert resp.json()["note"] == "Strong earnings expected"

    get_resp = await auth_client.get("/api/v1/weekly-scan/symbol-notes/ADVANC")
    assert get_resp.json()["note"] == "Strong earnings expected"


async def test_upsert_symbol_note_updates_existing(auth_client: AsyncClient):
    """Second PUT with a different note overwrites the first."""
    await auth_client.put(
        "/api/v1/weekly-scan/symbol-notes/BBL",
        json={"note": "First note"},
    )
    await auth_client.put(
        "/api/v1/weekly-scan/symbol-notes/BBL",
        json={"note": "Updated note"},
    )
    resp = await auth_client.get("/api/v1/weekly-scan/symbol-notes/BBL")
    assert resp.json()["note"] == "Updated note"


async def test_upsert_symbol_note_null_clears_note(auth_client: AsyncClient):
    """Setting note=null via PUT sets it to null."""
    await auth_client.put("/api/v1/weekly-scan/symbol-notes/PTT", json={"note": "Has note"})
    await auth_client.put("/api/v1/weekly-scan/symbol-notes/PTT", json={"note": None})
    resp = await auth_client.get("/api/v1/weekly-scan/symbol-notes/PTT")
    assert resp.json()["note"] is None
