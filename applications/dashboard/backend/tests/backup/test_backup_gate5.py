"""GATE 5 (Quality Approval) tests for the backup/restore feature.

Adds the branch coverage the Gate-3 re-review (C-1) asked for and an explicit,
whole-catalogue round-trip fidelity check (Task 3 of the Gate-5 brief).

Everything here runs against the disposable ``investment_backup_test_db`` from
``conftest`` (freely TRUNCATE-able, CREATEd/DROPped in-session). No test in this
file reads or writes ``investment_db`` / ``investment_test_db``.

Targets closed vs. the 89% baseline:
* v2.0 + legacy insufficient-privilege 500 path (SET LOCAL rejected)
* legacy unknown-column 422
* legacy mid-restore failure -> 422 full rollback
* legacy empty-covered-table branch
* _do_restore bad-mode 400
* restore/upload non-object JSON 400
* PSV import: unknown table 400, header-only 400, replace+confirm truncate,
  import-failed 422
* list metadata: valid JSON with neither covered_tables nor tables
* pure helpers: _verify_checksum, _schema_version_num
"""

from __future__ import annotations

import gzip
import io
import json
import uuid

import pytest
import sqlalchemy.ext.asyncio as sa_asyncio
from sqlalchemy import text

from app.api.v1.endpoints.backup import _schema_version_num, _verify_checksum
from app.services.backup import table_checksum
from tests.backup.conftest import CORE_ALEMBIC_VERSION, FT_ALEMBIC_VERSION

# pytest.ini sets ``asyncio_mode = auto`` — async tests are collected without an
# explicit mark, and the two pure sync helpers below stay unmarked.

API = "/api/v1/backup"

UID = "11111111-1111-1111-1111-111111111111"
SET_ID = "22222222-2222-2222-2222-222222222222"
CAT_ID = "33333333-3333-3333-3333-333333333333"
SUB_ID = "44444444-4444-4444-4444-444444444444"
ITEM_INV = "55555555-5555-5555-5555-555555555555"
ITEM_BOND = "66666666-6666-6666-6666-666666666666"
LIST_ID = "77777777-7777-7777-7777-777777777777"
BAL_ID = "88888888-8888-8888-8888-888888888888"
ENTRY_ID = "99999999-9999-9999-9999-999999999999"
BOND_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _gz(obj) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as fh:
        fh.write(json.dumps(obj).encode("utf-8"))
    return buf.getvalue()


