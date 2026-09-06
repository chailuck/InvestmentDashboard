"""GATE 4 security-remediation tests for the backup/restore feature.

Covers the four findings from the security review:

* SEC-1  path-traversal / directory-escape on the ``filename`` path parameter
         of ``download`` / ``delete`` / ``restore/{filename}``.
* SEC-2  a freshly written backup file must be owner-only (``0o600``).
* SEC-3  the two hardcoded schema-version table reads go through ``_safe_ident``
         (behaviour unchanged — this is a regression guard).
* SEC-4  a ``SET LOCAL statement_timeout`` on the read/restore-heavy paths does
         not break the happy path (regression guard).

Every test runs against the disposable ``investment_backup_test_db`` (see
``conftest``); none touch ``investment_db`` / ``investment_test_db``.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest
from fastapi.responses import JSONResponse

import app.api.v1.endpoints.backup as backup_mod

API = "/api/v1/backup"

# A single-path-segment name carrying an escape attempt. The ``\`` bytes are
# pre-percent-encoded so httpx forwards them verbatim; Starlette unquotes them
# back to real backslashes before the handler runs, so the request reaches the
# endpoint (rather than 404-ing in the router) and must be refused with 400.
BSLASH_TRAVERSAL = "backup_%5C..%5C..%5C..%5Cetc%5Cpasswd.json.gz"
NORMAL_ABSENT = "backup_20260101_000000.json.gz"


# ── SEC-1: unit coverage of the containment helper ────────────────────────

@pytest.mark.parametrize(
    "bad_name",
    [
        "backup_../../etc/passwd.json.gz",         # literal forward slashes
        "backup_/../../etc/passwd.json.gz",
        "backup_\\..\\..\\etc\\passwd.json.gz",    # literal backslashes
        "backup_\x00.json.gz",                     # NUL byte
        "../backup_x.json.gz",
        "..",
        ".",
        "backup_x.txt",                            # wrong suffix
        "evil.json.gz",                            # wrong prefix
        "backup_.json",                            # wrong suffix
    ],
)
def test_resolve_backup_path_rejects_unsafe_names(bad_name, tmp_path, monkeypatch):
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", tmp_path)
    result = backup_mod._resolve_backup_path(bad_name, "/api/v1/backup/x")
    assert isinstance(result, JSONResponse)
    assert result.status_code == 400
    # RFC-9457 body carries the stable error type.
    assert b"urn:backup:error:invalid-filename" in result.body


def test_resolve_backup_path_accepts_normal_name(tmp_path, monkeypatch):
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", tmp_path)
    result = backup_mod._resolve_backup_path(NORMAL_ABSENT, "/api/v1/backup/x")
    assert isinstance(result, Path)
    assert result.parent == tmp_path.resolve()
    assert result.name == NORMAL_ABSENT


# ── SEC-1: endpoint coverage — download / delete / restore ────────────────

async def test_download_rejects_traversal_and_routes_normal_name(admin_bk_client, bk_backup_dir):
    r = await admin_bk_client.get(f"{API}/download/{BSLASH_TRAVERSAL}")
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:invalid-filename"

    # a well-formed but absent name still reaches the 404 path (unchanged).
    r = await admin_bk_client.get(f"{API}/download/{NORMAL_ABSENT}")
    assert r.status_code == 404
    assert r.json()["type"] == "urn:backup:error:not-found"


async def test_delete_rejects_traversal_and_routes_normal_name(admin_bk_client, bk_backup_dir):
    r = await admin_bk_client.delete(f"{API}/{BSLASH_TRAVERSAL}")
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:invalid-filename"

    r = await admin_bk_client.delete(f"{API}/{NORMAL_ABSENT}")
    assert r.status_code == 404
    assert r.json()["type"] == "urn:backup:error:not-found"


async def test_restore_stored_rejects_traversal_and_routes_normal_name(
    admin_bk_client, bk_backup_dir
):
    r = await admin_bk_client.post(f"{API}/restore/{BSLASH_TRAVERSAL}", json={})
    assert r.status_code == 400, r.text
    assert r.json()["type"] == "urn:backup:error:invalid-filename"

    r = await admin_bk_client.post(f"{API}/restore/{NORMAL_ABSENT}", json={})
    assert r.status_code == 404
    assert r.json()["type"] == "urn:backup:error:not-found"


# ── SEC-2: written backup file is owner-only ──────────────────────────────

async def test_created_backup_file_is_owner_only(admin_bk_client, bk_sessionmaker, bk_backup_dir):
    if os.name == "nt":  # pragma: no cover - dev-only path
        pytest.skip("Windows filesystem cannot represent POSIX 0o600 mode bits")

    r = await admin_bk_client.post(f"{API}/create")
    assert r.status_code == 200, r.text
    path = bk_backup_dir / r.json()["filename"]
    assert path.exists()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


# ── SEC-3: schema-version reads still work after routing through _safe_ident

async def test_schema_version_reads_still_resolve(admin_bk_client, bk_backup_dir):
    r = await admin_bk_client.get(f"{API}/tables")
    assert r.status_code == 200, r.text
    sv = {t["name"]: t for t in r.json()["tables"] if t["name"].endswith("alembic_version")}
    assert set(sv) == {"alembic_version", "ft_alembic_version"}
    for meta in sv.values():
        assert meta["row_count"] >= 1          # _load path via list_catalog_tables
        assert meta["restorable"] is False

    # create_backup reads the same tables via _load_schema_versions
    c = await admin_bk_client.post(f"{API}/create")
    assert c.status_code == 200, c.text


# ── SEC-4: statement-timeout guard does not break the happy paths ─────────

async def test_read_and_restore_paths_unaffected_by_statement_timeout(
    admin_bk_client, bk_sessionmaker, bk_backup_dir
):
    assert (await admin_bk_client.get(f"{API}/tables")).status_code == 200
    meta = (await admin_bk_client.post(f"{API}/create")).json()

    r = await admin_bk_client.post(
        f"{API}/restore/{meta['filename']}",
        json={"mode": "replace_all", "confirm": "REPLACE ALL DATA"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["legacy_backup"] is False
