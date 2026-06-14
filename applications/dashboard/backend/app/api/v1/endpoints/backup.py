"""Database backup and restore endpoints."""

from __future__ import annotations

import gzip
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id, require_admin
from app.database.session import get_db
from app.models.user import User

router = APIRouter(prefix="/backup", tags=["backup"])

BACKUP_DIR = Path("/app/uploads/backups")
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
MAX_BACKUPS = 3

UserId   = Annotated[str, Depends(get_current_user_id)]
AdminUser = Annotated[User, Depends(require_admin)]
DB       = Annotated[AsyncSession, Depends(get_db)]

# Tables in insertion order (respects FK dependencies).
# Restore truncates in reverse order.
TABLE_ORDER = [
    "users",
    "dr_mappings",              # global config — no FK deps, back up early
    "action_plans",
    "purchase_plan_items",
    "portfolio_plan_items",
    "user_scan_configs",
    "user_symbol_lists",
    "weekly_scans",
    "weekly_scan_items",
    "symbol_notes",
    "portfolio_positions_db",
    "weekly_reviews",           # FK → users.id
    "weekly_review_items",      # FK → weekly_reviews.id + portfolio_positions_db.id (SET NULL)
]


# ── Serialisation helpers ────────────────────────────────────────────────────

def _json_default(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Not serializable: {type(obj)}")


def _dump(data: Any) -> bytes:
    return json.dumps(data, default=_json_default, ensure_ascii=False).encode("utf-8")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/export-table/{table}")
async def export_table_psv(table: str, user_id: AdminUser, db: DB):
    """Export a single table as a pipe-separated values file (PSV)."""
    allowed = set(TABLE_ORDER)
    if table not in allowed:
        raise HTTPException(400, f"Table must be one of: {', '.join(sorted(allowed))}")

    from fastapi.responses import StreamingResponse
    import io

    result = await db.execute(text(f"SELECT * FROM {table}"))
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
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import-table/{table}")
async def import_table_psv(
    table: str,
    user_id: AdminUser,
    db: DB,
    file: UploadFile = File(...),
    mode: str = "append",   # append | replace
) -> dict:
    """Import a pipe-separated values file into a table.
    mode=replace truncates the table first; mode=append upserts rows."""
    allowed = set(TABLE_ORDER)
    if table not in allowed:
        raise HTTPException(400, f"Table must be one of: {', '.join(sorted(allowed))}")

    raw = (await file.read()).decode("utf-8")
    lines = [l for l in raw.splitlines() if l.strip()]
    if len(lines) < 2:
        raise HTTPException(400, "File must have a header row and at least one data row")

    cols = lines[0].split("|")

    def _parse(v: str) -> Any:
        v = v.replace("\\|", "|").replace("\\n", "\n")
        if v == "":
            return None
        # Try to detect JSON objects/arrays
        if (v.startswith("{") and v.endswith("}")) or (v.startswith("[") and v.endswith("]")):
            try:
                return json.loads(v)
            except Exception:
                pass
        return v

    rows = []
    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) != len(cols):
            continue
        rows.append(dict(zip(cols, [_parse(p) for p in parts])))

    if not rows:
        return {"imported": 0, "mode": mode}

    await db.execute(text("SET session_replication_role = replica"))
    try:
        if mode == "replace":
            await db.execute(text(f"TRUNCATE TABLE {table} CASCADE"))

        col_list = ", ".join(f'"{c}"' for c in cols)
        placeholders = ", ".join(f":{c}" for c in cols)
        stmt = text(f'INSERT INTO {table} ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING')
        await db.execute(stmt, rows)
        await db.commit()
    finally:
        await db.execute(text("SET session_replication_role = DEFAULT"))

    return {"imported": len(rows), "table": table, "mode": mode}


