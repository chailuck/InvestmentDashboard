"""Database backup and restore endpoints (backup format v2.0).

Design goals
------------
* **Dynamic table discovery.** No hard-coded table list. Tables and their
  FK-safe insert order are discovered from the live PostgreSQL catalogue on
  every call, so tables added by future migrations (or by a sibling service
  such as the Financial Tracker's ``ft_*`` tables, including ``ft_bond``) are
  covered automatically.
* **Non-destructive by default.** Restore refuses to touch a database that
  already holds data unless the caller explicitly opts into
  ``mode=replace_all`` and types the confirmation phrase.
* **Schema-version isolation.** ``alembic_version`` / ``ft_alembic_version``
  are never written by restore — a data restore must not silently roll a
  schema forward or backward. Drift between the file and the live DB is
  reported instead.
* **Integrity.** Every covered table carries a SHA-256 checksum in the file;
  restore recomputes and reports ``ok`` / ``mismatch`` / ``skipped`` per table.
* **Injection-safe.** Every dynamically built identifier goes through
  :func:`app.services.backup.safe_ident`; every value is a bound parameter.

Checksums
---------
The ``tables`` payload block and every per-table SHA-256 checksum share ONE
serialiser, :func:`json_default_payload` (``Decimal`` -> ``float``,
datetime/date -> ISO string, UUID -> str, ``bytes`` -> base64). Because the
checksum is computed over the SAME normalised shape that lands in the file, a
restore recomputes a byte-identical digest. The checksum therefore detects
**post-backup modification of the file**, not source fidelity: the
``Decimal`` -> ``float`` normalisation can round a high-precision numeric and
that rounding is invisible to the digest.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import stat
import zlib
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.core.logging import get_logger
from app.database.session import get_db
from app.models.user import User
from app.schemas.backup import BackupTablesResponse, RestoreOptions
from app.services.backup import (
    json_default_payload as _json_default,
    safe_ident as _safe_ident,
    table_checksum as _table_checksum,
    toposort as _toposort,
)

router = APIRouter(prefix="/backup", tags=["backup"])
_log = get_logger("backup")

# ── Module constants ────────────────────────────────────────────────────────

BACKUP_DIR = Path(os.getenv("BACKUP_DIR", "/app/uploads/backups"))
try:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
except OSError:  # pragma: no cover - read-only fs in some environments
    pass

BACKUP_FORMAT_VERSION = "2.0"
# Backup-file versions the legacy (pre-2.0) restore path knows how to read.
# ``None`` covers very old files that carry no ``version`` key at all.
KNOWN_LEGACY_VERSIONS: set[str | None] = {"1.0", "1.1", None}
SCHEMA_VERSION_TABLES = {"alembic_version", "ft_alembic_version"}
CONFIRM_PHRASE_ALL = "REPLACE ALL DATA"
BACKUP_RETENTION = int(os.getenv("BACKUP_RETENTION", "7"))
BACKUP_MAX_UNCOMPRESSED_BYTES = int(
    os.getenv("BACKUP_MAX_UNCOMPRESSED_BYTES", str(200 * 1024 * 1024))
)
# Arbitrary but stable key for pg_advisory_xact_lock so two concurrent
# create/restore calls serialise instead of racing.
_ADVISORY_LOCK_KEY = 917_283_641
_INSERT_CHUNK = 1000

UserAdmin = Annotated[User, Depends(require_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]

_PROBLEM_TITLES = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
}


# ── Serialisation helper for the payload block ──────────────────────────────

def _dump(data: Any) -> bytes:
    return json.dumps(data, default=_json_default, ensure_ascii=False).encode("utf-8")


# ── Problem+JSON helper ────────────────────────────────────────────────────

def problem(status: int, type_: str, detail: str, instance: str, **ext: Any) -> JSONResponse:
    """RFC-9457 style error body.

    Retains a top-level ``detail`` string for frontend backward-compatibility
    (older clients read ``error.detail`` / ``detail``).
    """
    body: dict[str, Any] = {
        "type": type_,
        "title": _PROBLEM_TITLES.get(status, "Error"),
        "status": status,
        "detail": detail,
        "instance": instance,
    }
    body.update(ext)
    return JSONResponse(status_code=status, content=body, media_type="application/problem+json")


def _scrub(exc: Exception) -> str:
    """Short, safe description of a DB error — never echoes SQL text / DSNs."""
    return type(exc).__name__


# ── Backup-file path containment (directory-traversal defence) ──────────────

def _resolve_backup_path(filename: str, instance: str) -> Path | JSONResponse:
    """Resolve ``filename`` to a path that is provably inside ``BACKUP_DIR``.

    Returns the resolved :class:`~pathlib.Path` on success, or an RFC-9457
    ``problem`` response when the name is unsafe. Rejected: any path separator
    (``/`` or ``\\``), a NUL byte, the bare ``.`` / ``..`` names, a name that
    does not match the ``backup_*.json.gz`` shape, or a name that — after
    resolution — does not sit directly in ``BACKUP_DIR``. The final
    ``candidate.parent != base`` check is defence-in-depth: it also catches a
    symlinked entry that points outside the directory.
    """
    if (
        "/" in filename
        or "\\" in filename
        or "\x00" in filename
        or filename in (".", "..")
        or not filename.startswith("backup_")
        or not filename.endswith(".json.gz")
    ):
        return problem(
            400, "urn:backup:error:invalid-filename", "invalid backup filename", instance
        )
    base = BACKUP_DIR.resolve()
    candidate = (base / filename).resolve()
    if candidate.parent != base:
        return problem(
            400, "urn:backup:error:invalid-filename", "invalid backup filename", instance
        )
    return candidate


# ── Catalogue discovery ────────────────────────────────────────────────────

async def _fk_edges(db: AsyncSession) -> list[tuple[str, str]]:
    """``(child, parent)`` FK pairs for base tables in schema ``public``."""
    rows = (
        await db.execute(
            text(
                """
                SELECT c.relname AS child, p.relname AS parent
                FROM pg_constraint con
                JOIN pg_class c      ON c.oid = con.conrelid
                JOIN pg_class p      ON p.oid = con.confrelid
                JOIN pg_namespace n  ON n.oid = c.relnamespace
                JOIN pg_namespace pn ON pn.oid = p.relnamespace
                WHERE con.contype = 'f'
                  AND n.nspname = 'public'
                  AND pn.nspname = 'public'
                """
            )
        )
    ).fetchall()
    return [(r.child, r.parent) for r in rows]


async def _discover_tables(db: AsyncSession) -> list[str]:
    """Live base tables in ``public``, returned in FK-safe INSERT order."""
    rows = (
        await db.execute(
            text(
                """
                SELECT c.relname AS name
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r'
                  AND NOT c.relispartition
                  AND n.nspname = 'public'
                """
            )
        )
    ).fetchall()
    names = sorted(r.name for r in rows)
    if not names:
        return []
    edges = await _fk_edges(db)
    return _toposort(names, edges)


async def _current_database(db: AsyncSession) -> str:
    return (await db.execute(text("SELECT current_database()"))).scalar_one()


async def _load_schema_versions(db: AsyncSession) -> dict[str, list[dict]]:
    """Read the alembic marker tables, tolerating their absence."""
    out: dict[str, list[dict]] = {}
    for tbl in sorted(SCHEMA_VERSION_TABLES):
        reg = (
            await db.execute(text("SELECT to_regclass(:q)"), {"q": f"public.{tbl}"})
        ).scalar()
        if reg is None:
            out[tbl] = []
            continue
        # Hardcoded name, but still routed through _safe_ident to honour the
        # module invariant that every interpolated identifier is validated.
        ident = _safe_ident(tbl, SCHEMA_VERSION_TABLES)
        rows = (await db.execute(text(f"SELECT * FROM {ident}"))).fetchall()
        out[tbl] = [dict(r._mapping) for r in rows]
    return out


def _schema_version_num(rows: list[dict] | None) -> str | None:
    if not rows:
        return None
    return rows[0].get("version_num")


def _owner_service(table: str) -> str:
    return "tracking-backend" if table.startswith("ft_") else "backend"


# ── Bounded gzip decompression ─────────────────────────────────────────────

class _BackupTooLarge(Exception):
    pass


def _bounded_gunzip(data: bytes, cap: int) -> bytes:
    """Decompress a gzip stream, aborting once output would exceed ``cap``."""
    dec = zlib.decompressobj(16 + zlib.MAX_WBITS)
    out = bytearray()
    view = memoryview(data)
    step = 1 << 20
    for start in range(0, len(view), step):
        chunk = dec.decompress(view[start : start + step], cap + 1 - len(out))
        out += chunk
        if len(out) > cap:
            raise _BackupTooLarge()
        while dec.unconsumed_tail:
            chunk = dec.decompress(dec.unconsumed_tail, cap + 1 - len(out))
            out += chunk
            if len(out) > cap:
                raise _BackupTooLarge()
    out += dec.flush()
    if len(out) > cap:
        raise _BackupTooLarge()
    return bytes(out)


# ── PSV single-table export / import ───────────────────────────────────────

@router.get("/export-table/{table}")
async def export_table_psv(table: str, admin: UserAdmin, db: DB):
    """Export a single table as a pipe-separated values file (PSV)."""
    instance = f"/api/v1/backup/export-table/{table}"
    if table in SCHEMA_VERSION_TABLES:
        return problem(
            400, "urn:backup:error:schema-version-table",
            "schema-version tables cannot be exported/imported via PSV", instance,
        )
    try:
        ident = _safe_ident(table, set(await _discover_tables(db)))
    except HTTPException as exc:
        return problem(400, "urn:backup:error:unknown-identifier", str(exc.detail), instance)

    result = await db.execute(text(f"SELECT * FROM {ident}"))
    cols = list(result.keys())
    rows = result.fetchall()

    def _fmt(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            return json.dumps(v, default=_json_default)
        return str(v).replace("|", "\\|").replace("\n", "\\n")

    lines = ["|".join(cols)]
    for row in rows:
        lines.append("|".join(_fmt(v) for v in row))
    content = "\n".join(lines) + "\n"

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{table}_{ts}.psv"
    _log.info(
        "backup.export_table", service_name="backend", actor=str(admin.id),
        table=table, rows=len(rows), outcome="ok",
    )
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import-table/{table}")
async def import_table_psv(
    table: str,
    admin: UserAdmin,
    db: DB,
    file: Annotated[UploadFile, File()],
    mode: str = "append",              # append | replace  (query param)
    confirm: str | None = None,        # query param
) -> Any:
    """Import a PSV file into a table.

    ``mode=append`` upserts (``ON CONFLICT DO NOTHING``). ``mode=replace``
    truncates the table first and therefore requires
    ``?confirm=REPLACE <table>``.
    """
    instance = f"/api/v1/backup/import-table/{table}"
    if table in SCHEMA_VERSION_TABLES:
        return problem(
            400, "urn:backup:error:schema-version-table",
            "schema-version tables cannot be exported/imported via PSV", instance,
        )

    live = set(await _discover_tables(db))
    try:
        ident = _safe_ident(table, live)
    except HTTPException as exc:
        return problem(400, "urn:backup:error:unknown-identifier", str(exc.detail), instance)

    if mode == "replace" and confirm != f"REPLACE {table}":
        return problem(
            400, "urn:backup:error:confirm-required",
            f"mode=replace requires confirm == 'REPLACE {table}'", instance, mode=mode,
        )

    raw = (await file.read()).decode("utf-8")
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if len(lines) < 2:
        return problem(
            400, "urn:backup:error:invalid-file",
            "file must have a header row and at least one data row", instance,
        )

    cols = lines[0].split("|")
    # Validate the uploaded header against the target's real catalogue columns,
    # not against itself.
    col_types = await _column_types(db, table)
    if not col_types:
        return problem(400, "urn:backup:error:unknown-identifier", f"unknown table: {table!r}", instance)
    unknown_cols = [c for c in cols if c not in col_types]
    if unknown_cols:
        return problem(
            422, "urn:backup:error:unknown-column",
            f"unknown column(s) for {table}: {unknown_cols}", instance, columns=unknown_cols,
        )
    try:
        col_idents = [_safe_ident(c, set(col_types)) for c in cols]
    except HTTPException as exc:
        return problem(422, "urn:backup:error:unknown-column", str(exc.detail), instance)
    # Sanitised positional bind keys so a column such as ``as of`` cannot break
    # the parameter list.
    param_keys = [f"p{i}" for i in range(len(cols))]

    def _parse(v: str) -> Any:
        v = v.replace("\\|", "|").replace("\\n", "\n")
        if v == "":
            return None
        if (v.startswith("{") and v.endswith("}")) or (v.startswith("[") and v.endswith("]")):
            try:
                return json.loads(v)
            except Exception:
                pass
        return v

    param_rows: list[dict] = []
    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) != len(cols):
            continue
        parsed = [_parse(p) for p in parts]
        param_rows.append(
            {param_keys[i]: _coerce(parsed[i], col_types.get(cols[i], "")) for i in range(len(cols))}
        )

    if not param_rows:
        return {"imported": 0, "table": table, "mode": mode}

    col_list = ", ".join(col_idents)
    placeholders = ", ".join(f":{k}" for k in param_keys)
    stmt = text(
        f"INSERT INTO {ident} ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
    )
    try:
        # SET LOCAL auto-reverts on COMMIT/ROLLBACK — no connection-scoped state
        # leaks back into the pool, no swallowed-exception reset needed.
        await db.execute(text("SET LOCAL session_replication_role = replica"))
        if mode == "replace":
            await db.execute(text(f"TRUNCATE TABLE {ident} CASCADE"))
        await db.execute(stmt, param_rows)
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        _log.error(
            "backup.import_table failed", service_name="backend", actor=str(admin.id),
            table=table, error=_scrub(exc), outcome="error",
        )
        return problem(
            422, "urn:backup:error:import-failed",
            f"import failed for {table} ({_scrub(exc)})", instance,
        )

    _log.info(
        "backup.import_table", service_name="backend", actor=str(admin.id),
        table=table, rows=len(param_rows), mode=mode, outcome="ok",
    )
    return {"imported": len(param_rows), "table": table, "mode": mode}


# ── Full backup ────────────────────────────────────────────────────────────

@router.post("/create")
async def create_backup(admin: UserAdmin, db: DB) -> dict:
    """Export every application table to a gzip-compressed JSON file (v2.0)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})
    # Bound the read-heavy scan; SET LOCAL auto-reverts on COMMIT/ROLLBACK.
    await db.execute(text("SET LOCAL statement_timeout = '30s'"))

    all_tables = await _discover_tables(db)
    covered = [t for t in all_tables if t not in SCHEMA_VERSION_TABLES]
    live = set(all_tables)

    data: dict[str, list[dict]] = {}
    row_counts: dict[str, int] = {}
    checksums: dict[str, str] = {}
    for table in covered:
        ident = _safe_ident(table, live)
        result = await db.stream(text(f"SELECT * FROM {ident}"))
        raw_rows = [dict(m) async for m in result.mappings()]
        # Normalise every value to plain JSON types up front (Decimal->float,
        # datetime/date->iso string, UUID->str, ...). The checksum is then
        # computed over the SAME shape that lands in the file, so a restore
        # can recompute it from the file and get an identical digest.
        rows = json.loads(_dump(raw_rows))
        data[table] = rows
        row_counts[table] = len(rows)
        checksums[table] = _table_checksum(rows)

    schema_versions = await _load_schema_versions(db)

    created_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "version": BACKUP_FORMAT_VERSION,
        "created_at": created_at,
        "created_by": str(admin.id),
        "source_db": "investment_db",
        "generator": "backend/backup@2.0",
        "covered_tables": covered,
        "insert_order": covered,
        "excluded_tables": {
            t: "schema-version table; owned by Alembic migrations, never restored"
            for t in sorted(SCHEMA_VERSION_TABLES)
        },
        "row_counts": row_counts,
        "checksums": checksums,
        "schema_versions": schema_versions,
        "tables": data,
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{ts}.json.gz"
    filepath = BACKUP_DIR / filename
    with gzip.open(filepath, "wb") as fh:
        fh.write(_dump(payload))

    # Restrict the on-disk backup to the owner (0o600). A backup file is a full
    # dump of every application table — it must not be world/group readable.
    try:
        os.chmod(filepath, stat.S_IRUSR | stat.S_IWUSR)
    except OSError as exc:  # pragma: no cover - filesystem cannot represent POSIX perms
        _log.warning(
            "backup.create chmod skipped", service_name="backend", actor=str(admin.id),
            filename=filename, error=type(exc).__name__, outcome="degraded",
        )

    # Retention — keep only the newest BACKUP_RETENTION files.
    for old in sorted(BACKUP_DIR.glob("backup_*.json.gz"), reverse=True)[BACKUP_RETENTION:]:
        old.unlink(missing_ok=True)

    size_kb = round(filepath.stat().st_size / 1024, 1)
    total_rows = sum(row_counts.values())
    _log.info(
        "backup.create", service_name="backend", actor=str(admin.id),
        filename=filename, tables=len(covered), total_rows=total_rows, outcome="ok",
    )
    return {
        "filename": filename,
        "created_at": created_at,
        "size_kb": size_kb,
        "total_rows": total_rows,
        "version": BACKUP_FORMAT_VERSION,
        "covered_tables": covered,
        "row_counts": row_counts,
        "checksums": checksums,
    }


