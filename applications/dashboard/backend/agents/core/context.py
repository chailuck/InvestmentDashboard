"""
SharedContext — thread-safe, async-safe key-value store shared across all agents.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class ContextEntry:
    __slots__ = ("value", "version", "written_by", "written_at")

    def __init__(self, value: Any, written_by: str) -> None:
        self.value = value
        self.version = 1
        self.written_by = written_by
        self.written_at = datetime.utcnow()

    def update(self, value: Any, written_by: str) -> None:
        self.value = value
        self.version += 1
        self.written_by = written_by
        self.written_at = datetime.utcnow()


class SharedContext:
    """
    Shared context store for the multi-agent system.

    Supports:
    - Namespaced keys (e.g. "frontend.theme", "arch.constraints")
    - Optimistic locking via entry versions
    - Async-safe access via asyncio.Lock
    - Snapshot / restore for delegation hand-offs
    - TTL is intentionally not implemented here — use a Redis backend for
      production deployments that need expiry.
    """

    SEPARATOR = "."

    def __init__(self) -> None:
        self._store: dict[str, ContextEntry] = {}
        self._lock = asyncio.Lock()
        self._watchers: dict[str, list[Any]] = {}

    # -----------------------------------------------------------------------
    # Core CRUD
    # -----------------------------------------------------------------------

    async def set(self, key: str, value: Any, agent_id: str = "system") -> None:
        async with self._lock:
            if key in self._store:
                self._store[key].update(copy.deepcopy(value), agent_id)
            else:
                self._store[key] = ContextEntry(copy.deepcopy(value), agent_id)

        await self._notify_watchers(key, value)

    async def get(self, key: str, default: Any = None) -> Any:
        async with self._lock:
            entry = self._store.get(key)
            return copy.deepcopy(entry.value) if entry else default

    async def delete(self, key: str) -> bool:
        async with self._lock:
            if key in self._store:
                del self._store[key]
                return True
            return False

    async def exists(self, key: str) -> bool:
        async with self._lock:
            return key in self._store

    # -----------------------------------------------------------------------
    # Bulk operations
    # -----------------------------------------------------------------------

    async def set_many(self, mapping: dict[str, Any], agent_id: str = "system") -> None:
        for key, value in mapping.items():
            await self.set(key, value, agent_id)

    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        return {k: await self.get(k) for k in keys}

    async def get_namespace(self, namespace: str) -> dict[str, Any]:
        """Return all keys under a namespace prefix (e.g. 'frontend')."""
        prefix = namespace + self.SEPARATOR
        async with self._lock:
            return {
                k: copy.deepcopy(v.value)
                for k, v in self._store.items()
                if k.startswith(prefix) or k == namespace
            }

    # -----------------------------------------------------------------------
    # Watchers
    # -----------------------------------------------------------------------

    def watch(self, key: str, handler: Any) -> None:
        """Register an async or sync callable invoked when `key` changes."""
        self._watchers.setdefault(key, []).append(handler)

    def unwatch(self, key: str, handler: Any) -> None:
        watchers = self._watchers.get(key, [])
        if handler in watchers:
            watchers.remove(handler)

    async def _notify_watchers(self, key: str, new_value: Any) -> None:
        for handler in self._watchers.get(key, []):
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(key, new_value)
                else:
                    handler(key, new_value)
            except Exception:
                logger.exception("Watcher error for key %s", key)

    # -----------------------------------------------------------------------
    # Snapshot / restore
    # -----------------------------------------------------------------------

    async def snapshot(self, namespace: str | None = None) -> dict[str, Any]:
        """Return a plain-dict snapshot, optionally filtered by namespace."""
        async with self._lock:
            result: dict[str, Any] = {}
            for k, entry in self._store.items():
                if namespace and not k.startswith(namespace + self.SEPARATOR):
                    continue
                result[k] = {
                    "value": entry.value,
                    "version": entry.version,
                    "written_by": entry.written_by,
                    "written_at": entry.written_at.isoformat(),
                }
            return result

    async def restore(self, snapshot: dict[str, Any], agent_id: str = "restore") -> None:
        for key, meta in snapshot.items():
            await self.set(key, meta["value"], agent_id)

    # -----------------------------------------------------------------------
    # Convenience sync wrappers (for non-async call sites)
    # -----------------------------------------------------------------------

    def get_sync(self, key: str, default: Any = None) -> Any:
        """Blocking get — only safe outside a running event loop."""
        return asyncio.run(self.get(key, default))

    def set_sync(self, key: str, value: Any, agent_id: str = "system") -> None:
        asyncio.run(self.set(key, value, agent_id))

    def to_json(self) -> str:
        data = {k: {"value": v.value, "version": v.version} for k, v in self._store.items()}
        return json.dumps(data, default=str)

    def __repr__(self) -> str:
        return f"<SharedContext keys={len(self._store)}>"
