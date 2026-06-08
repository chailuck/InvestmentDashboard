"""App configuration endpoint — shared thresholds (admin) + per-user Excel paths."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, get_current_user_id
from app.database.session import get_db
from app.models.user import User

router = APIRouter(prefix="/app-config", tags=["App Config"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


class AppConfigUpdate(BaseModel):
    excel_source_path: str | None = None
    excel_working_path: str | None = None
    pe_threshold: float | None = None
    price_threshold: float | None = None


@router.get("")
async def get_config(user_id: UserId, db: DB) -> dict:
    from app.services.app_config_service import get_app_config
    from app.core.config import get_settings

    cfg = get_app_config()
    s = get_settings()

    # Defaults from env / global config
    cfg.setdefault("excel_source_path", s.investment_excel_source_path or s.investment_excel_path)
    cfg.setdefault("excel_working_path", s.investment_excel_path)

    # Override with the user's own saved paths when they exist
    uid = uuid.UUID(user_id)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if user:
        if user.excel_source_path:
            cfg["excel_source_path"] = user.excel_source_path
        if user.excel_working_path:
            cfg["excel_working_path"] = user.excel_working_path

    return cfg


@router.put("")
async def update_config(body: AppConfigUpdate, user_id: UserId, db: DB) -> dict:
    from app.services.app_config_service import update_app_config, get_app_config
    from app.core.config import get_settings

    uid = uuid.UUID(user_id)

    # Per-user Excel paths → User record
    excel_fields = {k: v for k, v in {
        "excel_source_path": body.excel_source_path,
        "excel_working_path": body.excel_working_path,
    }.items() if v is not None}

    if excel_fields:
        result = await db.execute(select(User).where(User.id == uid))
        user = result.scalar_one_or_none()
        if user:
            for field, value in excel_fields.items():
                setattr(user, field, value)
            await db.commit()

    # Shared thresholds → global JSON
    threshold_fields = {k: v for k, v in {
        "pe_threshold": body.pe_threshold,
        "price_threshold": body.price_threshold,
    }.items() if v is not None}

    if threshold_fields:
        update_app_config(threshold_fields)

    # Return merged config for this user
    cfg = get_app_config()
    s = get_settings()
    cfg.setdefault("excel_source_path", s.investment_excel_source_path or s.investment_excel_path)
    cfg.setdefault("excel_working_path", s.investment_excel_path)
    if excel_fields:
        cfg.update(excel_fields)

    return cfg


@router.post("/test-path")
async def test_path(body: AppConfigUpdate, _: User = Depends(get_current_user)) -> dict:
    """Check whether the given path exists and is readable inside the container."""
    path_str = (body.excel_source_path or "").strip()
    if not path_str:
        return {"ok": False, "message": "No path provided."}
    p = Path(path_str)
    if not p.exists():
        return {"ok": False, "message": f"File not found: {path_str}"}
    if not p.is_file():
        return {"ok": False, "message": f"Path exists but is not a file: {path_str}"}
    size_kb = round(p.stat().st_size / 1024, 1)
    return {"ok": True, "message": f"File found ({size_kb} KB) — ready to use."}
