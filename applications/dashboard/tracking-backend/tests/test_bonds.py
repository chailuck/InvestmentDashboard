"""BOND register API — CRUD, validation, read-time status derivation,
presence-aware update, type-gating, cross-user ownership isolation, and
FK cascade.

Scope: standalone register only — no rollup / balance-grid / export
assertions here (a bond never contributes to an aggregate).
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.bond import Bond
from app.models.item_type import SYSTEM_ITEM_TYPE_IDS
from app.services.bond_status import bangkok_today

PREFIX = "/api/v1/tracking"


async def _make_item(client, *, item_type: str = "BOND", name: str = "Bonds") -> str:
    """Create set -> category -> sub-category -> tracking item, return item id.
    `item_type` defaults to BOND; pass another type to test the capability gate."""
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
            json={"name": name, "typeId": SYSTEM_ITEM_TYPE_IDS[item_type]},
        )
    ).json()
    return item["id"]


async def _create_bond(client, item_id: str, payload: dict):
    return await client.post(f"{PREFIX}/items/{item_id}/bonds", json=payload)


def _valid_payload(**overrides) -> dict:
    body = {
        "code": "TH0623A",
        "issuer": "Ministry of Finance",
        "startDate": "2026-01-01",
        "expiredDate": "2030-01-01",
        "amount": "100000.0000",
    }
    body.update(overrides)
    return body


# ── Create ────────────────────────────────────────────────────────────────────


async def test_create_bond_happy_path(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["code"] == "TH0623A"
    assert body["issuer"] == "Ministry of Finance"
    assert body["startDate"] == "2026-01-01"
    assert body["expiredDate"] == "2030-01-01"
    assert body["amount"] == "100000.0000"
    assert body["trackingItemId"] == item_id
    assert uuid.UUID(body["id"])


async def test_create_bond_returns_computed_status(auth_client):
    item_id = await _make_item(auth_client)
    today = bangkok_today()

    # Active: window straddles today.
    active = await _create_bond(
        auth_client,
        item_id,
        _valid_payload(startDate="2000-01-01", expiredDate="2999-12-31"),
    )
    assert active.json()["status"] == "Active"

    # Pre-order: starts in the far future.
    pre = await _create_bond(
        auth_client,
        item_id,
        _valid_payload(startDate="2999-01-01", expiredDate="2999-12-31"),
    )
    assert pre.json()["status"] == "Pre-order"

    # Expire: window ended in the past.
    exp = await _create_bond(
        auth_client,
        item_id,
        _valid_payload(startDate="2000-01-01", expiredDate="2000-12-31"),
    )
    assert exp.json()["status"] == "Expire"

    # Unknown: a date is missing.
    unk = await _create_bond(
        auth_client, item_id, _valid_payload(startDate=None, expiredDate=None)
    )
    assert unk.json()["status"] == "Unknown"
    assert today == bangkok_today()  # sanity: test ran within one Bangkok day


async def test_create_bond_amount_zero_accepted(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(amount="0"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["amount"] == "0.0000"


async def test_create_bond_amount_precision_round_trips(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(amount="1234.5678"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["amount"] == "1234.5678"

    bond_id = resp.json()["id"]
    got = await auth_client.get(f"{PREFIX}/bonds/{bond_id}")
    assert got.json()["amount"] == "1234.5678"


async def test_create_bond_negative_amount_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(amount="-0.0001"))
    assert resp.status_code == 422


async def test_create_bond_blank_code_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    for blank in ("", "   ", "\t\n"):
        resp = await _create_bond(auth_client, item_id, _valid_payload(code=blank))
        assert resp.status_code == 422, f"{blank!r} -> {resp.status_code}"


async def test_create_bond_code_over_100_chars_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(code="X" * 101))
    assert resp.status_code == 422


async def test_create_bond_code_exactly_100_chars_accepted(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(code="X" * 100))
    assert resp.status_code == 201
    assert resp.json()["code"] == "X" * 100


async def test_create_bond_minimal_payload_nulls_optional_fields(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, {"code": "MIN", "amount": "10"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["issuer"] is None
    assert body["startDate"] is None
    assert body["expiredDate"] is None
    assert body["status"] == "Unknown"


async def test_create_bond_blank_issuer_coerced_to_null(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(issuer="   "))
    assert resp.status_code == 201
    assert resp.json()["issuer"] is None


# ── Type gate ────────────────────────────────────────────────────────────────


async def test_create_bond_on_non_bond_item_rejected_400(auth_client):
    item_id = await _make_item(auth_client, item_type="Investment Account")
    resp = await _create_bond(auth_client, item_id, _valid_payload())
    assert resp.status_code == 400


async def test_list_bonds_on_non_bond_item_rejected_400(auth_client):
    item_id = await _make_item(auth_client, item_type="Property")
    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert resp.status_code == 400


async def test_bond_endpoints_on_missing_item_404(auth_client):
    missing = uuid.uuid4()
    assert (await auth_client.get(f"{PREFIX}/items/{missing}/bonds")).status_code == 404
    assert (
        await _create_bond(auth_client, str(missing), _valid_payload())
    ).status_code == 404


# ── List ─────────────────────────────────────────────────────────────────────


async def test_list_bonds_returns_all_with_status_ordered_by_start_date(auth_client):
    item_id = await _make_item(auth_client)
    await _create_bond(auth_client, item_id, _valid_payload(code="B", startDate="2026-06-01"))
    await _create_bond(auth_client, item_id, _valid_payload(code="A", startDate="2026-01-01"))
    await _create_bond(auth_client, item_id, _valid_payload(code="C", startDate=None))

    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert resp.status_code == 200
    rows = resp.json()
    assert [r["code"] for r in rows] == ["A", "B", "C"]  # NULL start_date sorts last
    assert all("status" in r for r in rows)


async def test_list_bonds_empty(auth_client):
    item_id = await _make_item(auth_client)
    resp = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert resp.status_code == 200
    assert resp.json() == []


# ── Update (presence-aware) ─────────────────────────────────────────────────


async def _seed_bond(client, item_id: str, **overrides):
    return (await _create_bond(client, item_id, _valid_payload(**overrides))).json()


async def test_update_bond_partial_leaves_other_fields_untouched(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id, code="OLD", amount="500.0000")

    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"code": "NEW"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == "NEW"
    assert body["amount"] == "500.0000"
    assert body["startDate"] == "2026-01-01"
    assert body["expiredDate"] == "2030-01-01"


async def test_update_bond_clears_issuer_and_dates_via_null(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)

    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}",
        json={"issuer": None, "startDate": None, "expiredDate": None},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["issuer"] is None
    assert body["startDate"] is None
    assert body["expiredDate"] is None
    assert body["status"] == "Unknown"  # status recomputed after the clear


async def test_update_bond_recomputes_status(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(
        auth_client, item_id, startDate="2999-01-01", expiredDate="2999-12-31"
    )
    assert bond["status"] == "Pre-order"

    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}",
        json={"startDate": "2000-01-01", "expiredDate": "2999-12-31"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "Active"


async def test_update_bond_code_null_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"code": None})
    assert resp.status_code == 422


async def test_update_bond_code_blank_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"code": "   "})
    assert resp.status_code == 422


async def test_update_bond_amount_null_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"amount": None})
    assert resp.status_code == 422


async def test_update_bond_negative_amount_rejected_422(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"amount": "-1"})
    assert resp.status_code == 422


async def test_update_bond_empty_body_is_noop(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id, code="KEEP")
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={})
    assert resp.status_code == 200
    assert resp.json()["code"] == "KEEP"


# ── Delete ───────────────────────────────────────────────────────────────────


async def test_delete_bond_then_get_404(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)

    resp = await auth_client.delete(f"{PREFIX}/bonds/{bond['id']}")
    assert resp.status_code == 204

    got = await auth_client.get(f"{PREFIX}/bonds/{bond['id']}")
    assert got.status_code == 404


# ── Cross-user ownership isolation ─────────────────────────────────────────


async def test_cross_user_cannot_touch_bond(auth_client, auth_client_b):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    bid = bond["id"]

    assert (await auth_client_b.get(f"{PREFIX}/bonds/{bid}")).status_code == 404
    assert (
        await auth_client_b.put(f"{PREFIX}/bonds/{bid}", json={"code": "HACK"})
    ).status_code == 404
    assert (await auth_client_b.delete(f"{PREFIX}/bonds/{bid}")).status_code == 404

    # And User B cannot list bonds under User A's item.
    assert (await auth_client_b.get(f"{PREFIX}/items/{item_id}/bonds")).status_code == 404


# ── Gate 3 conditions: cross-user create, issuer bound, date format, precision ─


async def test_cross_user_cannot_create_bond_on_foreign_item_404(auth_client, auth_client_b):
    """C3a — User B POSTing a bond to User A's BOND item id gets a 404 (the
    same not-found the ownership filter returns for a GET), and nothing is
    written under User A's item."""
    item_id = await _make_item(auth_client)  # User A owns this BOND item
    resp = await _create_bond(auth_client_b, item_id, _valid_payload())
    assert resp.status_code == 404

    listed = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert listed.json() == []


