"""Integration tests for the backup/restore API against a disposable database.

All tests run against ``investment_backup_test_db`` (see conftest). They never
read or write ``investment_db`` / ``investment_test_db``.
"""

from __future__ import annotations

import asyncio
import gzip
import io
import json
import uuid

import pytest
from sqlalchemy import text

import app.api.v1.endpoints.backup as backup_mod
from tests.backup.conftest import FT_ALEMBIC_VERSION

pytestmark = pytest.mark.asyncio

API = "/api/v1/backup"

# Fixed UUIDs so assertions can reference seeded rows directly.
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


async def _seed_full(sm) -> None:
    """Seed a complete ft_* chain (incl. ft_bond) plus a core dr_mappings row."""
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
        await s.commit()


async def _count(sm, table: str) -> int:
    async with sm() as s:
        return (await s.execute(text(f'SELECT count(*) FROM "{table}"'))).scalar_one()


async def _truncate_data(sm) -> None:
    """Empty every data table (keeps only the two alembic marker rows)."""
    async with sm() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT c.relname FROM pg_class c JOIN pg_namespace n "
                    "ON n.oid = c.relnamespace WHERE c.relkind='r' "
                    "AND n.nspname='public' "
                    "AND c.relname NOT IN ('alembic_version','ft_alembic_version')"
                )
            )
        ).fetchall()
        idents = ", ".join(f'"{r[0]}"' for r in rows)
        await s.execute(text(f"TRUNCATE TABLE {idents} RESTART IDENTITY CASCADE"))
        await s.commit()


async def _read_backup(path) -> dict:
    with gzip.open(path, "rb") as fh:
        return json.loads(fh.read().decode("utf-8"))


def _gz_bytes(obj: dict) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as fh:
        fh.write(json.dumps(obj).encode("utf-8"))
    return buf.getvalue()


# ── discovery ──────────────────────────────────────────────────────────────

async def test_tables_endpoint_discovers_all_including_ft_bond(admin_bk_client, bk_sessionmaker):
    # A view must NOT appear in the catalogue (relkind filter).
    async with bk_sessionmaker() as s:
        await s.execute(text("CREATE OR REPLACE VIEW v_backup_probe AS SELECT 1 AS x"))
        await s.commit()
    try:
        r = await admin_bk_client.get(f"{API}/tables")
        assert r.status_code == 200, r.text
        body = r.json()
        names = [t["name"] for t in body["tables"]]

        async with bk_sessionmaker() as s:
            expected = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                        "ON n.oid = c.relnamespace WHERE c.relkind='r' "
                        "AND NOT c.relispartition AND n.nspname='public'"
                    )
                )
            ).scalar_one()

        assert body["total_tables"] == expected == len(names)
        assert "ft_bond" in names
        assert "v_backup_probe" not in names
        # schema-version tables are present but flagged non-restorable
        sv = {t["name"]: t for t in body["tables"] if t["name"].endswith("alembic_version")}
        assert set(sv) == {"alembic_version", "ft_alembic_version"}
        for meta in sv.values():
            assert meta["restorable"] is False
            assert meta["in_conflict_check"] is False
        # owner-service mapping
        owners = {t["name"]: t["owner_service"] for t in body["tables"]}
        assert owners["ft_tracking_item"] == "tracking-backend"
        assert owners["users"] == "backend"
        # FK-safe order
        order = body["insert_order"]
        assert order.index("ft_tracking_set") < order.index("ft_category")
        assert order.index("ft_tracking_item") < order.index("ft_bond")
    finally:
        async with bk_sessionmaker() as s:
            await s.execute(text("DROP VIEW IF EXISTS v_backup_probe"))
            await s.commit()


# ── create_backup shape ────────────────────────────────────────────────────