def _gz_raw(raw: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as fh:
        fh.write(raw)
    return buf.getvalue()


async def _read_backup(path) -> dict:
    with gzip.open(path, "rb") as fh:
        return json.loads(fh.read().decode("utf-8"))


async def _count(sm, table: str) -> int:
    async with sm() as s:
        return (await s.execute(text(f'SELECT count(*) FROM "{table}"'))).scalar_one()


async def _seed_full(sm) -> None:
    """FK-valid ft_* chain incl. ft_bond + a core dr_mappings row + bytea probe."""
    async with sm() as s:
        await s.execute(
            text("INSERT INTO ft_tracking_set (id, user_id, name) VALUES (:id, :u, 'Set A')"),
            {"id": SET_ID, "u": UID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_category (id, user_id, tracking_set_id, name) "
                "VALUES (:id, :u, :s, 'Cat A')"
            ),
            {"id": CAT_ID, "u": UID, "s": SET_ID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_sub_category (id, user_id, category_id, name) "
                "VALUES (:id, :u, :c, 'Sub A')"
            ),
            {"id": SUB_ID, "u": UID, "c": CAT_ID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_tracking_item (id, user_id, sub_category_id, name, type) "
                "VALUES (:id, :u, :sub, 'Acct', 'Investment Account')"
            ),
            {"id": ITEM_INV, "u": UID, "sub": SUB_ID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_tracking_item (id, user_id, sub_category_id, name, type) "
                "VALUES (:id, :u, :sub, 'MyBond', 'BOND')"
            ),
            {"id": ITEM_BOND, "u": UID, "sub": SUB_ID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_update_tracking_list "
                "(id, user_id, tracking_set_id, transaction_date, quarter, year) "
                "VALUES (:id, :u, :s, '2026-01-31', 1, 2026)"
            ),
            {"id": LIST_ID, "u": UID, "s": SET_ID},
        )
        await s.execute(
            text(
                "INSERT INTO ft_update_tracking_list_balance "
                "(id, user_id, update_tracking_list_id, tracking_item_id, balance) "
                "VALUES (:id, :u, :l, :it, 123.4500)"
            ),
            {"id": BAL_ID, "u": UID, "l": LIST_ID, "it": ITEM_INV},
        )
        await s.execute(
            text(
                "INSERT INTO ft_initial_investment_entry "
                "(id, user_id, tracking_item_id, amount, entry_date, code, name) "
                "VALUES (:id, :u, :it, 1000.0000, '2026-01-15', 'C1', 'N1')"
            ),
            {"id": ENTRY_ID, "u": UID, "it": ITEM_INV},
        )
        await s.execute(
            text(
                "INSERT INTO ft_bond "
                "(id, tracking_item_id, code, issuer, start_date, expired_date, amount) "
                "VALUES (:id, :it, 'BND1', 'ACME', '2026-01-01', '2030-01-01', 5000.0000)"
            ),
            {"id": BOND_ID, "it": ITEM_BOND},
        )
        await s.execute(
            text(
                "INSERT INTO dr_mappings "
                "(dr_symbol, parent_symbol, parent_market, ratio, is_active) "
                "VALUES ('BTC-DR', 'BTCUSD', 'CRYPTO', 1000, true)"
            )
        )
        await s.execute(
            text("INSERT INTO bk_bytea_probe (id, payload) VALUES (1, :p)"),
            {"p": bytes(range(256))},
        )
        await s.commit()


async def _truncate_data(sm) -> None:
    async with sm() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT c.relname FROM pg_class c JOIN pg_namespace n "
                    "ON n.oid = c.relnamespace WHERE c.relkind='r' "
                    "AND NOT c.relispartition AND n.nspname='public' "
                    "AND c.relname NOT IN ('alembic_version','ft_alembic_version')"
                )
            )
        ).fetchall()
        idents = ", ".join(f'"{r[0]}"' for r in rows)
        await s.execute(text(f"TRUNCATE TABLE {idents} RESTART IDENTITY CASCADE"))
        await s.commit()


async def _reset_schema_markers(sm) -> None:
    """Force the disposable DB's alembic markers back to their canonical values.

    ``conftest.bk_clean`` deliberately never truncates ``alembic_version`` /
    ``ft_alembic_version`` — a data restore must never roll a schema version
    forward or back, and the suite has tests that assert exactly that. A side
    effect: a sibling test that drifts a marker on purpose (e.g.
    ``test_backup_api.py::test_alembic_version_never_written_drift_reported``
    sets ``ft_alembic_version = 'ZZZ_LIVE'``) leaves that value behind. This
    helper gives the whole-catalogue round-trip test a deterministic starting
    point regardless of suite execution order. Table names are hard-coded
    literals, not request input.
    """
    async with sm() as s:
        for tbl, val in (
            ("alembic_version", CORE_ALEMBIC_VERSION),
            ("ft_alembic_version", FT_ALEMBIC_VERSION),
        ):
            await s.execute(text(f"DELETE FROM {tbl}"))
            await s.execute(
                text(f"INSERT INTO {tbl} (version_num) VALUES (:v)"), {"v": val}
            )
        await s.commit()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 3 — explicit whole-catalogue round-trip fidelity
# ══════════════════════════════════════════════════════════════════════════════