@router.get("/tables", response_model=BackupTablesResponse)
async def list_catalog_tables(admin: UserAdmin, db: DB) -> dict:
    """Live table catalogue with per-table restore metadata."""
    # Bound the per-table count(*) sweep; SET LOCAL auto-reverts on COMMIT.
    await db.execute(text("SET LOCAL statement_timeout = '30s'"))
    all_tables = await _discover_tables(db)
    live = set(all_tables)
    items: list[dict] = []
    for t in all_tables:
        if t in SCHEMA_VERSION_TABLES:
            reg = (
                await db.execute(text("SELECT to_regclass(:q)"), {"q": f"public.{t}"})
            ).scalar()
            cnt = 0
            if reg is not None:
                cnt = (
                    await db.execute(
                        text(f"SELECT count(*) FROM {_safe_ident(t, SCHEMA_VERSION_TABLES)}")
                    )
                ).scalar_one()
            items.append(
                {
                    "name": t,
                    "row_count": int(cnt),
                    "owner_service": _owner_service(t),
                    "restorable": False,
                    "in_conflict_check": False,
                    "note": "schema-version table; managed by Alembic migrations, never restored",
                }
            )
        else:
            cnt = (
                await db.execute(text(f"SELECT count(*) FROM {_safe_ident(t, live)}"))
            ).scalar_one()
            items.append(
                {
                    "name": t,
                    "row_count": int(cnt),
                    "owner_service": _owner_service(t),
                    "restorable": True,
                    "in_conflict_check": True,
                }
            )
    return {
        "database": await _current_database(db),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_tables": len(all_tables),
        "insert_order": all_tables,
        "tables": items,
    }


