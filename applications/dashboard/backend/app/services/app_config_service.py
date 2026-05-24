"""App configuration stored in a JSON file in the uploads directory."""

from __future__ import annotations

import json
from pathlib import Path

CONFIG_FILE = Path("/app/uploads/app_config.json")


def _defaults() -> dict:
    from app.core.config import get_settings
    s = get_settings()
    return {
        "excel_source_path": s.investment_excel_source_path or s.investment_excel_path,
    }


def get_app_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            stored = json.loads(CONFIG_FILE.read_text())
            result = _defaults()
            result.update(stored)
            return result
        except Exception:
            pass
    return _defaults()


def update_app_config(updates: dict) -> dict:
    current = get_app_config()
    current.update(updates)
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(current, indent=2))
    return current