async def test_create_bond_issuer_over_200_chars_rejected_422(auth_client):
    """C3b — issuer is capped at 200 chars on create."""
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(issuer="I" * 201))
    assert resp.status_code == 422


async def test_create_bond_issuer_exactly_200_chars_accepted(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(issuer="I" * 200))
    assert resp.status_code == 201, resp.text
    assert resp.json()["issuer"] == "I" * 200


async def test_update_bond_issuer_over_200_chars_rejected_422(auth_client):
    """C3b — the 200-char issuer cap is enforced on update too."""
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}", json={"issuer": "I" * 201}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "bad_date",
    ["31/12/2026", "12-31-2026", "2026/01/01", "2026-13-01", "2026-02-30", "not-a-date", "20261231"],
)
async def test_create_bond_non_iso_dates_rejected_422(auth_client, bad_date):
    """C3c — start/expired must be ISO-8601 (YYYY-MM-DD); anything else 422s."""
    item_id = await _make_item(auth_client)
    r_start = await _create_bond(auth_client, item_id, _valid_payload(startDate=bad_date))
    assert r_start.status_code == 422, f"startDate={bad_date!r} -> {r_start.status_code}"
    r_exp = await _create_bond(auth_client, item_id, _valid_payload(expiredDate=bad_date))
    assert r_exp.status_code == 422, f"expiredDate={bad_date!r} -> {r_exp.status_code}"


