"""Test runner endpoint — streams pytest output via SSE."""

import asyncio
import json
from typing import Annotated, AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_user_id

router = APIRouter(prefix="/testing", tags=["testing"])

UserId = Annotated[str, Depends(get_current_user_id)]


async def _stream_pytest() -> AsyncGenerator[str, None]:
    proc = await asyncio.create_subprocess_exec(
        "python", "-m", "pytest",
        "--tb=short", "-v", "--no-header", "--no-cov",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd="/app",
    )

    assert proc.stdout is not None
    async for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").rstrip()
        yield f"data: {json.dumps({'line': line})}\n\n"

    await proc.wait()
    yield f"data: {json.dumps({'done': True, 'exit_code': proc.returncode})}\n\n"


@router.post("/run/backend")
async def run_backend_tests(user_id: UserId) -> StreamingResponse:
    """Run the full pytest suite and stream each output line via SSE."""
    return StreamingResponse(
        _stream_pytest(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/info")
async def get_test_info(user_id: UserId) -> dict:
    """Return test file inventory so the UI can show what will run."""
    import os
    test_dir = "/app/tests"
    files = []
    if os.path.isdir(test_dir):
        for f in sorted(os.listdir(test_dir)):
            if f.startswith("test_") and f.endswith(".py"):
                files.append(f)
    return {"test_files": files, "test_dir": test_dir}