async def test_full_catalogue_round_trip_fidelity(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    """Seed representative rows across the full discovered set (ft_* incl.
    ft_bond, a core table, the bytea probe), back up, TRUNCATE, restore with
    replace_all, then prove per-table: row-count parity, checksum parity
    (recomputed by a second create_backup), checksum_verification all 'ok',
    and alembic markers untouched.
    """
    # Guarantee our own clean state regardless of suite execution order:
    # bk_clean already truncated every data table, but it never touches the
    # alembic marker tables, and a sibling test drifts ft_alembic_version on
    # purpose. Reset the markers and re-truncate defensively before seeding.
    await _reset_schema_markers(bk_sessionmaker)
    await _truncate_data(bk_sessionmaker)
    await _seed_full(bk_sessionmaker)

    # alembic markers BEFORE — captured as the baseline the restore must not move
    async with bk_sessionmaker() as s:
        core_before = (await s.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        ft_before = (await s.execute(text("SELECT version_num FROM ft_alembic_version"))).scalar_one()
    assert core_before == CORE_ALEMBIC_VERSION
    assert ft_before == FT_ALEMBIC_VERSION

    create1 = (await admin_bk_client.post(f"{API}/create")).json()
    filename = create1["filename"]
    orig_counts = create1["row_counts"]
    file1 = await _read_backup(bk_backup_dir / filename)
    orig_checksums = file1["checksums"]

    # tables that actually carried >=1 row — the fidelity-critical set
    seeded_tables = sorted(t for t, n in orig_counts.items() if n > 0)
    # must include the FK chain, ft_bond, a core table and the binary probe
    for required in (
        "ft_tracking_set", "ft_category", "ft_sub_category", "ft_tracking_item",
        "ft_update_tracking_list", "ft_update_tracking_list_balance",
        "ft_initial_investment_entry", "ft_bond", "dr_mappings", "bk_bytea_probe",
    ):
        assert required in seeded_tables, f"{required} not seeded"

    await _truncate_data(bk_sessionmaker)

    r = await admin_bk_client.post(
        f"{API}/restore/{filename}",
        json={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["legacy_backup"] is False and body["mode"] == "replace_all"

    # (a) every covered table verifies 'ok'
    assert set(body["checksum_verification"].values()) == {"ok"}, body["checksum_verification"]

    # (b) restored row counts match the backup for every seeded table
    for t in seeded_tables:
        assert body["restored"][t] == orig_counts[t], f"{t} row-count drift"
        assert await _count(bk_sessionmaker, t) == orig_counts[t]

    # (c) freshly recomputed per-table checksums match the file's checksums
    create2 = (await admin_bk_client.post(f"{API}/create")).json()
    for t in seeded_tables:
        assert create2["checksums"][t] == orig_checksums[t], f"{t} checksum drift after round-trip"
        assert create2["row_counts"][t] == orig_counts[t]

    # (d) bytea value is byte-identical
    async with bk_sessionmaker() as s:
        blob = (await s.execute(text("SELECT payload FROM bk_bytea_probe WHERE id=1"))).scalar_one()
    assert bytes(blob) == bytes(range(256))

    # (e) schema-version markers UNCHANGED by the restore — assert on the delta
    #     vs. the pre-restore baseline (the real product guarantee), not just an
    #     absolute constant.
    async with bk_sessionmaker() as s:
        core_after = (await s.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        ft_after = (await s.execute(text("SELECT version_num FROM ft_alembic_version"))).scalar_one()
    assert core_after == core_before, "restore moved alembic_version"
    assert ft_after == ft_before, "restore moved ft_alembic_version"
    assert core_after == CORE_ALEMBIC_VERSION
    assert ft_after == FT_ALEMBIC_VERSION
    assert body["schema_version_drift"]["alembic_version"]["match"] is True
    assert body["schema_version_drift"]["ft_alembic_version"]["match"] is True

    # Report the exercised table count for the Gate-5 record.
    print(f"\n[GATE5] round-trip exercised {len(seeded_tables)} tables with rows: {seeded_tables}")
    print(f"[GATE5] total covered tables in file: {len(file1['covered_tables'])}")


# ══════════════════════════════════════════════════════════════════════════════
# C-1 — insufficient-privilege 500 (SET LOCAL session_replication_role rejected)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def deny_replication_role(monkeypatch):
    """Make every ``SET LOCAL session_replication_role`` execute raise, as a
    non-superuser role would. All other statements pass straight through."""
    orig = sa_asyncio.AsyncSession.execute

    async def _patched(self, statement, *args, **kwargs):
        if "session_replication_role" in str(statement):
            raise RuntimeError("permission denied to set parameter "
                               '"session_replication_role"')
        return await orig(self, statement, *args, **kwargs)

    monkeypatch.setattr(sa_asyncio.AsyncSession, "execute", _patched)


async def test_v2_restore_insufficient_privilege_returns_500(
    admin_bk_client, bk_sessionmaker, deny_replication_role
):
    payload = {
        "version": "2.0",
        "created_at": "2026-01-01T00:00:00+00:00",
        "covered_tables": ["dr_mappings"],
        "checksums": {},
        "tables": {"dr_mappings": []},
    }
    files = {"file": ("b.json.gz", _gz(payload), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 500, r.text
    body = r.json()
    assert body["type"] == "urn:backup:error:insufficient-privilege"
    assert "legacy_backup" not in body or body.get("legacy_backup") is not True
    # transaction was rolled back — nothing landed
    assert await _count(bk_sessionmaker, "dr_mappings") == 0


async def test_legacy_restore_insufficient_privilege_returns_500(
    admin_bk_client, bk_sessionmaker, deny_replication_role
):
    legacy = {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": {"dr_mappings": []},
    }
    files = {"file": ("legacy.json.gz", _gz(legacy), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 500, r.text
    body = r.json()
    assert body["type"] == "urn:backup:error:insufficient-privilege"
    assert body["legacy_backup"] is True


# ══════════════════════════════════════════════════════════════════════════════
# _do_restore — bad mode / non-object payload
# ══════════════════════════════════════════════════════════════════════════════

async def test_restore_unknown_mode_rejected_400(admin_bk_client, bk_sessionmaker):
    payload = {
        "version": "2.0", "covered_tables": ["dr_mappings"], "checksums": {},
        "tables": {"dr_mappings": []},
    }
    files = {"file": ("b.json.gz", _gz(payload), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files, params={"mode": "sideways"}
    )
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:bad-mode"


async def test_restore_upload_non_object_json_rejected_400(admin_bk_client):
    files = {"file": ("arr.json.gz", _gz_raw(b"[1, 2, 3]"), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 400, r.text
    body = r.json()
    assert body["type"] == "urn:backup:error:invalid-file"
    assert "JSON object" in body["detail"]


# ══════════════════════════════════════════════════════════════════════════════
# legacy path — unknown column / mid-restore failure / empty covered table
# ══════════════════════════════════════════════════════════════════════════════

async def test_legacy_restore_unknown_column_rejected_422(admin_bk_client, bk_sessionmaker):
    legacy = {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": {
            "dr_mappings": [
                {
                    "id": 1, "dr_symbol": "LEG-DR", "parent_symbol": "LEGUSD",
                    "parent_market": "CRYPTO", "ratio": 10, "is_active": True,
                    "ghost_column": "boo",
                }
            ]
        },
    }
    files = {"file": ("legacy.json.gz", _gz(legacy), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["type"] == "urn:backup:error:unknown-column"
    assert body["legacy_backup"] is True
    assert any("ghost_column" in e for e in body["errors"])
    assert await _count(bk_sessionmaker, "dr_mappings") == 0


async def test_legacy_restore_mid_failure_full_rollback_422(admin_bk_client, bk_sessionmaker):
    # CHECK constraints fire even under session_replication_role=replica, so a
    # negative ft_bond.amount is a deterministic mid-restore failure.
    legacy = {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": {
            "dr_mappings": [
                {
                    "id": 1, "dr_symbol": "LEG-DR", "parent_symbol": "LEGUSD",
                    "parent_market": "CRYPTO", "ratio": 10, "is_active": True,
                }
            ],
            "ft_bond": [
                {
                    "id": BOND_ID, "tracking_item_id": ITEM_BOND, "code": "BAD",
                    "issuer": "X", "start_date": "2026-01-01",
                    "expired_date": "2030-01-01", "amount": -1,
                }
            ],
        },
    }
    files = {"file": ("legacy.json.gz", _gz(legacy), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["type"] == "urn:backup:error:restore-failed"
    assert body["legacy_backup"] is True
    assert body["errors"]
    # dr_mappings row that "succeeded" before the failure is rolled back too
    assert await _count(bk_sessionmaker, "dr_mappings") == 0
    assert await _count(bk_sessionmaker, "ft_bond") == 0


async def test_legacy_restore_empty_covered_table_reports_zero(admin_bk_client, bk_sessionmaker):
    legacy = {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": {
            "dr_mappings": [
                {
                    "id": 1, "dr_symbol": "LEG-DR", "parent_symbol": "LEGUSD",
                    "parent_market": "CRYPTO", "ratio": 10, "is_active": True,
                }
            ],
            "portfolios": [],
        },
    }
    files = {"file": ("legacy.json.gz", _gz(legacy), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["restored"]["dr_mappings"] == 1
    assert body["restored"]["portfolios"] == 0
    assert body["checksum_verification"]["portfolios"] == "skipped"


# ══════════════════════════════════════════════════════════════════════════════
# PSV import — unknown table / header-only / replace+confirm / import-failed
# ══════════════════════════════════════════════════════════════════════════════

async def test_psv_import_unknown_table_rejected_400(admin_bk_client):
    files = {"file": ("x.psv", b"a|b\n1|2\n", "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/no_such_table", files=files)
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:unknown-identifier"


async def test_psv_import_header_only_rejected_400(admin_bk_client):
    files = {"file": ("x.psv", b"id|user_id|name\n", "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/ft_tracking_set?mode=append", files=files)
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:invalid-file"


async def test_psv_import_replace_with_confirm_truncates_then_loads(
    admin_bk_client, bk_sessionmaker
):
    await _seed_full(bk_sessionmaker)
    assert await _count(bk_sessionmaker, "ft_tracking_set") == 1
    new_id = str(uuid.uuid4())
    psv = f"id|user_id|name|description\n{new_id}|{UID}|Replaced Set|hi\n".encode()
    files = {"file": ("s.psv", psv, "text/plain")}
    r = await admin_bk_client.post(
        f"{API}/import-table/ft_tracking_set",
        files=files,
        params={"mode": "replace", "confirm": "REPLACE ft_tracking_set"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1
    async with bk_sessionmaker() as s:
        names = (await s.execute(text("SELECT name FROM ft_tracking_set"))).scalars().all()
    assert names == ["Replaced Set"]  # old row truncated


async def test_psv_import_bad_value_returns_422(admin_bk_client, bk_sessionmaker):
    await _seed_full(bk_sessionmaker)
    # 'ratio' is numeric; a non-numeric token makes asyncpg raise -> 422 import-failed
    psv = b"dr_symbol|parent_symbol|parent_market|ratio|is_active\nZZ-DR|ZZ|CRYPTO|not-a-number|true\n"
    files = {"file": ("dr.psv", psv, "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/dr_mappings?mode=append", files=files)
    assert r.status_code == 422, r.text
    assert r.json()["type"] == "urn:backup:error:import-failed"
    # original seeded row still intact, rollback held
    assert await _count(bk_sessionmaker, "dr_mappings") == 1


# ══════════════════════════════════════════════════════════════════════════════
# list metadata — valid JSON, neither covered_tables nor tables
# ══════════════════════════════════════════════════════════════════════════════

async def test_list_backup_valid_json_without_table_info(admin_bk_client, bk_backup_dir):
    with gzip.open(bk_backup_dir / "backup_20201231_000000.json.gz", "wb") as fh:
        fh.write(json.dumps({"version": "9.9", "note": "no tables here"}).encode())
    r = await admin_bk_client.get(f"{API}/list")
    assert r.status_code == 200, r.text
    item = {i["filename"]: i for i in r.json()}["backup_20201231_000000.json.gz"]
    assert item["version"] == "9.9"
    assert item["covered_table_count"] is None


# ══════════════════════════════════════════════════════════════════════════════
# pure helpers
# ══════════════════════════════════════════════════════════════════════════════

def test_verify_checksum_branches():
    assert _verify_checksum([], None) == "skipped"
    assert _verify_checksum([], "") == "skipped"
    rows = [{"id": 1, "v": "a"}]
    good = table_checksum(rows)
    assert _verify_checksum(rows, good) == "ok"
    assert _verify_checksum(rows, "sha256:deadbeef") == "mismatch"


def test_schema_version_num_branches():
    assert _schema_version_num(None) is None
    assert _schema_version_num([]) is None
    assert _schema_version_num([{"version_num": "abc123"}]) == "abc123"
    assert _schema_version_num([{"other": "x"}]) is None