async def test_update_bond_non_iso_date_rejected_422(auth_client):
    """C3c — the ISO-date rule is enforced on update too."""
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}", json={"startDate": "31/12/2026"}
    )
    assert resp.status_code == 422


async def test_create_bond_amount_over_4dp_rounds_half_away_from_zero(auth_client):
    """C3d — `amount` maps to Numeric(19, 4). Pydantic does NOT quantize a
    bare Decimal field, so a value with >4 decimal places is accepted at the
    schema layer and rounded by Postgres on write (round-half-away-from-zero).
    The endpoint returns the DB value (after `refresh()`), so both the create
    response and a subsequent GET show the rounded, quantized value."""
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(amount="1.23456"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["amount"] == "1.2346"  # 5th dp (..56) rounds the 4th up

    bond_id = resp.json()["id"]
    got = await auth_client.get(f"{PREFIX}/bonds/{bond_id}")
    assert got.json()["amount"] == "1.2346"


async def test_update_bond_amount_over_4dp_rounds_and_round_trips(auth_client):
    """C3d — same quantize-on-write behaviour on the update path (also the
    only test that exercises a non-null `amount` change through PUT)."""
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id, amount="100.0000")
    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"amount": "1.99999"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["amount"] == "2.0000"

    got = await auth_client.get(f"{PREFIX}/bonds/{bond['id']}")
    assert got.json()["amount"] == "2.0000"


# ── interestRate — create validation & round-trip ───────────────────────────


@pytest.mark.parametrize(
    "rate_in, rate_out",
    [
        pytest.param(0, "0.0000", id="zero"),
        pytest.param(100, "100.0000", id="upper-bound"),
        pytest.param(3.25, "3.2500", id="mid-two-dp"),
    ],
)
async def test_create_bond_interest_rate_in_range_round_trips(auth_client, rate_in, rate_out):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(interestRate=rate_in))
    assert resp.status_code == 201, resp.text
    assert resp.json()["interestRate"] == rate_out

    bond_id = resp.json()["id"]
    got = await auth_client.get(f"{PREFIX}/bonds/{bond_id}")
    assert got.json()["interestRate"] == rate_out


