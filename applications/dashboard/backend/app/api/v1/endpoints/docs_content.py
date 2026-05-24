"""Serve markdown documentation files from /app/docs/."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/docs-content", tags=["Docs"])

DOCS_DIR = Path("/app/docs")

ALLOWED = {
    "requirements": "REQUIREMENTS.md",
    "design": "DESIGN.md",
}

UserId = Annotated[str, Depends(get_current_user_id)]


@router.get("/{doc_name}")
async def get_doc(doc_name: str, _: UserId) -> dict[str, str]:
    filename = ALLOWED.get(doc_name.lower())
    if not filename:
        raise HTTPException(status_code=404, detail="Document not found")
    path = DOCS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found on server")
    return {"name": doc_name, "filename": filename, "content": path.read_text(encoding="utf-8")}
