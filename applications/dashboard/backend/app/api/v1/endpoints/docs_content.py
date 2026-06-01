"""Serve markdown documentation from /app/docs/ with hierarchical manifest support."""


import json
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/docs-content", tags=["Docs"])

DOCS_DIR = Path("/app/docs")

UserId = Annotated[str, Depends(get_current_user_id)]

# Default manifest used when manifest.json is absent (backward-compat)
_DEFAULT_MANIFEST = {
    "tree": [
        {
            "id": "project",
            "label": "Project",
            "children": [
                {"id": "requirements", "label": "Requirements", "file": "REQUIREMENTS.md"},
                {"id": "design",       "label": "Technical Design", "file": "DESIGN.md"},
            ],
        }
    ]
}


@router.get("/manifest")
async def get_manifest(_: UserId) -> dict:
    """
    Return the documentation tree manifest.
    Falls back to a default two-doc manifest if manifest.json is missing.
    """
    manifest_path = DOCS_DIR / "manifest.json"
    if manifest_path.exists():
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return _DEFAULT_MANIFEST


@router.get("/file")
async def get_file(_: UserId, path: str = Query(...)) -> dict[str, str]:
    """
    Serve a markdown file relative to DOCS_DIR.
    Path traversal is blocked â€” only files inside DOCS_DIR are allowed.
    """
    # Safety: resolve and check prefix
    target = (DOCS_DIR / path).resolve()
    if not str(target).startswith(str(DOCS_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"Document not found: {path}")
    return {"path": path, "content": target.read_text(encoding="utf-8")}


# Backward-compatible route (used by old frontend code)
@router.get("/{doc_name}")
async def get_doc(doc_name: str, _: UserId) -> dict[str, str]:
    """Legacy route â€” maps well-known keys to files."""
    mapping = {
        "requirements": "REQUIREMENTS.md",
        "design": "DESIGN.md",
    }
    filename = mapping.get(doc_name.lower())
    if not filename:
        raise HTTPException(status_code=404, detail="Document not found")
    path = DOCS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found on server")
    return {"name": doc_name, "filename": filename, "content": path.read_text(encoding="utf-8")}