@pytest.mark.parametrize(
    "bad_rate",
    [
        pytest.param(-0.01, id="below-zero"),
        pytest.param(100.0001, id="above-100"),
        pytest.param("abc", id="not-a-number"),
    ],
)
async def test_create_bond_interest_rate_out_of_range_or_nonnumeric_rejected_422(
    auth_client, bad_rate
):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(interestRate=bad_rate))
    assert resp.status_code == 422, f"{bad_rate!r} -> {resp.status_code}"


async def test_create_bond_interest_rate_omitted_is_null(auth_client):
    item_id = await _make_item(auth_client)
    payload = _valid_payload()
    payload.pop("interestRate", None)  # not present by default, but be explicit
    resp = await _create_bond(auth_client, item_id, payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["interestRate"] is None


async def test_create_bond_interest_rate_explicit_null_is_null(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(interestRate=None))
    assert resp.status_code == 201, resp.text
    assert resp.json()["interestRate"] is None


async def test_create_bond_interest_rate_over_4dp_stored_to_scale_4(auth_client):
    """`interest_rate` maps to Numeric(19, 4). Pydantic does not quantize a bare
    Decimal field, so a >4dp value is accepted at the schema layer and rounded
    by the DB on write. Test DB is Postgres (round-half-away-from-zero), so the
    4th dp is deterministic here; the load-bearing assertion is 'exactly 4 dp'."""
    from decimal import Decimal

    item_id = await _make_item(auth_client)
    resp = await _create_bond(auth_client, item_id, _valid_payload(interestRate="3.25555"))
    assert resp.status_code == 201, resp.text
    rate = resp.json()["interestRate"]
    assert len(rate.split(".")[1]) == 4, f"expected scale-4 string, got {rate!r}"
    # Test DB is Postgres -> round-half-away-from-zero on the 5th dp (..555|5 -> 3.2556).
    # If this suite is ever pointed at sqlite, relax to the scale-4 check above only.
    assert Decimal(rate) == Decimal("3.2556")


# ── interestRate — presence-aware update ────────────────────────────────────


async def test_update_bond_sets_interest_rate(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}", json={"interestRate": 5}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["interestRate"] == "5.0000"


async def test_update_bond_clears_interest_rate_via_null(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id, interestRate="4.5")
    assert bond["interestRate"] == "4.5000"

    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}", json={"interestRate": None}
    )
    assert resp.status_code == 200, resp.text  # explicit null is a legal clear, NOT 422
    assert resp.json()["interestRate"] is None


