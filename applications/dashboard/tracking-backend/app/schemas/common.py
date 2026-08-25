"""Shared Pydantic v2 base classes.

Response bodies use camelCase keys (`entryDate`, `orderIndex`, ...) to match
the rest of the app's frontend convention — see `_serialize()` in
applications/dashboard/backend/app/api/v1/endpoints/portfolio_db.py, which
sets this precedent (e.g. `entryDate`, `positionSize`).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for outbound (response) schemas: fields serialize as camelCase."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class CamelRequestModel(BaseModel):
    """Base for inbound (request) schemas: accepts camelCase JSON from
    clients but also allows snake_case (populate_by_name) so the API is
    forgiving for internal/test callers."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


# NOTE: CLAUDE.md's generic API standard specifies a `{"error": {code, message,
# request_id}}` envelope for error responses. This service (and the sibling
# `backend` service, which has the same gap) instead returns FastAPI's plain
# `{"detail": "..."}` on every error path, matching this repo's approved API
# design for tracking-backend (which explicitly examples `{"detail": "..."}`
# for 409s) and `backend`'s existing convention (see `portfolio_db.py`'s bare
# `HTTPException(404, "...")` calls). An `ErrorDetail`/`ErrorResponse` pair
# matching the mandated envelope previously lived here unused — removed per
# Gate 3 review rather than left as scaffolding for a policy nobody wires up.
# Adopting the envelope for real would mean a global exception handler in both
# services' main.py AND rewriting every existing test/consumer that currently
# asserts on `detail` — that is a cross-service, org-wide change and should be
# tracked as its own follow-up ticket, not folded into this PR.
