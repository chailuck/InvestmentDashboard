"""App configuration endpoint — admin-only settings (excel paths, etc.)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import require_admin
from app.models.user import User

router = APIRouter(prefix="/app-config", tags=["App Config"])


class AppConfigUpdate(BaseModel):
    excel_source_path: str | None = None


@router.get("")
async def get_config(_: User = Depends(require_admin)) -> dict:
    from app.services.app_config_service import get_app_config
    return get_app_config()


@router.put("")
async def update_config(body: AppConfigUpdate, _: User = Depends(require_admin)) -> dict:
    from app.services.app_config_service import update_app_config
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    return update_app_config(updates)