async def test_create_backup_v2_shape_and_schema_version_isolation(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    r = await admin_bk_client.post(f"{API}/create")
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["version"] == "2.0"

    payload = await _read_backup(bk_backup_dir / meta["filename"])
    for key in (
        "version", "created_at", "created_by", "source_db", "generator",
        "covered_tables", "insert_order", "excluded_tables", "row_counts",
        "checksums", "schema_versions", "tables",
    ):
        assert key in payload, f"missing {key}"

    # schema-version tables excluded from data, kept in schema_versions/excluded
    assert "alembic_version" not in payload["tables"]
    assert "ft_alembic_version" not in payload["tables"]
    assert set(payload["excluded_tables"]) == {"alembic_version", "ft_alembic_version"}
    assert payload["schema_versions"]["ft_alembic_version"][0]["version_num"] == FT_ALEMBIC_VERSION

    # every covered table has a checksum and a row_count
    for tbl in payload["covered_tables"]:
        assert payload["checksums"][tbl].startswith("sha256:")
        assert tbl in payload["row_counts"]
    assert payload["tables"]["ft_bond"][0]["code"] == "BND1"
    assert payload["row_counts"]["ft_tracking_item"] == 2


# ── round-trip fidelity ────────────────────────────────────────────────────

async def test_round_trip_replace_all(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    r = await admin_bk_client.post(f"{API}/create")
    filename = r.json()["filename"]
    original_counts = r.json()["row_counts"]

    await _truncate_data(bk_sessionmaker)

    r = await admin_bk_client.post(
        f"{API}/restore/{filename}",
        json={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["legacy_backup"] is False
    assert body["mode"] == "replace_all"
    assert set(body["checksum_verification"].values()) == {"ok"}
    for tbl, cnt in original_counts.items():
        if cnt:
            assert body["restored"][tbl] == cnt
    assert await _count(bk_sessionmaker, "ft_bond") == 1
    assert await _count(bk_sessionmaker, "ft_tracking_item") == 2


async def test_safe_restore_into_empty_db(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    filename = (await admin_bk_client.post(f"{API}/create")).json()["filename"]

    await _truncate_data(bk_sessionmaker)

    r = await admin_bk_client.post(f"{API}/restore/{filename}")  # default skip_if_conflict
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["restored"]["ft_bond"] == 1
    assert all(v in ("ok", "skipped") for v in body["checksum_verification"].values())
    assert body["checksum_verification"]["ft_bond"] == "ok"


# ── conflict / confirmation guards ─────────────────────────────────────────

async def test_restore_conflict_blocks_all_writes(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    filename = (await admin_bk_client.post(f"{API}/create")).json()["filename"]

    # empty everything, then leave exactly one covered table non-empty
    await _truncate_data(bk_sessionmaker)
    async with bk_sessionmaker() as s:
        await s.execute(
            text(
                "INSERT INTO dr_mappings "
                "(dr_symbol, parent_symbol, parent_market, ratio, is_active) "
                "VALUES ('X-DR','XUSD','CRYPTO',1,true)"
            )
        )
        await s.commit()

    r = await admin_bk_client.post(f"{API}/restore/{filename}")
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["status"] == 409
    assert "detail" in body  # backward-compat field retained
    conflicting = {c["table"] for c in body["conflicting_tables"]}
    assert "dr_mappings" in conflicting

    # nothing was written anywhere
    assert await _count(bk_sessionmaker, "dr_mappings") == 1
    assert await _count(bk_sessionmaker, "ft_bond") == 0
    assert await _count(bk_sessionmaker, "ft_tracking_set") == 0


async def test_replace_all_requires_exact_confirm(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    filename = (await admin_bk_client.post(f"{API}/create")).json()["filename"]
    before = await _count(bk_sessionmaker, "ft_bond")

    r = await admin_bk_client.post(f"{API}/restore/{filename}", json={"mode": "replace_all"})
    assert r.status_code == 400
    r = await admin_bk_client.post(
        f"{API}/restore/{filename}", json={"mode": "replace_all", "confirm": "replace all data"}
    )
    assert r.status_code == 400
    # unchanged
    assert await _count(bk_sessionmaker, "ft_bond") == before


# ── alembic isolation + drift ─────────────────────────────────────────────

async def test_alembic_version_never_written_drift_reported(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    filename = (await admin_bk_client.post(f"{API}/create")).json()["filename"]

    # simulate the live DB drifting ahead of the backup
    async with bk_sessionmaker() as s:
        await s.execute(text("UPDATE ft_alembic_version SET version_num = 'ZZZ_LIVE'"))
        await s.commit()

    r = await admin_bk_client.post(
        f"{API}/restore/{filename}",
        json={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    drift = r.json()["schema_version_drift"]["ft_alembic_version"]
    assert drift == {"file": FT_ALEMBIC_VERSION, "live": "ZZZ_LIVE", "match": False}

    async with bk_sessionmaker() as s:
        live = (await s.execute(text("SELECT version_num FROM ft_alembic_version"))).scalar_one()
    assert live == "ZZZ_LIVE"  # untouched by restore


# ── legacy backup ─────────────────────────────────────────────────────────

async def test_legacy_v1_1_backup_upload(admin_bk_client, bk_sessionmaker):
    legacy = {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": {
            "dr_mappings": [
                {
                    "id": 1,
                    "dr_symbol": "LEG-DR",
                    "parent_symbol": "LEGUSD",
                    "parent_market": "CRYPTO",
                    "ratio": 10,
                    "description": None,
                    "is_active": True,
                }
            ]
        },
    }
    files = {"file": ("backup_legacy.json.gz", _gz_bytes(legacy), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["legacy_backup"] is True
    assert body["mode"] == "legacy"
    assert body["restored"]["dr_mappings"] == 1
    assert body["checksum_verification"]["dr_mappings"] == "skipped"
    assert len(body["uncovered_tables"]) > 0
    assert await _count(bk_sessionmaker, "dr_mappings") == 1


# ── malformed inputs ─────────────────────────────────────────────────────

async def test_upload_not_gzip(admin_bk_client):
    files = {"file": ("x.gz", b"this is definitely not gzip", "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 400


async def test_upload_bad_json(admin_bk_client):
    files = {"file": ("x.json", b"{not valid json", "application/json")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 400


async def test_upload_missing_tables_key(admin_bk_client):
    payload = {"version": "2.0", "covered_tables": [], "checksums": {}}
    files = {"file": ("b.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 400
    assert "tables" in r.json()["detail"]


async def test_gzip_bomb_rejected_with_413(admin_bk_client, monkeypatch):
    monkeypatch.setattr(backup_mod, "BACKUP_MAX_UNCOMPRESSED_BYTES", 512)
    bomb = io.BytesIO()
    with gzip.GzipFile(fileobj=bomb, mode="wb") as fh:
        fh.write(b"0" * 200_000)
    files = {"file": ("bomb.json.gz", bomb.getvalue(), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 413
    assert r.json()["status"] == 413


# ── checksum mismatch is surfaced, not fatal ─────────────────────────────

async def test_checksum_mismatch_after_row_edit(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    meta = (await admin_bk_client.post(f"{API}/create")).json()
    payload = await _read_backup(bk_backup_dir / meta["filename"])

    # tamper with a data row but leave the stored checksum intact
    payload["tables"]["dr_mappings"][0]["parent_symbol"] = "TAMPERED"

    await _truncate_data(bk_sessionmaker)

    files = {"file": ("edited.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 200, r.text
    cv = r.json()["checksum_verification"]
    assert cv["dr_mappings"] == "mismatch"
    assert cv["ft_bond"] == "ok"


# ── identifier injection ────────────────────────────────────────────────

async def test_export_table_identifier_injection_rejected(admin_bk_client, bk_sessionmaker):
    r = await admin_bk_client.get(f"{API}/export-table/users;DROP TABLE users")
    assert r.status_code == 400
    # the users table was not dropped — the count query still resolves
    assert await _count(bk_sessionmaker, "users") >= 0


# ── PSV ────────────────────────────────────────────────────────────────

async def test_psv_export_ft_tracking_item(admin_bk_client, bk_sessionmaker):
    await _seed_full(bk_sessionmaker)
    r = await admin_bk_client.get(f"{API}/export-table/ft_tracking_item")
    assert r.status_code == 200
    lines = [ln for ln in r.text.splitlines() if ln.strip()]
    assert lines[0].split("|")[:3] == ["id", "user_id", "sub_category_id"]
    assert len(lines) == 3  # header + 2 rows


async def test_psv_import_append_and_replace_guard(admin_bk_client, bk_sessionmaker):
    await _seed_full(bk_sessionmaker)
    new_id = str(uuid.uuid4())
    psv = f"id|user_id|name|description\n{new_id}|{UID}|Imported Set|hello\n"

    # replace without confirm -> 400, no write
    files = {"file": ("s.psv", psv.encode(), "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/ft_tracking_set?mode=replace", files=files)
    assert r.status_code == 400
    assert await _count(bk_sessionmaker, "ft_tracking_set") == 1

    # append -> inserted
    files = {"file": ("s.psv", psv.encode(), "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/ft_tracking_set?mode=append", files=files)
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1
    assert await _count(bk_sessionmaker, "ft_tracking_set") == 2


# ── FK ordering recomputed from live catalogue ─────────────────────────

async def test_restore_recomputes_order_from_live_catalogue(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    meta = (await admin_bk_client.post(f"{API}/create")).json()
    payload = await _read_backup(bk_backup_dir / meta["filename"])

    # scramble: child tables first, parents last, in both list fields and the dict
    scrambled = ["ft_bond", "ft_update_tracking_list_balance", "ft_initial_investment_entry",
                 "ft_tracking_item", "ft_sub_category", "ft_category", "ft_update_tracking_list",
                 "ft_tracking_set"]
    rest = [t for t in payload["covered_tables"] if t not in scrambled]
    payload["covered_tables"] = scrambled + rest
    payload["insert_order"] = list(payload["covered_tables"])
    payload["tables"] = {k: payload["tables"].get(k, []) for k in payload["covered_tables"]}

    await _truncate_data(bk_sessionmaker)

    files = {"file": ("scr.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload?mode=replace_all&confirm=REPLACE%20ALL%20DATA",
        files=files,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["errors"] == []
    order = body["covered_tables"]
    assert order.index("ft_tracking_set") < order.index("ft_category") < order.index("ft_sub_category")
    assert order.index("ft_tracking_item") < order.index("ft_bond")
    assert await _count(bk_sessionmaker, "ft_bond") == 1


# ── list metadata enrichment ───────────────────────────────────────────

async def test_list_backups_enriches_version_and_tolerates_corruption(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    created = (await admin_bk_client.post(f"{API}/create")).json()["filename"]

    # a legacy file and a corrupt file alongside the real v2.0 one
    with gzip.open(bk_backup_dir / "backup_20200101_000000.json.gz", "wb") as fh:
        fh.write(json.dumps({"version": "1.1", "tables": {"a": [], "b": []}}).encode())
    (bk_backup_dir / "backup_20190101_000000.json.gz").write_bytes(b"not a gzip file")

    async with bk_sessionmaker() as s:
        total = (
            await s.execute(
                text(
                    "SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                    "ON n.oid = c.relnamespace WHERE c.relkind='r' "
                    "AND NOT c.relispartition AND n.nspname='public'"
                )
            )
        ).scalar_one()
    expected_covered = total - 2  # both alembic marker tables are excluded

    r = await admin_bk_client.get(f"{API}/list")
    assert r.status_code == 200
    by_name = {item["filename"]: item for item in r.json()}

    assert by_name[created]["version"] == "2.0"
    assert by_name[created]["covered_table_count"] == expected_covered
    assert by_name["backup_20200101_000000.json.gz"]["version"] == "1.1"
    assert by_name["backup_20200101_000000.json.gz"]["covered_table_count"] == 2
    assert by_name["backup_20190101_000000.json.gz"]["version"] == "unknown"
    assert by_name["backup_20190101_000000.json.gz"]["covered_table_count"] is None


async def test_delete_and_download_stored_backup(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    fn = (await admin_bk_client.post(f"{API}/create")).json()["filename"]

    dl = await admin_bk_client.get(f"{API}/download/{fn}")
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "application/gzip"

    bad = await admin_bk_client.delete(f"{API}/not-a-backup.txt")
    assert bad.status_code == 400
    missing = await admin_bk_client.delete(f"{API}/backup_29990101_000000.json.gz")
    assert missing.status_code == 404

    ok = await admin_bk_client.delete(f"{API}/{fn}")
    assert ok.status_code == 200
    assert not (bk_backup_dir / fn).exists()


# ── authz ────────────────────────────────────────────────────────────────

async def test_analyst_forbidden(analyst_bk_client):
    for method, path in [
        ("get", f"{API}/tables"),
        ("post", f"{API}/create"),
        ("get", f"{API}/list"),
    ]:
        r = await getattr(analyst_bk_client, method)(path)
        assert r.status_code == 403, f"{path} -> {r.status_code}"


async def test_missing_jwt_unauthorized(noauth_bk_client):
    r = await noauth_bk_client.get(f"{API}/tables")
    assert r.status_code == 401
    r = await noauth_bk_client.post(f"{API}/create")
    assert r.status_code == 401


# ── retention ────────────────────────────────────────────────────────────

async def test_retention_prunes_to_limit(admin_bk_client, bk_sessionmaker, bk_backup_dir, monkeypatch):
    monkeypatch.setattr(backup_mod, "BACKUP_RETENTION", 2)
    # pre-place three older backups
    for stamp in ("20200101_000001", "20200101_000002", "20200101_000003"):
        p = bk_backup_dir / f"backup_{stamp}.json.gz"
        with gzip.open(p, "wb") as fh:
            fh.write(b'{"version":"2.0","covered_tables":[],"tables":{}}')

    r = await admin_bk_client.post(f"{API}/create")
    assert r.status_code == 200
    remaining = sorted(p.name for p in bk_backup_dir.glob("backup_*.json.gz"))
    assert len(remaining) == 2
    # the freshly-created file is one of the survivors
    assert r.json()["filename"] in remaining


# ── B-1: legacy restore is no longer unconditionally destructive ──────────

_LEGACY_DR_ROW = {
    "id": 1,
    "dr_symbol": "LEG-DR",
    "parent_symbol": "LEGUSD",
    "parent_market": "CRYPTO",
    "ratio": 10,
    "description": None,
    "is_active": True,
}


def _legacy_v11(rows_by_table: dict) -> dict:
    return {
        "version": "1.1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "tables": rows_by_table,
    }


async def _insert_dr(sm, symbol: str) -> None:
    async with sm() as s:
        await s.execute(
            text(
                "INSERT INTO dr_mappings "
                "(dr_symbol, parent_symbol, parent_market, ratio, is_active) "
                "VALUES (:d, 'X', 'CRYPTO', 1, true)"
            ),
            {"d": symbol},
        )
        await s.commit()


async def test_legacy_restore_conflict_blocks_all_writes(admin_bk_client, bk_sessionmaker):
    await _insert_dr(bk_sessionmaker, "PREEXISTING")
    files = {"file": ("legacy.json.gz", _gz_bytes(_legacy_v11({"dr_mappings": [_LEGACY_DR_ROW]})),
                      "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)  # skip_if_conflict
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["status"] == 409
    assert body["legacy_backup"] is True
    assert "dr_mappings" in {c["table"] for c in body["conflicting_tables"]}
    # nothing written / truncated
    async with bk_sessionmaker() as s:
        rows = (await s.execute(text("SELECT dr_symbol FROM dr_mappings"))).scalars().all()
    assert rows == ["PREEXISTING"]
    assert await _count(bk_sessionmaker, "ft_bond") == 0


async def test_legacy_restore_replace_all_with_confirm_succeeds(admin_bk_client, bk_sessionmaker):
    await _insert_dr(bk_sessionmaker, "PREEXISTING")
    files = {"file": ("legacy.json.gz", _gz_bytes(_legacy_v11({"dr_mappings": [_LEGACY_DR_ROW]})),
                      "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["legacy_backup"] is True
    assert r.json()["restored"]["dr_mappings"] == 1
    async with bk_sessionmaker() as s:
        rows = (await s.execute(text("SELECT dr_symbol FROM dr_mappings"))).scalars().all()
    assert rows == ["LEG-DR"]  # old row truncated, file row loaded


@pytest.mark.parametrize("confirm", [None, "replace all data", "REPLACE  ALL DATA"])
async def test_legacy_restore_replace_all_bad_confirm_no_writes(
    admin_bk_client, bk_sessionmaker, confirm
):
    await _insert_dr(bk_sessionmaker, "PREEXISTING")
    params = {"mode": "replace_all"}
    if confirm is not None:
        params["confirm"] = confirm
    files = {"file": ("legacy.json.gz", _gz_bytes(_legacy_v11({"dr_mappings": [_LEGACY_DR_ROW]})),
                      "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files, params=params)
    assert r.status_code == 400, r.text
    assert r.json()["legacy_backup"] is True
    async with bk_sessionmaker() as s:
        rows = (await s.execute(text("SELECT dr_symbol FROM dr_mappings"))).scalars().all()
    assert rows == ["PREEXISTING"]


async def test_restore_unsupported_version_rejected(admin_bk_client, bk_sessionmaker):
    payload = {"version": "2.1", "tables": {"dr_mappings": [_LEGACY_DR_ROW]}}
    files = {"file": ("v21.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(f"{API}/restore/upload", files=files)
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:unsupported-version"
    assert await _count(bk_sessionmaker, "dr_mappings") == 0


# ── B-2: PSV endpoints must not touch the alembic marker tables ───────────

async def test_psv_export_rejects_schema_version_table(admin_bk_client):
    r = await admin_bk_client.get(f"{API}/export-table/alembic_version")
    assert r.status_code == 400
    assert r.json()["type"] == "urn:backup:error:schema-version-table"


async def test_psv_import_rejects_schema_version_table(admin_bk_client, bk_sessionmaker):
    async with bk_sessionmaker() as s:
        before = (await s.execute(text("SELECT version_num FROM ft_alembic_version"))).scalar_one()
    files = {"file": ("v.psv", b"version_num\nHACKED\n", "text/plain")}
    r = await admin_bk_client.post(
        f"{API}/import-table/ft_alembic_version", files=files,
        params={"mode": "replace", "confirm": "REPLACE ft_alembic_version"},
    )
    assert r.status_code == 400
    assert r.json()["type"] == "urn:backup:error:schema-version-table"
    async with bk_sessionmaker() as s:
        after = (await s.execute(text("SELECT version_num FROM ft_alembic_version"))).scalar_one()
    assert after == before


# ── B-3: advisory lock also guards the restore path ──────────────────────

async def test_concurrent_restores_serialize(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    await _seed_full(bk_sessionmaker)
    payload = await _read_backup(
        bk_backup_dir / (await admin_bk_client.post(f"{API}/create")).json()["filename"]
    )
    await _truncate_data(bk_sessionmaker)

    def _files():
        return {"file": ("c.json.gz", _gz_bytes(payload), "application/gzip")}

    p = {"mode": "replace_all", "confirm": "REPLACE ALL DATA"}
    r1, r2 = await asyncio.gather(
        admin_bk_client.post(f"{API}/restore/upload", files=_files(), params=p),
        admin_bk_client.post(f"{API}/restore/upload", files=_files(), params=p),
    )
    assert {r1.status_code, r2.status_code} == {200}, (r1.text, r2.text)
    # serialised replace_all runs leave a single consistent copy
    assert await _count(bk_sessionmaker, "ft_bond") == 1
    assert await _count(bk_sessionmaker, "ft_tracking_item") == 2
    assert await _count(bk_sessionmaker, "dr_mappings") == 1


# ── H-1: a binary column survives backup -> restore ──────────────────────

async def test_bytea_column_round_trips(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    blob = bytes(range(256))
    async with bk_sessionmaker() as s:
        await s.execute(
            text("INSERT INTO bk_bytea_probe (id, payload) VALUES (1, :p)"), {"p": blob}
        )
        await s.commit()

    meta = (await admin_bk_client.post(f"{API}/create")).json()
    payload = await _read_backup(bk_backup_dir / meta["filename"])
    stored = payload["tables"]["bk_bytea_probe"][0]["payload"]
    assert isinstance(stored, str)  # base64, not a JSON-broken blob

    await _truncate_data(bk_sessionmaker)

    r = await admin_bk_client.post(
        f"{API}/restore/{meta['filename']}",
        json={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["checksum_verification"]["bk_bytea_probe"] == "ok"
    async with bk_sessionmaker() as s:
        got = (await s.execute(text("SELECT payload FROM bk_bytea_probe WHERE id = 1"))).scalar_one()
    assert bytes(got) == blob


# ── H-2: error bodies are problem+json with a back-compat detail ─────────

async def test_backup_error_bodies_are_problem_json(admin_bk_client):
    r = await admin_bk_client.get(f"{API}/download/not-a-backup")
    assert r.status_code == 400
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["type"].startswith("urn:backup:error:")
    assert body["status"] == 400
    assert isinstance(body["detail"], str)  # frontend reads .detail

    r = await admin_bk_client.delete(f"{API}/backup_29990101_000000.json.gz")
    assert r.status_code == 404
    assert isinstance(r.json()["detail"], str)


# ── M-2: columns are validated against the real catalogue ────────────────

async def test_restore_rejects_unknown_column_no_writes(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    meta = (await admin_bk_client.post(f"{API}/create")).json()
    payload = await _read_backup(bk_backup_dir / meta["filename"])
    payload["tables"]["dr_mappings"][0]["evil_col"] = "x"

    await _truncate_data(bk_sessionmaker)

    files = {"file": ("bad.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["type"] == "urn:backup:error:unknown-column"
    assert any("evil_col" in e for e in r.json()["errors"])
    assert await _count(bk_sessionmaker, "dr_mappings") == 0  # nothing written


async def test_psv_import_rejects_unknown_header_column(admin_bk_client, bk_sessionmaker):
    await _seed_full(bk_sessionmaker)
    psv = f"id|user_id|name|bogus\n{uuid.uuid4()}|{UID}|X|y\n"
    files = {"file": ("s.psv", psv.encode(), "text/plain")}
    r = await admin_bk_client.post(f"{API}/import-table/ft_tracking_set?mode=append", files=files)
    assert r.status_code == 422
    assert r.json()["type"] == "urn:backup:error:unknown-column"
    assert await _count(bk_sessionmaker, "ft_tracking_set") == 1


# ── M-5: a mid-restore constraint violation rolls the whole thing back ───

async def test_restore_partial_failure_full_rollback(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    await _seed_full(bk_sessionmaker)
    meta = (await admin_bk_client.post(f"{API}/create")).json()
    payload = await _read_backup(bk_backup_dir / meta["filename"])
    before = {t: await _count(bk_sessionmaker, t) for t in payload["covered_tables"]}

    # violate ck_ft_bond_amount_nonneg
    payload["tables"]["ft_bond"][0]["amount"] = -1

    files = {"file": ("bad.json.gz", _gz_bytes(payload), "application/gzip")}
    r = await admin_bk_client.post(
        f"{API}/restore/upload", files=files,
        params={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["errors"]

    after = {t: await _count(bk_sessionmaker, t) for t in payload["covered_tables"]}
    assert after == before  # replace_all truncate + reload fully rolled back

    # SET LOCAL reverted: FK enforcement is back on a fresh session
    async with bk_sessionmaker() as s:
        with pytest.raises(Exception):
            await s.execute(
                text(
                    "INSERT INTO ft_category (id, user_id, tracking_set_id, name) "
                    "VALUES (:i, :u, :s, 'orphan')"
                ),
                {"i": str(uuid.uuid4()), "u": UID, "s": str(uuid.uuid4())},
            )
            await s.commit()
        await s.rollback()
