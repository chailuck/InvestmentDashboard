"""API v1 router — assembles all endpoint routers under the tracking prefix.

The overall mount point (`/api/v1/tracking`) is applied once, in main.py,
via `settings.api_prefix` — this router only carries the per-resource
sub-paths (`/sets`, `/categories`, `/sub-categories`, `/items`, `/entries`,
`/update-lists`, `/sets/{set_id}/dashboard`, `/health`).
"""

from fastapi import APIRouter

from app.api.v1.endpoints.categories import router as categories_router
from app.api.v1.endpoints.dashboard import router as dashboard_router
from app.api.v1.endpoints.entries import router as entries_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.sub_categories import router as sub_categories_router
from app.api.v1.endpoints.tracking_items import router as tracking_items_router
from app.api.v1.endpoints.tracking_sets import router as tracking_sets_router
from app.api.v1.endpoints.update_tracking_lists import router as update_tracking_lists_router

v1_router = APIRouter()

v1_router.include_router(health_router)
v1_router.include_router(tracking_sets_router)
v1_router.include_router(categories_router)
v1_router.include_router(sub_categories_router)
v1_router.include_router(tracking_items_router)
v1_router.include_router(entries_router)
v1_router.include_router(update_tracking_lists_router)
v1_router.include_router(dashboard_router)
