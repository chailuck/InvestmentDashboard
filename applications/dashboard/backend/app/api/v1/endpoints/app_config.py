"""App configuration endpoint — admin-only settings (excel paths, etc.)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/app-config", tags=["App Config"])


class AppConfigUpdate(BaseModel):
    excel_source_path: str | None = None
    excel_working_path: str | None = None


@router.get("")
async def get_config(_: User = Depends(get_current_user)) -> dict:
    from app.services.app_config_service import get_app_config
    from app.core.config import get_settings
    cfg = get_app_config()
    s = get_settings()
    # Enrich with defaults so the UI always has values to display
    cfg.setdefault("excel_source_path", s.investment_excel_source_path or s.investment_excel_path)
    cfg.setdefault("excel_working_path", s.investment_excel_path)
    return cfg


@router.put("")
async def update_config(body: AppConfigUpdate, _: User = Depends(get_current_user)) -> dict:
    from app.services.app_config_service import update_app_config
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    return update_app_config(updates)


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