@router.get("/list")
async def list_backups(admin: UserAdmin) -> list[dict]:
    """Metadata for all stored backup files, newest first."""
    files = sorted(BACKUP_DIR.glob("backup_*.json.gz"), reverse=True)
    result: list[dict] = []
    for f in files:
        stat = f.stat()
        meta: dict[str, Any] = {
            "filename": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        }
        try:
            with gzip.open(f, "rb") as fh:
                parsed = json.loads(fh.read().decode("utf-8"))
            meta["version"] = parsed.get("version", "unknown")
            covered = parsed.get("covered_tables")
            if isinstance(covered, list):
                meta["covered_table_count"] = len(covered)
            elif isinstance(parsed.get("tables"), dict):
                meta["covered_table_count"] = len(parsed["tables"])
            else:
                meta["covered_table_count"] = None
        except Exception:  # noqa: BLE001 - a corrupt file must not break the listing
            meta["version"] = "unknown"
            meta["covered_table_count"] = None
        result.append(meta)
    return result


@router.get("/download/{filename}")
async def download_backup(filename: str, admin: UserAdmin) -> Any:
    """Stream a backup file to the client."""
    instance = f"/api/v1/backup/download/{filename}"
    resolved = _resolve_backup_path(filename, instance)
    if isinstance(resolved, JSONResponse):
        return resolved
    if not resolved.exists():
        return problem(404, "urn:backup:error:not-found", "backup not found", instance)
    return FileResponse(path=str(resolved), filename=filename, media_type="application/gzip")