async def test_update_bond_without_interest_rate_key_leaves_it_untouched(auth_client):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id, interestRate="7.25")
    assert bond["interestRate"] == "7.2500"

    resp = await auth_client.put(f"{PREFIX}/bonds/{bond['id']}", json={"issuer": "New Issuer"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["issuer"] == "New Issuer"
    assert body["interestRate"] == "7.2500"  # survived a PUT that never mentioned it


@pytest.mark.parametrize("bad_rate", [-1, 101, "x"])
async def test_update_bond_invalid_interest_rate_rejected_422(auth_client, bad_rate):
    item_id = await _make_item(auth_client)
    bond = await _seed_bond(auth_client, item_id)
    resp = await auth_client.put(
        f"{PREFIX}/bonds/{bond['id']}", json={"interestRate": bad_rate}
    )
    assert resp.status_code == 422, f"{bad_rate!r} -> {resp.status_code}"


# ── interestRate & years — present on every bond response shape ──────────────


async def test_interest_rate_and_years_keys_present_on_all_response_shapes(auth_client):
    item_id = await _make_item(auth_client)

    created = await _create_bond(auth_client, item_id, _valid_payload(interestRate=2.5))
    assert created.status_code == 201, created.text
    bond_id = created.json()["id"]
    for key in ("interestRate", "years"):
        assert key in created.json(), f"POST response missing {key!r}"

    got = await auth_client.get(f"{PREFIX}/bonds/{bond_id}")
    for key in ("interestRate", "years"):
        assert key in got.json(), f"GET /bonds/{{id}} response missing {key!r}"

    listed = await auth_client.get(f"{PREFIX}/items/{item_id}/bonds")
    assert listed.status_code == 200
    for row in listed.json():
        for key in ("interestRate", "years"):
            assert key in row, f"GET /items/{{id}}/bonds row missing {key!r}"

    updated = await auth_client.put(f"{PREFIX}/bonds/{bond_id}", json={"interestRate": 3})
    for key in ("interestRate", "years"):
        assert key in updated.json(), f"PUT response missing {key!r}"


# ── years — derived term span on read ──────────────────────────────────────


async def test_bond_years_five_year_span(auth_client):
    item_id = await _make_item(auth_client)
    resp = await _create_bond(
        auth_client,
        item_id,
        _valid_payload(startDate="2020-01-01", expiredDate="2025-01-01"),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["years"] == 5


async def test_bond_years_null_when_a_date_is_missing(auth_client):
    item_id = await _make_item(auth_client)

    only_start = await _create_bond(
        auth_client, item_id, _valid_payload(startDate="2020-01-01", expiredDate=None)
    )
    assert only_start.json()["years"] is None

    neither = await _create_bond(
        auth_client, item_id, _valid_payload(startDate=None, expiredDate=None)
    )
    assert neither.json()["years"] is None


async def test_bond_years_negative_for_persisted_inverted_dates_response_is_200(auth_client):
    """An inverted window (start after expired) persists fine — `years` is a
    negative int and the read path returns 200, never 500 (D-1 posture)."""
    item_id = await _make_item(auth_client)
    resp = await _create_bond(
        auth_client,
        item_id,
        _valid_payload(startDate="2025-01-01", expiredDate="2020-01-01"),
    )
    assert resp.status_code == 201, resp.text
    bond_id = resp.json()["id"]
    assert resp.json()["years"] == -5

    got = await auth_client.get(f"{PREFIX}/bonds/{bond_id}")
    assert got.status_code == 200
    assert isinstance(got.json()["years"], int)
    assert got.json()["years"] == -5


# ── FK cascade ───────────────────────────────────────────────────────────────


# ── DB CHECK constraint — direct enforcement (bypassing Pydantic) ───────────


async def test_interest_rate_check_constraint_enforced_at_db_level(auth_client, db_session):
    """DEF-002 / Gate-1 AC — `ck_ft_bond_interest_rate_range` is a real DB CHECK,
    not merely a Pydantic bound. Persist `Bond` rows straight through the ORM
    session (no request schema in the path) and assert Postgres itself rejects
    an out-of-range `interest_rate` and accepts NULL / 0 / 100.

    The test DB schema is built via `Base.metadata.create_all`, and the model's
    `__table_args__` carries the identical CHECK, so the constraint IS present
    here. The tracking item is created through the API (which commits) so the
    NOT NULL FK on `tracking_item_id` is satisfied for the direct inserts."""
    item_id = await _make_item(auth_client)
    item_uuid = uuid.UUID(item_id)

    # Out-of-range on either side must raise an IntegrityError (CHECK violation).
    for bad_rate in (Decimal("150"), Decimal("-1")):
        db_session.add(
            Bond(
                tracking_item_id=item_uuid,
                code="CK-BAD",
                amount=Decimal("1000"),
                interest_rate=bad_rate,
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

    # NULL / 0 / 100 sit inside the allowed range and must persist cleanly.
    for ok_rate in (None, Decimal("0"), Decimal("100")):
        bond = Bond(
            tracking_item_id=item_uuid,
            code="CK-OK",
            amount=Decimal("1000"),
            interest_rate=ok_rate,
        )
        db_session.add(bond)
        await db_session.flush()  # no raise
        assert bond.id is not None
        await db_session.rollback()


async def test_deleting_tracking_item_cascades_to_bonds(auth_client, db_session):
    item_id = await _make_item(auth_client)
    b1 = await _seed_bond(auth_client, item_id, code="C1")
    b2 = await _seed_bond(auth_client, item_id, code="C2")

    resp = await auth_client.delete(f"{PREFIX}/items/{item_id}")
    assert resp.status_code == 204

    remaining = (
        await db_session.execute(
            select(Bond).where(Bond.id.in_([uuid.UUID(b1["id"]), uuid.UUID(b2["id"])]))
        )
    ).scalars().all()
    assert remaining == []
