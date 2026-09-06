"""Pure, dependency-light helpers for database backup / restore.

None of these functions hold database or HTTP-session state, so they can be
unit-tested in isolation. All DB-touching orchestration lives in
``app/api/v1/endpoints/backup.py``.

Checksums
---------
There is exactly ONE serializer for both the backup *payload* (the ``tables``
block written to disk) and the per-table SHA-256 checksum:
:func:`json_default_payload`. It normalises ``Decimal`` -> ``float``,
datetime/date -> ISO string, UUID -> str and ``bytes`` -> base64.

Because the checksum is computed over the SAME normalised shape that lands in
the file, a restore can recompute the digest from the file and get a
byte-identical result. This makes the checksum a detector of **post-backup
modification of the file**, NOT a guarantee of source fidelity: the
``Decimal`` -> ``float`` step can round a high-precision numeric, and that
rounding is invisible to the checksum (both the file value and the recomputed
digest see the already-rounded float).
"""

from __future__ import annotations

import base64
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException

from app.core.logging import get_logger

_log = get_logger("backup.pure")

__all__ = [
    "toposort",
    "table_checksum",
    "safe_ident",
    "json_default_payload",
]


def toposort(tables: list[str], edges: list[tuple[str, str]]) -> list[str]:
    """Kahn topological sort producing an FK-safe INSERT order.

    ``edges`` are ``(child, parent)`` pairs, read as *parent must be inserted
    before child*. Behaviour:

    * Self-referential edges (``child == parent``) are dropped.
    * Edges referencing an unknown node are ignored.
    * Duplicate edges are collapsed.
    * The ready set is always drained in alphabetical order, so the output is
      deterministic regardless of input ordering.
    * On a cycle, the unresolved nodes are appended sorted by name and a
      warning is logged.

    TRUNCATE order is simply ``reversed(result)``.
    """
    nodes: list[str] = list(dict.fromkeys(tables))
    nodeset = set(nodes)

    children: dict[str, set[str]] = defaultdict(set)
    indegree: dict[str, int] = {n: 0 for n in nodes}

    for child, parent in edges:
        if child == parent:
            continue
        if child not in nodeset or parent not in nodeset:
            continue
        if child in children[parent]:
            continue
        children[parent].add(child)
        indegree[child] += 1

    ready: list[str] = sorted(n for n in nodes if indegree[n] == 0)
    result: list[str] = []

    while ready:
        node = ready.pop(0)
        result.append(node)
        for child in sorted(children.get(node, ())):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)
        ready.sort()

    if len(result) != len(nodes):
        done = set(result)
        remaining = sorted(n for n in nodes if n not in done)
        _log.warning(
            "toposort detected a cycle; appending unresolved nodes by name",
            service_name="backend",
            remaining=remaining,
        )
        result.extend(remaining)

    return result


def json_default_payload(obj: Any) -> Any:
    """Single serializer for the backup payload AND the checksum.

    * ``UUID``                         -> ``str``
    * ``datetime`` / ``date``         -> ISO-8601 string
    * ``Decimal``                     -> ``float`` (historical on-disk shape;
      see the module docstring on the fidelity caveat this implies)
    * ``bytes`` / ``bytearray`` /
      ``memoryview``                  -> base64 ASCII string

    Anything else raises ``TypeError`` so an unexpected column type fails loudly
    rather than being silently dropped.
    """
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(obj)).decode("ascii")
    raise TypeError(f"Not serialisable: {type(obj)!r}")


def table_checksum(rows: list[dict]) -> str:
    """Order-independent SHA-256 over a table's rows.

    ``"sha256:" + sha256("\\n".join(sorted(json.dumps(row, sort_keys=True))))``.
    Sorting the per-row JSON strings makes the digest independent of the row
    order returned by the database. Non-JSON values are normalised through
    :func:`json_default_payload`, i.e. the exact same normalisation used to
    write the file — so a restore recomputes an identical digest and any
    post-backup edit to the file is detected.
    """
    encoded = sorted(
        json.dumps(row, sort_keys=True, default=json_default_payload) for row in rows
    )
    digest = hashlib.sha256("\n".join(encoded).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def safe_ident(name: str, allowed: Iterable[str]) -> str:
    """Return a quoted SQL identifier, or raise ``HTTPException(400)``.

    ``name`` MUST be a member of ``allowed`` (typically the live table
    catalogue or the target table's real column set from
    ``information_schema``). The return value is double-quoted with embedded
    quotes doubled, so it is safe to interpolate into a statement string. Use
    this for EVERY dynamically-built identifier.
    """
    allowed_set = allowed if isinstance(allowed, (set, frozenset)) else set(allowed)
    if name not in allowed_set:
        raise HTTPException(status_code=400, detail=f"Unknown or disallowed identifier: {name!r}")
    return '"' + name.replace('"', '""') + '"'
