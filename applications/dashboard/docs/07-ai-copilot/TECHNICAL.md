# AI Copilot — Technical Design

---

## 1. Files

```
backend/app/api/v1/endpoints/ai.py     ← SSE streaming endpoint + tool execution
frontend/src/app/(dashboard)/ai-copilot/page.tsx  ← Chat UI
```

---

## 2. Backend — Streaming Endpoint

**File:** `backend/app/api/v1/endpoints/ai.py`

### 2.1 Endpoint

```python
@router.post("/copilot/stream")
async def stream_chat(body: ChatRequest, user_id: UserId) -> StreamingResponse:
    sid = body.session_id or str(uuid.uuid4())
    return StreamingResponse(
        _stream_response(body.message, sid),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

### 2.2 SSE Event Format

Each event is a JSON-encoded string:

```
data: {"type": "text",       "content": "Hello "}
data: {"type": "tool_start", "name": "get_portfolio_positions"}
data: {"type": "tool_end",   "name": "get_portfolio_positions"}
data: {"type": "error",      "content": "Error message"}
data: {"type": "done",       "session_id": "uuid"}
```

### 2.3 Streaming Generator

```python
async def _stream_response(message: str, session_id: str) -> AsyncIterator[str]:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    messages = _SESSIONS.setdefault(session_id, [])
    messages.append({"role": "user", "content": message})

    for _iteration in range(6):    # max 6 tool-use iterations
        response = await asyncio.to_thread(
            client.messages.create,
            model=settings.ai_default_model,
            max_tokens=4096,
            system=_system_prompt(),
            messages=messages,
            tools=TOOLS,
        )

        # Stream text word-by-word
        for block in response.content:
            if block.type == "text":
                for word in block.text.split(" "):
                    yield f"data: {json.dumps({'type': 'text', 'content': word + ' '})}\n\n"

        if response.stop_reason != "tool_use": break

        # Execute tools and continue
        for tool in tool_uses:
            yield f"data: {json.dumps({'type': 'tool_start', 'name': tool.name})}\n\n"
            result = await asyncio.to_thread(_execute_tool, tool.name, tool.input)
            yield f"data: {json.dumps({'type': 'tool_end', 'name': tool.name})}\n\n"
            messages.append({"role": "user", "content": [tool_result]})

    _SESSIONS[session_id] = messages[-20:]    # keep last 20 messages
    yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"
```

**Note:** `asyncio.to_thread()` is used for the Anthropic SDK call (synchronous) to avoid blocking the async event loop.

---

## 3. Tool Definitions

Tools are passed as a list of Anthropic tool schemas:

```python
TOOLS = [
    {
        "name": "get_portfolio_positions",
        "description": "Get portfolio positions with live prices and P&L",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": { "type": "string", "enum": ["active", "closed", "all"] }
            }
        }
    },
    {
        "name": "get_live_price",
        "input_schema": { "type": "object", "properties": { "ticker": { "type": "string" } }, "required": ["ticker"] }
    },
    { "name": "get_performance_summary", ... },
    { "name": "read_knowledge_doc", ... },
    { "name": "run_analysis_script", ... },
]
```

---

## 4. System Prompt

Built dynamically from files in `/app/investment_agent/`:

```python
def _system_prompt() -> str:
    parts = []
    # 1. CLAUDE.md — main agent persona (if exists)
    # 2. knowledge/personal-trading-style.md — trading rules
    # 3. Dashboard instructions — tool usage guide
    return "\n\n".join(parts)
```

If `CLAUDE.md` is not found, a default persona is used.

---

## 5. Frontend — Streaming Consumer

**File:** `frontend/src/app/(dashboard)/ai-copilot/page.tsx`

```typescript
const BASE_URL = '/api/proxy'

const response = await fetch(`${BASE_URL}/api/v1/ai/copilot/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ message, session_id: sessionId }),
})

const reader = response.body!.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value)
  // Parse SSE lines: "data: {...}"
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const event = JSON.parse(line.slice(6))
    if (event.type === 'text') setCurrentMsg(prev => prev + event.content)
    if (event.type === 'tool_start') setActiveTool(event.name)
    if (event.type === 'tool_end') setActiveTool(null)
    if (event.type === 'done') { setSessionId(event.session_id); finalizeMessage() }
  }
}
```

**Why `fetch` directly (not `apiClient`):** Axios doesn't support streaming response bodies. `fetch` with a `ReadableStream` reader is used for SSE.

The proxy buffers only the **request** body; the **response** body is streamed through (`new NextResponse(upstream.body, ...)`).

---

## 6. Session Storage

Sessions are stored in a module-level dict in `ai.py`:

```python
_SESSIONS: dict[str, list] = {}
```

**Limitations:**
- Not shared across Uvicorn workers (sticky per connection due to SSE)
- Lost on backend restart
- Max 20 messages retained per session

---

## 7. Model Configuration

| Setting | Env var | Default |
|---------|---------|---------|
| Model ID | `AI_DEFAULT_MODEL` | `claude-sonnet-4-6` |
| Max tokens | hardcoded | 4096 |
| Tool iterations | hardcoded | 6 |

To change the model: update `AI_DEFAULT_MODEL` in `backend/.env` and restart the backend container.