@router.post("/create")
async def create_backup(admin: AdminUser, db: DB) -> dict:
    """Export every application table to a gzip-compressed JSON file."""
    tables: dict[str, list[dict]] = {}

    for table in TABLE_ORDER:
        try:
            result = await db.execute(text(f"SELECT * FROM {table}"))
            tables[table] = [dict(row._mapping) for row in result.fetchall()]
        except Exception:
            tables[table] = []   # table absent or empty — non-fatal

    payload = {
        "version": "1.1",  # 1.1 adds weekly_reviews + weekly_review_items
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": str(admin.id),
        "tables": tables,
        "row_counts": {t: len(r) for t, r in tables.items()},
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{ts}.json.gz"
    filepath = BACKUP_DIR / filename

    with gzip.open(filepath, "wb") as f:
        f.write(_dump(payload))

    # Enforce retention: keep only the 3 most recent backups
    all_backups = sorted(BACKUP_DIR.glob("backup_*.json.gz"), reverse=True)
    for old in all_backups[MAX_BACKUPS:]:
        old.unlink(missing_ok=True)

    size_kb = round(filepath.stat().st_size / 1024, 1)
    total_rows = sum(len(r) for r in tables.values())

    return {
        "filename": filename,
        "created_at": payload["created_at"],
        "size_kb": size_kb,
        "total_rows": total_rows,
        "row_counts": payload["row_counts"],
    }


@router.get("/list")
async def list_backups(user_id: AdminUser) -> list[dict]:
    """Return metadata for all stored backup files, newest first."""
    files = sorted(BACKUP_DIR.glob("backup_*.json.gz"), reverse=True)
    result = []
    for f in files:
        stat = f.stat()
        result.append({
            "filename": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return result


@router.get("/download/{filename}")
async def download_backup(filename: str, user_id: AdminUser) -> FileResponse:
    """Stream a backup file to the client."""
    if not filename.startswith("backup_") or not filename.endswith(".json.gz"):
        raise HTTPException(400, "Invalid filename")
    filepath = BACKUP_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Backup not found")
    return FileResponse(
        path=str(filepath),
        filename=filename,
        media_type="application/gzip",
    )


@router.delete("/{filename}")
async def delete_backup(filename: str, user_id: AdminUser) -> dict:
    """Delete a stored backup file."""
    if not filename.startswith("backup_") or not filename.endswith(".json.gz"):
        raise HTTPException(400, "Invalid filename")
    filepath = BACKUP_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Backup not found")
    filepath.unlink()
    return {"deleted": filename}


@router.post("/restore/{filename}")
async def restore_from_stored(filename: str, user_id: AdminUser, db: DB) -> dict:
    """Restore the database from a previously stored backup file."""
    if not filename.startswith("backup_") or not filename.endswith(".json.gz"):
        raise HTTPException(400, "Invalid filename")
    filepath = BACKUP_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Backup not found")

    with gzip.open(filepath, "rb") as f:
        payload = json.loads(f.read().decode("utf-8"))

    return await _do_restore(db, payload)


@router.post("/restore/upload")
async def restore_from_upload(
    user_id: AdminUser,
    db: DB,
    file: UploadFile = File(...),
) -> dict:
    """Restore the database from an uploaded backup file."""
    raw = await file.read()
    try:
        if file.filename and file.filename.endswith(".gz"):
            raw = gzip.decompress(raw)
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(400, f"Invalid backup file: {exc}")

    return await _do_restore(db, payload)


async def _do_restore(db: AsyncSession, payload: dict) -> dict:
    """Core restore logic: truncate all tables then re-insert from backup."""
    if "tables" not in payload:
        raise HTTPException(400, "Invalid backup format — missing 'tables' key")

    tables_data: dict[str, list[dict]] = payload["tables"]
    restored: dict[str, int] = {}
    errors: list[str] = []

    # Disable FK checks temporarily using DEFERRABLE approach
    await db.execute(text("SET session_replication_role = replica"))

    try:
        # Truncate in reverse FK order
        for table in reversed(TABLE_ORDER):
            try:
                await db.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
            except Exception:
                pass  # table may not exist yet

        # Re-insert in FK order
        for table in TABLE_ORDER:
            rows = tables_data.get(table, [])
            if not rows:
                restored[table] = 0
                continue
            try:
                cols = list(rows[0].keys())
                col_list = ", ".join(f'"{c}"' for c in cols)
                placeholders = ", ".join(f":{c}" for c in cols)
                stmt = text(f'INSERT INTO {table} ({col_list}) VALUES ({placeholders})')
                await db.execute(stmt, rows)
                restored[table] = len(rows)
            except Exception as exc:
                errors.append(f"{table}: {exc}")
                restored[table] = -1

        await db.commit()
    finally:
        await db.execute(text("SET session_replication_role = DEFAULT"))

    return {
        "restored": restored,
        "total_rows": sum(v for v in restored.values() if v > 0),
        "errors": errors,
        "source_created_at": payload.get("created_at"),
    }
