"""API v1 router — assembles all endpoint routers."""

from fastapi import APIRouter

from .endpoints.action_plan import router as action_plan_router
from .endpoints.analytics import router as analytics_router
from .endpoints.portfolio_db import router as portfolio_db_router
from .endpoints.ai import router as ai_router
from .endpoints.app_config import router as app_config_router
from .endpoints.auth import router as auth_router
from .endpoints.docs_content import router as docs_router
from .endpoints.health import router as health_router
from .endpoints.portfolio_tracker import router as portfolio_tracker_router
from .endpoints.portfolios import router as portfolios_router
from .endpoints.users import router as users_router

v1_router = APIRouter(prefix="/api/v1")

v1_router.include_router(health_router)
v1_router.include_router(auth_router)
v1_router.include_router(users_router)
v1_router.include_router(portfolios_router)
v1_router.include_router(portfolio_tracker_router)
v1_router.include_router(app_config_router)
v1_router.include_router(docs_router)
v1_router.include_router(ai_router)
v1_router.include_router(action_plan_router)
v1_router.include_router(analytics_router)
v1_router.include_router(portfolio_db_router)