@router.delete("/{filename}")
async def delete_backup(filename: str, admin: UserAdmin) -> Any:
    """Delete a stored backup file."""
    instance = f"/api/v1/backup/{filename}"
    resolved = _resolve_backup_path(filename, instance)
    if isinstance(resolved, JSONResponse):
        return resolved
    if not resolved.exists():
        return problem(404, "urn:backup:error:not-found", "backup not found", instance)
    resolved.unlink()
    _log.info(
        "backup.delete", service_name="backend", actor=str(admin.id),
        filename=filename, outcome="ok",
    )
    return {"deleted": filename}


# ── Restore ────────────────────────────────────────────────────────────────
# NOTE: ``/restore/upload`` MUST be registered before ``/restore/{filename}``
# so the literal path is not swallowed by the path-parameter route.

@router.post("/restore/upload")
async def restore_from_upload(
    admin: UserAdmin,
    db: DB,
    file: Annotated[UploadFile, File()],
    mode: str = "skip_if_conflict",   # query param: skip_if_conflict | replace_all
    confirm: str | None = None,       # query param: 'REPLACE ALL DATA' for replace_all
):
    """Restore from an uploaded backup file (bounded gzip decompression).

    ``mode`` / ``confirm`` are query parameters (not multipart fields) so the
    request body stays a single ``multipart/form-data`` file part.
    """
    instance = "/api/v1/backup/restore/upload"
    raw = await file.read()
    is_gz = raw[:2] == b"\x1f\x8b" or bool(file.filename and file.filename.endswith(".gz"))
    try:
        if is_gz:
            raw = _bounded_gunzip(raw, BACKUP_MAX_UNCOMPRESSED_BYTES)
        payload = json.loads(raw.decode("utf-8"))
    except _BackupTooLarge:
        return problem(
            413, "urn:backup:error:too-large",
            f"decompressed backup exceeds the {BACKUP_MAX_UNCOMPRESSED_BYTES}-byte limit",
            instance, limit_bytes=BACKUP_MAX_UNCOMPRESSED_BYTES,
        )
    except Exception as exc:  # noqa: BLE001
        return problem(400, "urn:backup:error:invalid-file", f"invalid backup file: {exc}", instance)

    if not isinstance(payload, dict):
        return problem(400, "urn:backup:error:invalid-file", "backup file is not a JSON object", instance)

    return await _do_restore(
        db, payload, mode=mode, confirm=confirm, instance=instance, actor=str(admin.id),
    )


