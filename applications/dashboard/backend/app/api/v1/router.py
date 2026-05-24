"""API v1 router — assembles all endpoint routers."""

from fastapi import APIRouter

from .endpoints.ai import router as ai_router
from .endpoints.auth import router as auth_router
from .endpoints.health import router as health_router
from .endpoints.portfolios import router as portfolios_router
from .endpoints.users import router as users_router

v1_router = APIRouter(prefix="/api/v1")

v1_router.include_router(health_router)
v1_router.include_router(auth_router)
v1_router.include_router(users_router)
v1_router.include_router(portfolios_router)
v1_router.include_router(ai_router)
