"""AI copilot endpoints with streaming via WebSocket."""

from __future__ import annotations

import uuid
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/ai", tags=["AI Copilot"])

UserId = Annotated[str, Depends(get_current_user_id)]


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    portfolio_id: str | None = None


class ChatInitResponse(BaseModel):
    session_id: str
    status: str = "streaming"


@router.post("/copilot/chat", response_model=ChatInitResponse)
async def start_chat(body: ChatRequest, user_id: UserId) -> ChatInitResponse:
    """
    Initiates a streaming AI chat session.
    The actual tokens are pushed via WebSocket (ai_stream_token events).
    """
    session_id = body.session_id or str(uuid.uuid4())
    # TODO: spawn async task that calls LangChain and emits WS events
    return ChatInitResponse(session_id=session_id)


@router.get("/copilot/stream")
async def stream_chat(message: str, user_id: UserId) -> StreamingResponse:
    """SSE streaming endpoint (alternative to WebSocket)."""

    async def event_stream() -> AsyncIterator[str]:
        # TODO: real LangChain astream() integration
        words = f"Analysis for: {message}".split()
        for word in words:
            yield f"data: {word} \n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