@router.post("/restore/{filename}")
async def restore_from_stored(
    filename: str,
    admin: UserAdmin,
    db: DB,
    options: RestoreOptions | None = None,
):
    """Restore from a previously stored backup file."""
    instance = f"/api/v1/backup/restore/{filename}"
    resolved = _resolve_backup_path(filename, instance)
    if isinstance(resolved, JSONResponse):
        return resolved
    if not resolved.exists():
        return problem(404, "urn:backup:error:not-found", "backup not found", instance)

    with gzip.open(resolved, "rb") as fh:
        payload = json.loads(fh.read().decode("utf-8"))

    mode = options.mode if options else "skip_if_conflict"
    confirm = options.confirm if options else None
    return await _do_restore(
        db, payload, mode=mode, confirm=confirm,
        instance=f"/api/v1/backup/restore/{filename}", actor=str(admin.id),
    )


def _verify_checksum(rows: list[dict], expected: str | None) -> str:
    if not expected:
        return "skipped"
    return "ok" if _table_checksum(rows) == expected else "mismatch"


async def _column_types(db: AsyncSession, table: str) -> dict[str, str]:
    rows = (
        await db.execute(
            text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        )
    ).fetchall()
    return {r.column_name: r.data_type for r in rows}


def _coerce(value: Any, data_type: str) -> Any:
    """Turn a JSON-decoded value into something asyncpg accepts for ``data_type``.

    The file always carries dates/times as ISO strings, JSON columns as nested
    objects and ``bytea`` columns as base64 strings; asyncpg's binary protocol
    needs ``datetime`` / ``date`` objects, a JSON *string* and ``bytes``
    respectively.
    """
    if value is None:
        return None
    if isinstance(value, str):
        if data_type == "bytea":
            return base64.b64decode(value)
        if data_type in ("timestamp with time zone", "timestamp without time zone"):
            return datetime.fromisoformat(value)
        if data_type == "date":
            return date.fromisoformat(value)
        if data_type == "boolean":
            return value.strip().lower() in ("true", "t", "1", "yes")
        return value  # uuid / numeric / varchar / json-text / enum all fine as str
    if data_type in ("json", "jsonb"):
        return json.dumps(value)
    return value


