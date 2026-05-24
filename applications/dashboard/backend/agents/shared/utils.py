"""
Shared utility functions used across multiple agent modules.
"""

from __future__ import annotations

import hashlib
import json
import re
import textwrap
from datetime import datetime
from typing import Any


def slugify(text: str) -> str:
    """Convert a human-readable name to a slug suitable for IDs / filenames."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")


def truncate(text: str, max_chars: int = 200, suffix: str = "...") -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - len(suffix)] + suffix


def dedent_code(code: str) -> str:
    return textwrap.dedent(code).strip()


def extract_code_blocks(text: str) -> list[dict[str, str]]:
    """
    Extract all fenced code blocks from markdown text.

    Returns a list of dicts: [{language, code}, ...]
    """
    pattern = r"```(\w+)?\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)
    return [{"language": lang or "text", "code": code.strip()} for lang, code in matches]


def content_hash(content: str) -> str:
    """Return a short SHA-256 hash of content (first 12 hex chars)."""
    return hashlib.sha256(content.encode()).hexdigest()[:12]


def build_task_payload(
    description: str,
    requirements: list[str] | None = None,
    constraints: list[str] | None = None,
    examples: list[str] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Construct a standardised task payload dict."""
    payload: dict[str, Any] = {
        "description": description,
        "requirements": requirements or [],
        "constraints": constraints or [],
        "examples": examples or [],
    }
    payload.update(kwargs)
    return payload


def format_duration(ms: float) -> str:
    """Human-readable duration from milliseconds."""
    if ms < 1000:
        return f"{ms:.1f}ms"
    if ms < 60_000:
        return f"{ms / 1000:.2f}s"
    return f"{ms / 60_000:.1f}min"


def safe_json_loads(text: str, default: Any = None) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return default


def agent_response_to_dict(response: Any) -> dict[str, Any]:
    """Serialise an AgentResponse to a JSON-safe dict."""
    return {
        "response_id": response.response_id,
        "task_id": response.task_id,
        "agent_id": response.agent_id,
        "agent_type": response.agent_type.value,
        "status": response.status.value,
        "content": response.content,
        "execution_time_ms": response.execution_time_ms,
        "artifacts": [
            {
                "type": a.artifact_type,
                "name": a.name,
                "metadata": a.metadata,
            }
            for a in response.artifacts
        ],
        "created_at": response.created_at.isoformat(),
    }


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"
