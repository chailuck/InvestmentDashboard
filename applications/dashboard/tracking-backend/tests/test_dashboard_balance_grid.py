"""Dashboard balance-grid endpoint (Phase 3): unit tests against the generic
`compute_series_deltas` delta engine, plus integration tests through the
actual `GET /sets/{set_id}/dashboard/balance-grid` endpoint — mirrors the
dual-layer style `test_update_tracking_lists.py` uses for
`app/services/update_tracking.py`."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from app.models.update_tracking_list import UpdateTrackingList
from app.models.update_tracking_list_balance import UpdateTrackingListBalance
from app.services.dashboard_balance_grid import compute_series_deltas

PREFIX = "/api/v1/tracking"


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _make_set(client, name: str | None = None) -> str:
    resp = await client.post(f"{PREFIX}/sets", json={"name": name or f"Set-{uuid.uuid4()}"})
    return resp.json()["id"]


async def _sub_id(client, set_id: str, category_name: str, sub_name: str) -> str:
    cats = (await client.get(f"{PREFIX}/sets/{set_id}/categories")).json()
    cat = next(c for c in cats if c["name"] == category_name)
    subs = (await client.get(f"{PREFIX}/categories/{cat['id']}/sub-categories")).json()
    sub = next(s for s in subs if s["name"] == sub_name)
    return sub["id"]


async def _current_assets_sub_id(client, set_id: str) -> str:
    return await _sub_id(client, set_id, "Assets", "Current Assets")


async def _property_sub_id(client, set_id: str) -> str:
    return await _sub_id(client, set_id, "Assets", "Property")


async def _make_item(
    client,
    sub_id: str,
    name: str = "Item",
    item_type: str = "Bank account",
    exclusive: bool = False,
) -> str:
    resp = await client.post(
        f"{PREFIX}/sub-categories/{sub_id}/items",
        json={"name": name, "type": item_type, "exclusive": exclusive},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_set_with_item(client, name: str | None = None, item_name: str = "Item"):
    """Returns (set_id, current_assets_sub_id, item_id)."""
    set_id = await _make_set(client, name)
    sub_id = await _current_assets_sub_id(client, set_id)
    item_id = await _make_item(client, sub_id, name=item_name)
    return set_id, sub_id, item_id


async def _make_list(client, set_id: str, transaction_date: str, quarter: int, year: int) -> str:
    resp = await client.post(
        f"{PREFIX}/sets/{set_id}/update-lists",
        json={"transactionDate": transaction_date, "quarter": quarter, "year": year},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_list_partial(
    client, set_id: str, transaction_date: str, quarter: int | None = None, year: int | None = None
) -> str:
    body: dict = {"transactionDate": transaction_date}
    if quarter is not None:
        body["quarter"] = quarter
    if year is not None:
        body["year"] = year
    resp = await client.post(f"{PREFIX}/sets/{set_id}/update-lists", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _set_balance(client, list_id: str, item_id: str, balance) -> None:
    resp = await client.put(
        f"{PREFIX}/update-lists/{list_id}/balances",
        json={"balances": [{"trackingItemId": item_id, "balance": balance}]},
    )
    assert resp.status_code == 200, resp.text


async def _get_grid(client, set_id: str) -> dict:
    resp = await client.get(f"{PREFIX}/sets/{set_id}/dashboard/balance-grid")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _find_item_row(grid: dict, item_id: str) -> dict:
    for cat in grid["categories"]:
        for sub in cat["subCategories"]:
            for item in sub["items"]:
                if item["id"] == item_id:
                    return item
    raise AssertionError(f"item {item_id} not found in grid: {grid}")


def _find_sub_row(grid: dict, sub_id: str) -> dict:
    for cat in grid["categories"]:
        for sub in cat["subCategories"]:
            if sub["id"] == sub_id:
                return sub
    raise AssertionError(f"sub-category {sub_id} not found in grid: {grid}")


def _find_category_row(grid: dict, category_name: str) -> dict:
    return next(c for c in grid["categories"] if c["name"] == category_name)


def _cell(cells: list[dict], year: int, quarter: int) -> dict:
    for c in cells:
        if c["year"] == year and c["quarter"] == quarter:
            return c
    raise AssertionError(f"cell ({year}, Q{quarter}) not found in {cells}")


# ── Unit tests: compute_series_deltas (direct, no DB / HTTP) ────────────────


def test_series_first_populated_slot_has_no_previous_data():
    values = {(2026, 1): Decimal("100")}
    slots = [(2026, 1), (2026, 2)]
    result = compute_series_deltas(values, slots)

    first = result[(2026, 1)]
    assert first.has_data is True
    assert first.has_previous_data is False
    assert first.delta_amount is None
    assert first.delta_percent is None

    second = result[(2026, 2)]
    assert second.has_data is False
    assert second.has_previous_data is False
    assert second.balance is None


def test_series_skips_blank_quarter_within_same_year():
    values = {(2026, 1): Decimal("100"), (2026, 3): Decimal("150")}
    slots = [(2026, 1), (2026, 2), (2026, 3), (2026, 4)]
    result = compute_series_deltas(values, slots)

    assert result[(2026, 2)].has_data is False

    q3 = result[(2026, 3)]
    assert q3.has_data is True
    assert q3.has_previous_data is True
    assert q3.delta_amount == Decimal("50")  # diffs against Q1, not the blank Q2


def test_series_crosses_year_boundary_several_quarters_back():
    values = {(2025, 2): Decimal("100"), (2026, 3): Decimal("150")}
    slots = [(2025, 2), (2025, 3), (2025, 4), (2026, 1), (2026, 2), (2026, 3)]
    result = compute_series_deltas(values, slots)

    q = result[(2026, 3)]
    assert q.has_previous_data is True
    assert q.delta_amount == Decimal("50")  # last real value was 2025 Q2


def test_series_zero_previous_balance_yields_delta_amount_but_null_percent():
    values = {(2026, 1): Decimal("0"), (2026, 2): Decimal("150")}
    slots = [(2026, 1), (2026, 2)]
    result = compute_series_deltas(values, slots)

    q2 = result[(2026, 2)]
    assert q2.delta_amount == Decimal("150")
    assert q2.delta_percent is None


def test_series_negative_delta_computed_correctly():
    values = {(2026, 1): Decimal("1000"), (2026, 2): Decimal("750")}
    slots = [(2026, 1), (2026, 2)]
    result = compute_series_deltas(values, slots)

    q2 = result[(2026, 2)]
    assert q2.delta_amount == Decimal("-250")
    assert q2.delta_percent == Decimal("-25")


def test_series_no_values_at_all_yields_all_blank():
    result = compute_series_deltas({}, [(2026, 1), (2026, 2)])
    assert all(not m.has_data and not m.has_previous_data for m in result.values())


# ── Integration: blank quarters ─────────────────────────────────────────────


async def test_blank_quarter_renders_no_data_for_item_and_rollup(auth_client):
    set_id, sub_id, item_id = await _make_set_with_item(auth_client)
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "100")
    # Q2 deliberately has no list at all.
    q3 = await _make_list(auth_client, set_id, "2026-07-15", quarter=3, year=2026)
    await _set_balance(auth_client, q3, item_id, "150")

    grid = await _get_grid(auth_client, set_id)

    item_row = _find_item_row(grid, item_id)
    blank_cell = _cell(item_row["cells"], 2026, 2)
    assert blank_cell["hasData"] is False
    assert blank_cell["balance"] is None
    assert blank_cell["deltaAmount"] is None
    assert blank_cell["deltaPercent"] is None

    sub_row = _find_sub_row(grid, sub_id)
    blank_subtotal = _cell(sub_row["subtotal"], 2026, 2)
    assert blank_subtotal["hasData"] is False
    assert blank_subtotal["balance"] is None


async def test_delta_skips_blank_quarter_within_same_year(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "100")
    q3 = await _make_list(auth_client, set_id, "2026-07-15", quarter=3, year=2026)
    await _set_balance(auth_client, q3, item_id, "150")

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    q3_cell = _cell(item_row["cells"], 2026, 3)
    assert q3_cell["hasPreviousData"] is True
    assert q3_cell["deltaAmount"] == "50.0000"


async def test_delta_crosses_year_boundary(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    old = await _make_list(auth_client, set_id, "2025-04-15", quarter=2, year=2025)
    await _set_balance(auth_client, old, item_id, "100")
    # Nothing in Q3/Q4 2025 or Q1/Q2 2026 — the next data point, several
    # quarters later, must still diff against 2025 Q2.
    new = await _make_list(auth_client, set_id, "2026-07-15", quarter=3, year=2026)
    await _set_balance(auth_client, new, item_id, "150")

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    cell = _cell(item_row["cells"], 2026, 3)
    assert cell["hasPreviousData"] is True
    assert cell["deltaAmount"] == "50.0000"


async def test_first_ever_populated_quarter_has_no_previous_data(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "500")

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    cell = _cell(item_row["cells"], 2026, 1)
    assert cell["hasPreviousData"] is False
    assert cell["deltaAmount"] is None
    assert cell["deltaPercent"] is None


async def test_zero_previous_balance_yields_delta_amount_not_null_percent(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item_id, "0")
    q2 = await _make_list(auth_client, set_id, "2026-04-15", quarter=2, year=2026)
    await _set_balance(auth_client, q2, item_id, "150")

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    cell = _cell(item_row["cells"], 2026, 2)
    assert cell["deltaAmount"] == "150.0000"
    assert cell["deltaPercent"] is None


# ── Integration: winner tiebreak among duplicate (year, quarter) slots ──────


async def test_duplicate_slot_most_recently_created_wins(auth_client, db_session, user_a_id):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    uid = uuid.UUID(user_a_id)
    base_dt = dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=dt.timezone.utc)

    older = UpdateTrackingList(
        user_id=uid,
        tracking_set_id=uuid.UUID(set_id),
        transaction_date=dt.date(2026, 1, 1),
        quarter=1,
        year=2026,
    )
    older.created_at = base_dt
    newer = UpdateTrackingList(
        user_id=uid,
        tracking_set_id=uuid.UUID(set_id),
        transaction_date=dt.date(2026, 1, 15),
        quarter=1,
        year=2026,
    )
    newer.created_at = base_dt + dt.timedelta(minutes=5)
    db_session.add_all([older, newer])
    await db_session.flush()

    db_session.add_all(
        [
            UpdateTrackingListBalance(
                user_id=uid,
                update_tracking_list_id=older.id,
                tracking_item_id=uuid.UUID(item_id),
                balance=Decimal("100"),
            ),
            UpdateTrackingListBalance(
                user_id=uid,
                update_tracking_list_id=newer.id,
                tracking_item_id=uuid.UUID(item_id),
                balance=Decimal("999"),
            ),
        ]
    )
    await db_session.commit()

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    cell = _cell(item_row["cells"], 2026, 1)
    assert cell["balance"] == "999.0000"  # the more-recently-created row wins


async def test_duplicate_slot_same_created_at_tiebreak_by_highest_id(
    auth_client, db_session, user_a_id
):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    uid = uuid.UUID(user_a_id)
    same_dt = dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=dt.timezone.utc)

    a = UpdateTrackingList(
        user_id=uid,
        tracking_set_id=uuid.UUID(set_id),
        transaction_date=dt.date(2026, 1, 1),
        quarter=1,
        year=2026,
    )
    a.created_at = same_dt
    b = UpdateTrackingList(
        user_id=uid,
        tracking_set_id=uuid.UUID(set_id),
        transaction_date=dt.date(2026, 1, 1),
        quarter=1,
        year=2026,
    )
    b.created_at = same_dt
    db_session.add_all([a, b])
    await db_session.flush()

    winner_id, loser_id = (a.id, b.id) if a.id > b.id else (b.id, a.id)
    db_session.add_all(
        [
            UpdateTrackingListBalance(
                user_id=uid,
                update_tracking_list_id=winner_id,
                tracking_item_id=uuid.UUID(item_id),
                balance=Decimal("777"),
            ),
            UpdateTrackingListBalance(
                user_id=uid,
                update_tracking_list_id=loser_id,
                tracking_item_id=uuid.UUID(item_id),
                balance=Decimal("111"),
            ),
        ]
    )
    await db_session.commit()

    grid = await _get_grid(auth_client, set_id)
    item_row = _find_item_row(grid, item_id)
    cell = _cell(item_row["cells"], 2026, 1)
    assert cell["balance"] == "777.0000"  # highest id wins the same-created_at tie


# ── Integration: exclusive-item exclusion ───────────────────────────────────


async def test_exclusive_item_excluded_from_all_rollups(auth_client):
    set_id, sub_id, normal_item_id = await _make_set_with_item(auth_client, item_name="Normal")
    exclusive_item_id = await _make_item(auth_client, sub_id, name="Excluded", exclusive=True)

    list_id = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, list_id, normal_item_id, "100")
    await _set_balance(auth_client, list_id, exclusive_item_id, "1000")

    grid = await _get_grid(auth_client, set_id)

    exclusive_row = _find_item_row(grid, exclusive_item_id)
    assert _cell(exclusive_row["cells"], 2026, 1)["balance"] == "1000.0000"  # own row unaffected

    sub_row = _find_sub_row(grid, sub_id)
    assert _cell(sub_row["subtotal"], 2026, 1)["balance"] == "100.0000"  # excludes the 1000

    assets_cat = _find_category_row(grid, "Assets")
    assert _cell(assets_cat["subtotal"], 2026, 1)["balance"] == "100.0000"

    assert _cell(grid["grandTotal"], 2026, 1)["balance"] == "100.0000"


# ── Integration: multi-year ordering and quarter padding ────────────────────


async def test_multi_year_descending_order_and_four_quarters_always(auth_client):
    set_id, _, item_id = await _make_set_with_item(auth_client)
    l2025 = await _make_list(auth_client, set_id, "2025-01-15", quarter=1, year=2025)
    await _set_balance(auth_client, l2025, item_id, "50")
    l2026 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, l2026, item_id, "75")

    grid = await _get_grid(auth_client, set_id)
    assert [y["year"] for y in grid["years"]] == [2026, 2025]
    for year_col in grid["years"]:
        assert year_col["quarters"] == [1, 2, 3, 4]

    item_row = _find_item_row(grid, item_id)
    assert len(item_row["cells"]) == 8  # 2 years * 4 quarters, even though only 2 are populated
    assert _cell(item_row["cells"], 2026, 1)["balance"] == "75.0000"
    assert _cell(item_row["cells"], 2025, 1)["balance"] == "50.0000"


# ── Integration: empty set ───────────────────────────────────────────────────


async def test_empty_set_returns_empty_years_but_full_category_hierarchy(auth_client):
    set_id, _, _ = await _make_set_with_item(auth_client)

    grid = await _get_grid(auth_client, set_id)
    assert grid["years"] == []
    assert grid["grandTotal"] == []
    assert grid["propertyBreakdown"]["propertyTotal"] == []
    assert grid["propertyBreakdown"]["nonPropertyTotal"] == []

    # The full current hierarchy (cascade-created defaults) is still present.
    category_names = {c["name"] for c in grid["categories"]}
    assert category_names == {"Assets", "Liabilities"}
    assets = _find_category_row(grid, "Assets")
    assert assets["subtotal"] == []
    sub_names = {s["name"] for s in assets["subCategories"]}
    assert sub_names == {"Current Assets", "Long-term Investment", "Property"}
    for sub in assets["subCategories"]:
        assert sub["subtotal"] == []


async def test_lists_missing_year_or_quarter_are_excluded_entirely(auth_client):
    """A list missing EITHER field is excluded from the report entirely —
    not an error, just no column to place it in."""
    set_id, _, item_id = await _make_set_with_item(auth_client)
    no_quarter = await _make_list_partial(auth_client, set_id, "2026-01-01", year=2026)
    await _set_balance(auth_client, no_quarter, item_id, "999")

    grid = await _get_grid(auth_client, set_id)
    assert grid["years"] == []


# ── Ownership isolation ───────────────────────────────────────────────────────


async def test_cross_user_access_returns_bare_404(auth_client, auth_client_b):
    set_id, _, _ = await _make_set_with_item(auth_client)

    resp = await auth_client_b.get(f"{PREFIX}/sets/{set_id}/dashboard/balance-grid")
    assert resp.status_code == 404


async def test_nonexistent_set_returns_404(auth_client):
    resp = await auth_client.get(f"{PREFIX}/sets/{uuid.uuid4()}/dashboard/balance-grid")
    assert resp.status_code == 404


# ── Property / non-property breakdown ───────────────────────────────────────


async def test_property_breakdown_partitions_and_excludes_exclusive_items(auth_client):
    set_id = await _make_set(auth_client)
    property_sub_id = await _property_sub_id(auth_client, set_id)
    current_assets_sub_id = await _current_assets_sub_id(auth_client, set_id)

    property_item_id = await _make_item(
        auth_client, property_sub_id, name="House", item_type="Property"
    )
    excluded_property_item_id = await _make_item(
        auth_client, property_sub_id, name="ExcludedHouse", item_type="Property", exclusive=True
    )
    bank_item_id = await _make_item(
        auth_client, current_assets_sub_id, name="Checking", item_type="Bank account"
    )

    list_id = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, list_id, property_item_id, "500000")
    await _set_balance(auth_client, list_id, excluded_property_item_id, "999999")
    await _set_balance(auth_client, list_id, bank_item_id, "3000")

    grid = await _get_grid(auth_client, set_id)
    breakdown = grid["propertyBreakdown"]
    prop_cell = _cell(breakdown["propertyTotal"], 2026, 1)
    non_prop_cell = _cell(breakdown["nonPropertyTotal"], 2026, 1)

    assert prop_cell["balance"] == "500000.0000"  # excludes the exclusive Property item
    assert non_prop_cell["balance"] == "3000.0000"


# ── Rollup delta skips a quarter where every contributing item is blank ─────


async def test_rollup_delta_skips_quarter_where_all_contributing_items_are_blank(auth_client):
    set_id, sub_id, item1_id = await _make_set_with_item(auth_client, item_name="Item1")
    item2_id = await _make_item(auth_client, sub_id, name="Item2")

    q1 = await _make_list(auth_client, set_id, "2026-01-15", quarter=1, year=2026)
    await _set_balance(auth_client, q1, item1_id, "100")
    await _set_balance(auth_client, q1, item2_id, "200")

    # Q2 list header exists (so the slot itself is "known"), but NEITHER item
    # has a balance recorded for it — the rollup must treat this as blank,
    # not zero, and its own delta engine must skip over it too.
    await _make_list(auth_client, set_id, "2026-04-15", quarter=2, year=2026)

    q3 = await _make_list(auth_client, set_id, "2026-07-15", quarter=3, year=2026)
    await _set_balance(auth_client, q3, item1_id, "150")
    await _set_balance(auth_client, q3, item2_id, "250")

    grid = await _get_grid(auth_client, set_id)
    sub_row = _find_sub_row(grid, sub_id)

    q2_subtotal = _cell(sub_row["subtotal"], 2026, 2)
    assert q2_subtotal["hasData"] is False
    assert q2_subtotal["balance"] is None

    q3_subtotal = _cell(sub_row["subtotal"], 2026, 3)
    assert q3_subtotal["hasData"] is True
    assert q3_subtotal["hasPreviousData"] is True
    assert q3_subtotal["balance"] == "400.0000"  # 150 + 250
    assert q3_subtotal["deltaAmount"] == "100.0000"  # 400 - 300 (Q1), skipping the blank Q2


# ── Rollup subtotal reflects the lone populated item, not blank/all-required ─


async def test_rollup_subtotal_reflects_lone_populated_item_when_sibling_is_blank(auth_client):
    """ADR-003: a rollup slot is populated if AT LEAST ONE contributing item
    has data that quarter — it must not require every item to be populated
    before counting, and it must not silently sum in a missing sibling as if
    it were data. `test_rollup_delta_skips_quarter_where_all_contributing_items_are_blank`
    above only proves the ALL-blank case; this proves the "one populated, one
    blank" case (DEF-02), at both the sub-category and category rollup tiers,
    so the leaf-level "at least one" rule is confirmed applied at both."""
    set_id, sub_id, item1_id = await _make_set_with_item(auth_client, item_name="Item1")
    item2_id = await _make_item(auth_client, sub_id, name="Item2")

    # Q2 2026: Item1 has a real balance; Item2 has NO balance row at all for
    # this quarter (absent, not zero). "437.25" is a distinctive, non-zero
    # value not reused elsewhere in this test, so a future regression that
    # requires ALL items to be populated (would report blank here) is caught
    # unambiguously — and there is no missing item whose omitted balance
    # could be mistaken for a contributed zero.
    q2 = await _make_list(auth_client, set_id, "2026-04-15", quarter=2, year=2026)
    await _set_balance(auth_client, q2, item1_id, "437.25")

    grid = await _get_grid(auth_client, set_id)

    sub_row = _find_sub_row(grid, sub_id)
    sub_cell = _cell(sub_row["subtotal"], 2026, 2)
    assert sub_cell["hasData"] is True
    assert sub_cell["balance"] == "437.2500"  # Item1 alone, not blank

    assets_cat = _find_category_row(grid, "Assets")
    cat_cell = _cell(assets_cat["subtotal"], 2026, 2)
    assert cat_cell["hasData"] is True
    assert cat_cell["balance"] == "437.2500"  # same "at least one" rule at the category tier
