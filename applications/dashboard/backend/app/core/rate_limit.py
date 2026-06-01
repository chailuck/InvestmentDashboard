"""Rate limiting configuration — SlowAPI limiter singleton.

Usage in endpoints:
    from fastapi import Request
    from app.core.rate_limit import limiter

    @router.post("/login")
    @limiter.limit("5/minute")
    async def login(request: Request, body: LoginRequest, ...):
        ...

The limiter singleton is attached to app.state.limiter in main.py
and the SlowAPIMiddleware is registered there as well.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# key_func=get_remote_address uses the client IP as the rate-limit key.
# For deployments behind a trusted reverse proxy, configure the proxy to
# set X-Forwarded-For and use get_remote_address (slowapi reads X-Forwarded-For
# when trust_proxy=True or when the ASGI scope remote_addr is the proxy IP).
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200/minute"],
)