async def _unknown_columns(db: AsyncSession, table: str, rows: list[dict]) -> list[str]:
    """Columns present in ``rows`` that do not exist on ``table`` in the live
    catalogue. Empty list means every column is real."""
    types = await _column_types(db, table)
    if not types:
        return [f"<table {table} not found>"]
    allowed = set(types)
    seen: set[str] = set()
    for r in rows:
        seen.update(r.keys())
    return sorted(seen - allowed)


async def _bulk_insert(db: AsyncSession, table: str, rows: list[dict], live: set[str]) -> None:
    ident = _safe_ident(table, live)
    types = await _column_types(db, table)
    allowed = set(types)
    cols = list(rows[0].keys())
    # Identifiers validated against the REAL catalogue, not the row's own keys.
    col_list = ", ".join(_safe_ident(c, allowed) for c in cols)
    # Positional bind keys so a column such as ``as of`` cannot corrupt the
    # parameter list.
    param_keys = [f"p{i}" for i in range(len(cols))]
    placeholders = ", ".join(f":{k}" for k in param_keys)
    stmt = text(f"INSERT INTO {ident} ({col_list}) VALUES ({placeholders})")
    for start in range(0, len(rows), _INSERT_CHUNK):
        chunk = rows[start : start + _INSERT_CHUNK]
        normalised = [
            {param_keys[i]: _coerce(r.get(cols[i]), types.get(cols[i], "")) for i in range(len(cols))}
            for r in chunk
        ]
        await db.execute(stmt, normalised)


class _RowFailure(Exception):
    pass


async def _conflicting_tables(db: AsyncSession, order: list[str], live: set[str]) -> list[str]:
    """Tables in ``order`` that already hold at least one row."""
    conflicts: list[str] = []
    for t in order:
        row = (await db.execute(text(f"SELECT 1 FROM {_safe_ident(t, live)} LIMIT 1"))).first()
        if row is not None:
            conflicts.append(t)
    return conflicts


async def _conflict_details(db: AsyncSession, conflicts: list[str], live: set[str]) -> list[dict]:
    """Exact ``count(*)`` for the conflicting tables only."""
    details: list[dict] = []
    for t in conflicts:
        cnt = (await db.execute(text(f"SELECT count(*) FROM {_safe_ident(t, live)}"))).scalar_one()
        details.append({"table": t, "row_count": int(cnt)})
    return details


async def _unknown_column_errors(db: AsyncSession, order: list[str], tables_data: dict) -> list[str]:
    """Per-table ``"<table>: unknown column(s) [...]"`` messages (empty == clean)."""
    out: list[str] = []
    for t in order:
        rows = tables_data.get(t) or []
        if not rows:
            continue
        bad = await _unknown_columns(db, t, rows)
        if bad:
            out.append(f"{t}: unknown column(s) {bad}")
    return out


