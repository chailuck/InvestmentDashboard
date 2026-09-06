"""Unit tests for the pure backup helpers (no DB, no HTTP)."""

from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.backup import (
    json_default_payload,
    safe_ident,
    table_checksum,
    toposort,
)


# ── toposort ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "tables, edges, expected",
    [
        # linear chain c->b->a  (parent must precede child)
        (["a", "b", "c"], [("b", "a"), ("c", "b")], ["a", "b", "c"]),
        # diamond: d depends on b and c, both depend on a
        (
            ["a", "b", "c", "d"],
            [("b", "a"), ("c", "a"), ("d", "b"), ("d", "c")],
            ["a", "b", "c", "d"],
        ),
        # self-referential edge is dropped, order is alphabetical
        (["x"], [("x", "x")], ["x"]),
        # disconnected nodes -> alphabetical
        (["z", "m", "a"], [], ["a", "m", "z"]),
        # duplicate edges collapse (no double-decrement)
        (["a", "b"], [("b", "a"), ("b", "a"), ("b", "a")], ["a", "b"]),
    ],
)
def test_toposort_cases(tables, edges, expected):
    assert toposort(tables, edges) == expected


def test_toposort_two_cycle_appends_remaining_sorted():
    # a<->b cycle plus a clean node c
    result = toposort(["b", "a", "c"], [("a", "b"), ("b", "a")])
    assert result[0] == "c"
    assert sorted(result[1:]) == ["a", "b"]
    assert set(result) == {"a", "b", "c"}


def test_toposort_ignores_edges_to_unknown_nodes():
    assert toposort(["a", "b"], [("b", "a"), ("b", "ghost"), ("ghost", "a")]) == ["a", "b"]


def test_toposort_deterministic_under_input_shuffling():
    tables = ["users", "orders", "items", "payments", "shipments", "reviews"]
    edges = [
        ("orders", "users"),
        ("items", "orders"),
        ("payments", "orders"),
        ("shipments", "orders"),
        ("reviews", "users"),
        ("reviews", "items"),
    ]
    baseline = toposort(list(tables), list(edges))
    rng = random.Random(1234)
    for _ in range(50):
        t = tables[:]
        e = edges[:]
        rng.shuffle(t)
        rng.shuffle(e)
        assert toposort(t, e) == baseline
    # sanity: every parent precedes its child
    pos = {name: i for i, name in enumerate(baseline)}
    for child, parent in edges:
        assert pos[parent] < pos[child]


# ── table_checksum ─────────────────────────────────────────────────────────

def test_table_checksum_prefix_and_order_independence():
    rows_a = [{"id": 1, "v": "a"}, {"id": 2, "v": "b"}]
    rows_b = list(reversed(rows_a))
    ck_a = table_checksum(rows_a)
    ck_b = table_checksum(rows_b)
    assert ck_a.startswith("sha256:")
    assert ck_a == ck_b


def test_table_checksum_order_independent_with_non_json_values():
    u = uuid.uuid4()
    dt = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    rows = [
        {"id": 1, "u": u, "at": dt, "amount": Decimal("10.5000")},
        {"id": 2, "u": u, "at": dt, "amount": Decimal("11.0000")},
    ]
    assert table_checksum(rows) == table_checksum(list(reversed(rows)))


def test_table_checksum_changes_when_value_changes():
    base = table_checksum([{"id": 1, "amount": Decimal("10.00")}])
    changed = table_checksum([{"id": 1, "amount": Decimal("10.01")}])
    assert base != changed


def test_table_checksum_detects_binary_tamper_via_json_default_payload():
    # bytes are normalised (base64) by json_default_payload, so a one-byte edit
    # to a binary column is still caught by the digest.
    a = table_checksum([{"id": 1, "blob": b"\x00\x01\x02"}])
    b = table_checksum([{"id": 1, "blob": b"\x00\x01\x03"}])
    assert a.startswith("sha256:")
    assert a != b


def test_table_checksum_empty():
    assert table_checksum([]).startswith("sha256:")


# ── safe_ident ─────────────────────────────────────────────────────────────

def test_safe_ident_allowed():
    assert safe_ident("users", {"users", "orders"}) == '"users"'


def test_safe_ident_rejects_unknown():
    with pytest.raises(HTTPException) as ei:
        safe_ident("users; DROP TABLE users", {"users"})
    assert ei.value.status_code == 400


def test_safe_ident_escapes_embedded_quote():
    # contrived, but proves the escaping path
    assert safe_ident('we"ird', {'we"ird'}) == '"we""ird"'


# ── json_default_payload ───────────────────────────────────────────────────

def test_json_default_payload_decimal_is_float():
    assert json_default_payload(Decimal("2.50")) == 2.5
    assert isinstance(json_default_payload(Decimal("2.50")), float)


def test_json_default_payload_bytes_base64():
    assert json_default_payload(b"\x00\x01\x02") == "AAEC"
    assert json_default_payload(bytearray(b"\x00\x01\x02")) == "AAEC"
    assert json_default_payload(memoryview(b"\x00\x01\x02")) == "AAEC"


def test_json_default_payload_uuid_and_datetime():
    u = uuid.uuid4()
    assert json_default_payload(u) == str(u)
    dt = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    assert json_default_payload(dt) == dt.isoformat()
    assert json_default_payload(date(2026, 1, 2)) == "2026-01-02"


def test_json_default_payload_rejects_unknown_type():
    with pytest.raises(TypeError):
        json_default_payload(object())
