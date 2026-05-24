"""WebSocket connection manager using python-socketio."""

from __future__ import annotations

import socketio
from app.core.logging import get_logger

logger = get_logger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> bool:
    token = (auth or {}).get("token", "")
    # TODO: validate JWT token
    logger.info("WS client connected", sid=sid)
    return True


@sio.event
async def disconnect(sid: str) -> None:
    logger.info("WS client disconnected", sid=sid)


@sio.event
async def subscribe(sid: str, data: dict) -> None:
    channel = data.get("channel", "")
    await sio.enter_room(sid, channel)
    logger.debug("Client subscribed", sid=sid, channel=channel)


@sio.event
async def unsubscribe(sid: str, data: dict) -> None:
    channel = data.get("channel", "")
    await sio.leave_room(sid, channel)


async def broadcast(event: str, payload: dict, room: str | None = None) -> None:
    """Emit an event to a room or globally."""
    await sio.emit(event, payload, room=room)


async def broadcast_quote_update(symbol: str, payload: dict) -> None:
    await broadcast("quote_update", {"symbol": symbol, **payload})


async def broadcast_portfolio_update(portfolio_id: str, payload: dict) -> None:
    await broadcast("portfolio_update", payload, room=f"portfolio:{portfolio_id}")


async def emit_ai_token(session_id: str, token: str, user_sid: str) -> None:
    await sio.emit("ai_stream_token", {"session_id": session_id, "token": token}, to=user_sid)


async def emit_ai_end(session_id: str, user_sid: str) -> None:
    await sio.emit("ai_stream_end", {"session_id": session_id}, to=user_sid)