async def _do_restore(
    db: AsyncSession,
    payload: dict,
    *,
    mode: str,
    confirm: str | None,
    instance: str,
    actor: str = "unknown",
) -> Any:
    """Core restore logic. Returns a dict on success or a problem+json response.

    The whole operation runs inside a single transaction opened by the advisory
    lock below and closed by an explicit ``commit`` / ``rollback`` on every
    path. ``SET LOCAL session_replication_role`` is therefore self-reverting and
    never leaks back into the connection pool.
    """
    # Serialise against any concurrent create/restore. pg_advisory_xact_lock is
    # released when this transaction ends, so it cannot leak. Same key as
    # create_backup. This is also the first statement, so a transaction is
    # active for the SET LOCAL further down.
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})
    # Bound every statement in this restore transaction; SET LOCAL reverts on
    # COMMIT/ROLLBACK so nothing leaks back to the pooled connection.
    await db.execute(text("SET LOCAL statement_timeout = '30s'"))

    if mode not in ("skip_if_conflict", "replace_all"):
        await db.rollback()
        return problem(400, "urn:backup:error:bad-mode", f"unknown restore mode: {mode!r}", instance)

    # ── version gate (before any other work) ─────────────────────────────
    ver = payload.get("version")
    if (
        isinstance(ver, str) and ver
        and ver != BACKUP_FORMAT_VERSION
        and ver not in KNOWN_LEGACY_VERSIONS
    ):
        await db.rollback()
        return problem(
            400, "urn:backup:error:unsupported-version",
            f"unsupported backup version: {ver!r}", instance,
        )

    tables_data = payload.get("tables")
    if not isinstance(tables_data, dict):
        await db.rollback()
        return problem(400, "urn:backup:error:invalid-file", "backup file missing 'tables' object", instance)

    is_legacy = (
        ver in KNOWN_LEGACY_VERSIONS
        or "covered_tables" not in payload
        or "checksums" not in payload
    )

    live_tables = await _discover_tables(db)
    live = set(live_tables)
    edges = await _fk_edges(db)
    ordered_live = _toposort(sorted(live), edges)

    # ── legacy (pre-2.0) path ──────────────────────────────────────────────
    if is_legacy:
        order = [
            t for t in ordered_live
            if t in tables_data and t not in SCHEMA_VERSION_TABLES
        ]
        file_tables_not_in_db = sorted(
            t for t in tables_data if t not in live and t not in SCHEMA_VERSION_TABLES
        )

        # Pre-write conflict check — identical policy to the v2.0 path. A legacy
        # file must NOT be able to TRUNCATE a populated database implicitly.
        conflicts = await _conflicting_tables(db, order, live)
        if conflicts and mode == "skip_if_conflict":
            details = await _conflict_details(db, conflicts, live)
            await db.rollback()
            _log.warning(
                "backup.restore blocked by conflict", service_name="backend", actor=actor,
                conflicting_tables=[d["table"] for d in details], outcome="conflict",
            )
            return problem(
                409, "urn:backup:error:target-not-empty",
                "target database already contains data for one or more covered tables; "
                "retry with mode=replace_all to overwrite",
                instance, mode=mode, conflicting_tables=details, legacy_backup=True,
            )

        if mode == "replace_all" and confirm != CONFIRM_PHRASE_ALL:
            await db.rollback()
            return problem(
                400, "urn:backup:error:confirm-required",
                f"mode=replace_all requires confirm == {CONFIRM_PHRASE_ALL!r}",
                instance, mode=mode, legacy_backup=True,
            )

        col_errors = await _unknown_column_errors(db, order, tables_data)
        if col_errors:
            await db.rollback()
            return problem(
                422, "urn:backup:error:unknown-column",
                "backup file contains columns that do not exist in the target schema",
                instance, errors=col_errors, legacy_backup=True,
            )

        restored: dict[str, int] = {}
        errors: list[str] = []
        try:
            await db.execute(text("SET LOCAL session_replication_role = replica"))
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            _log.error(
                "backup.restore privilege error", service_name="backend",
                actor=actor, error=_scrub(exc), outcome="error",
            )
            return problem(
                500, "urn:backup:error:insufficient-privilege",
                "backup restore requires a superuser-capable DB role", instance,
                legacy_backup=True,
            )
        try:
            if mode == "replace_all":
                for t in reversed(order):
                    await db.execute(text(f"TRUNCATE TABLE {_safe_ident(t, live)} CASCADE"))
            for t in order:
                rows = tables_data.get(t) or []
                if not rows:
                    restored[t] = 0
                    continue
                try:
                    await _bulk_insert(db, t, rows, live)
                    restored[t] = len(rows)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{t}: {_scrub(exc)}")
                    raise _RowFailure() from exc
            await db.commit()
        except _RowFailure:
            await db.rollback()
            return problem(
                422, "urn:backup:error:restore-failed",
                "one or more tables failed to restore; all changes rolled back",
                instance, errors=errors, legacy_backup=True,
            )

        _log.info(
            "backup.restore", service_name="backend", actor=actor, legacy=True,
            tables=len(order), outcome="ok",
        )
        return {
            "version": payload.get("version"),
            "mode": "legacy",
            "legacy_backup": True,
            "restored": restored,
            "total_rows": sum(v for v in restored.values() if v > 0),
            "errors": errors,
            "covered_tables": order,
            "uncovered_tables": sorted(live - set(order) - SCHEMA_VERSION_TABLES),
            "file_tables_not_in_db": file_tables_not_in_db,
            "checksum_verification": {t: "skipped" for t in order},
            "schema_version_drift": {},
            "source_created_at": payload.get("created_at"),
        }

    # ── v2.0 path ─────────────────────────────────────────────────────────
    file_covered = payload.get("covered_tables") or []
    checksums = payload.get("checksums") or {}
    covered = [t for t in file_covered if t in live and t not in SCHEMA_VERSION_TABLES]
    order = [t for t in ordered_live if t in covered]
    file_tables_not_in_db = sorted(
        t for t in file_covered if t not in live and t not in SCHEMA_VERSION_TABLES
    )

    # Conflict check BEFORE any write.
    conflicts = await _conflicting_tables(db, order, live)
    if conflicts and mode == "skip_if_conflict":
        details = await _conflict_details(db, conflicts, live)
        await db.rollback()
        _log.warning(
            "backup.restore blocked by conflict", service_name="backend", actor=actor,
            conflicting_tables=[d["table"] for d in details], outcome="conflict",
        )
        return problem(
            409, "urn:backup:error:target-not-empty",
            "target database already contains data for one or more covered tables; "
            "retry with mode=replace_all to overwrite",
            instance, mode=mode, conflicting_tables=details,
        )

    if mode == "replace_all" and confirm != CONFIRM_PHRASE_ALL:
        await db.rollback()
        return problem(
            400, "urn:backup:error:confirm-required",
            f"mode=replace_all requires confirm == {CONFIRM_PHRASE_ALL!r}",
            instance, mode=mode,
        )

    col_errors = await _unknown_column_errors(db, order, tables_data)
    if col_errors:
        await db.rollback()
        return problem(
            422, "urn:backup:error:unknown-column",
            "backup file contains columns that do not exist in the target schema",
            instance, errors=col_errors,
        )

    schema_versions_file = payload.get("schema_versions") or {}
    live_schema_versions = await _load_schema_versions(db)

    restored = {}
    errors = []
    checksum_verification: dict[str, str] = {}
    try:
        await db.execute(text("SET LOCAL session_replication_role = replica"))
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        _log.error(
            "backup.restore privilege error", service_name="backend", actor=actor,
            error=_scrub(exc), outcome="error",
        )
        return problem(
            500, "urn:backup:error:insufficient-privilege",
            "backup restore requires a superuser-capable DB role", instance,
        )
    try:
        if mode == "replace_all":
            for t in reversed(order):
                await db.execute(text(f"TRUNCATE TABLE {_safe_ident(t, live)} CASCADE"))

        for t in order:
            rows = tables_data.get(t) or []
            checksum_verification[t] = _verify_checksum(rows, checksums.get(t))
            if not rows:
                restored[t] = 0
                continue
            try:
                await _bulk_insert(db, t, rows, live)
                restored[t] = len(rows)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{t}: {_scrub(exc)}")
                raise _RowFailure() from exc

        await db.commit()
    except _RowFailure:
        await db.rollback()
        _log.error(
            "backup.restore failed", service_name="backend", actor=actor,
            errors=errors, outcome="error",
        )
        return problem(
            422, "urn:backup:error:restore-failed",
            "one or more tables failed to restore; all changes rolled back",
            instance, errors=errors,
        )

    drift: dict[str, Any] = {}
    for name in sorted(SCHEMA_VERSION_TABLES):
        file_v = _schema_version_num(schema_versions_file.get(name))
        live_v = _schema_version_num(live_schema_versions.get(name))
        drift[name] = {"file": file_v, "live": live_v, "match": file_v == live_v}

    _log.info(
        "backup.restore", service_name="backend", actor=actor, mode=mode,
        tables=len(order), total_rows=sum(v for v in restored.values() if v > 0),
        checksum_mismatch=[t for t, v in checksum_verification.items() if v == "mismatch"],
        outcome="ok",
    )
    return {
        "version": BACKUP_FORMAT_VERSION,
        "mode": mode,
        "legacy_backup": False,
        "restored": restored,
        "total_rows": sum(v for v in restored.values() if v > 0),
        "errors": errors,
        "covered_tables": order,
        "uncovered_tables": sorted(live - set(order) - SCHEMA_VERSION_TABLES),
        "file_tables_not_in_db": file_tables_not_in_db,
        "checksum_verification": checksum_verification,
        "schema_version_drift": drift,
        "source_created_at": payload.get("created_at"),
    }
