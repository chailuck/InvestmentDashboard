"""AI copilot — streaming chat powered by Anthropic + InvestmentAgent01 skills."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Annotated, AsyncIterator

import anthropic
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user_id
from app.core.config import get_settings

router = APIRouter(prefix="/ai", tags=["AI Copilot"])
UserId = Annotated[str, Depends(get_current_user_id)]

AGENT_DIR = Path("/app/investment_agent")

# In-memory session store  {session_id: [messages]}
_SESSIONS: dict[str, list] = {}


# ── System prompt ──────────────────────────────────────────────────────────────

def _system_prompt() -> str:
    parts: list[str] = []

    claude_md = AGENT_DIR / "CLAUDE.md"
    if claude_md.exists():
        parts.append(claude_md.read_text(encoding="utf-8", errors="replace"))
    else:
        parts.append(
            "You are a personal stock investment assistant for Thai SET stocks and DRs. "
            "Help with portfolio tracking, technical analysis, and investment decisions."
        )

    style_doc = AGENT_DIR / "knowledge" / "personal-trading-style.md"
    if style_doc.exists():
        parts.append(
            "\n\n---\n# Personal Trading Style\n"
            + style_doc.read_text(encoding="utf-8", errors="replace")
        )

    parts.append(
        "\n\n---\n# Dashboard AI Instructions\n"
        "You are running inside a web dashboard. Use the tools provided to fetch real data.\n"
        "- /portList → call get_portfolio_positions\n"
        "- /portAction, /portPlan → call get_portfolio_positions + get_performance_summary\n"
        "- /portHist → call get_performance_summary\n"
        "- /analyze TICKER → call get_live_price then read_knowledge_doc for analysis context\n"
        "- For unknown /commands, explain available commands.\n"
        "Respond in English unless the user writes in Thai. Use markdown formatting."
    )
    return "\n\n".join(parts)


# ── Tool definitions ───────────────────────────────────────────────────────────

TOOLS: list[dict] = [
    {
        "name": "get_portfolio_positions",
        "description": (
            "Get portfolio positions with live prices and P&L from the Excel tracking file. "
            "Use for /portList, /portPlan, /portAction."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "closed", "all"],
                    "description": "'active'=open positions, 'closed'=sold, 'all'=both",
                }
            },
            "required": [],
        },
    },
    {
        "name": "get_live_price",
        "description": (
            "Get live market price for a Thai SET stock or DR. "
            "Automatically appends .BK for SET stocks. For DRs (e.g. AAPL01) strips the suffix."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {
                    "type": "string",
                    "description": "Ticker, e.g. PTT, GULF, CPALL, AAPL01, NVDA06",
                }
            },
            "required": ["ticker"],
        },
    },
    {
        "name": "get_performance_summary",
        "description": "Get portfolio P&L performance — cumulative history and breakdown by stock.",
        "input_schema": {
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "enum": ["daily", "weekly", "monthly"],
                    "description": "Grouping period",
                },
                "months": {
                    "type": "integer",
                    "description": "Months to look back (default 3)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "read_knowledge_doc",
        "description": "Read a knowledge document from the trading knowledge base.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": (
                        "Filename, e.g. knowledge_fibo.md, technical-analysis.md, "
                        "personal-trading-style.md, knowledge-trend-analysis.md"
                    ),
                }
            },
            "required": ["filename"],
        },
    },
    {
        "name": "run_analysis_script",
        "description": (
            "Run a portfolio analysis Python script. "
            "Use for /portHist (port_hist) or /portAction (port_action)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "script": {
                    "type": "string",
                    "enum": ["port_hist", "port_action", "portfolio_tracker"],
                    "description": "Script name",
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "CLI args, e.g. ['-mode', 'PL', '-m', '3']",
                },
            },
            "required": ["script"],
        },
    },
]


# ── Tool execution ─────────────────────────────────────────────────────────────

def _execute_tool(name: str, inputs: dict) -> str:
    try:
        if name == "get_portfolio_positions":
            from app.services.portfolio_excel import get_positions
            status = inputs.get("status", "active")
            positions = get_positions(status=status)
            if not positions:
                return f"No {status} positions found."
            lines = [f"## Positions ({status.upper()}) — {len(positions)} total\n"]
            lines.append("| Symbol | Dir | Entry | Current | Size | Net P&L | % |")
            lines.append("|--------|-----|------:|--------:|-----:|--------:|--:|")
            for p in positions:
                sign = "+" if p["netPnl"] >= 0 else ""
                lines.append(
                    f"| **{p['symbol']}** "
                    f"| {'↑L' if 'short' not in p['direction'].lower() else '↓S'} "
                    f"| {p['entryPrice']:.2f} | {p['currentPrice']:.2f} "
                    f"| {p['positionSize']:,} "
                    f"| {sign}{p['netPnl']:,.0f} ฿ "
                    f"| {sign}{p['pnlPct']:.2f}% |"
                )
            total = sum(p["netPnl"] for p in positions)
            sign = "+" if total >= 0 else ""
            lines.append(f"\n**Total P&L: {sign}{total:,.0f} ฿**")
            return "\n".join(lines)

        elif name == "get_live_price":
            from app.services.portfolio_excel import _yahoo_quote_direct
            ticker = inputs.get("ticker", "").strip().upper()
            is_dr = bool(re.match(r"^[A-Z]+\d+$", ticker))
            is_bk = ticker.endswith(".BK")
            yf_ticker = ticker if (is_dr or is_bk) else ticker + ".BK"

            quotes = _yahoo_quote_direct([yf_ticker])
            q = quotes.get(yf_ticker)
            if not q or q.get("regularMarketPrice") is None:
                return (
                    f"Could not fetch price for **{ticker}** ({yf_ticker}). "
                    "Market may be closed or ticker not found on Yahoo Finance."
                )
            price = q["regularMarketPrice"]
            chg = q.get("regularMarketChange") or 0
            chg_pct = q.get("regularMarketChangePercent") or 0
            sign = "+" if chg >= 0 else ""
            arrow = "📈" if chg >= 0 else "📉"
            return (
                f"**{ticker}** {arrow}\n"
                f"- Price: **{price:,.2f} THB**\n"
                f"- Change: {sign}{chg:,.2f} ({sign}{chg_pct:.2f}%)\n"
                f"- Source: Yahoo Finance (SET data may be 15 min delayed)"
            )

        elif name == "get_performance_summary":
            from app.services.portfolio_excel import get_performance_by_stock, get_daily_performance
            months = max(1, inputs.get("months", 3))
            period = inputs.get("period", "monthly")
            from_date = date.today() - timedelta(days=months * 30)

            perf = get_daily_performance(from_date=from_date, period=period)
            by_stock = get_performance_by_stock(from_date=from_date)

            lines = [f"## Performance — Last {months} Month(s)\n"]
            if perf:
                cumulative = perf[-1]["cumulativePnl"]
                sign = "+" if cumulative >= 0 else ""
                lines.append(f"**Cumulative P&L:** {sign}{cumulative:,.0f} ฿\n")

            if by_stock:
                lines.append("### By Stock")
                lines.append("| Symbol | Net P&L | Investment | Current Value | P&L% | Win Rate |")
                lines.append("|--------|--------:|-----------:|--------------:|-----:|---------:|")
                for s in by_stock[:15]:
                    sign = "+" if s["net"] >= 0 else ""
                    lines.append(
                        f"| **{s['symbol']}** "
                        f"| {sign}{s['net']:,.0f} ฿ "
                        f"| {s.get('investment', 0):,.0f} "
                        f"| {s.get('currentValue', 0):,.0f} "
                        f"| {sign}{s.get('pnlPct', 0):.1f}% "
                        f"| {s['winRate']}% |"
                    )
            return "\n".join(lines)

        elif name == "read_knowledge_doc":
            filename = inputs.get("filename", "")
            p = AGENT_DIR / "knowledge" / filename
            if not p.exists():
                available = ", ".join(
                    f.name for f in (AGENT_DIR / "knowledge").glob("*.md") if f.is_file()
                ) if (AGENT_DIR / "knowledge").exists() else "none"
                return f"Document '{filename}' not found. Available: {available}"
            content = p.read_text(encoding="utf-8", errors="replace")
            return content[:6000]

        elif name == "run_analysis_script":
            script = inputs.get("script", "")
            args = [str(a) for a in inputs.get("args", [])]
            script_path = AGENT_DIR / "scripts" / f"{script}.py"
            if not script_path.exists():
                return f"Script '{script}.py' not found in /app/investment_agent/scripts/"
            result = subprocess.run(
                [sys.executable, str(script_path)] + args,
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(AGENT_DIR),
            )
            output = (result.stdout or "")[:4000]
            err = (result.stderr or "")[:500]
            if result.returncode != 0:
                return f"Script error (exit {result.returncode}):\n{err}\n\nOutput:\n{output}"
            return output or "Script completed with no output."

        return f"Unknown tool: {name}"

    except Exception as exc:
        return f"Tool error [{name}]: {exc}"


# ── Streaming generator ────────────────────────────────────────────────────────

async def _stream_response(message: str, session_id: str) -> AsyncIterator[str]:
    settings = get_settings()

    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("sk-ant-..."):
        yield f"data: {json.dumps({'type': 'error', 'content': 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in backend/.env and restart the backend.'})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    if session_id not in _SESSIONS:
        _SESSIONS[session_id] = []
    messages = _SESSIONS[session_id]
    messages.append({"role": "user", "content": message})

    system = _system_prompt()

    for _iteration in range(6):
        try:
            response = await asyncio.to_thread(
                client.messages.create,
                model=settings.ai_default_model,
                max_tokens=4096,
                system=system,
                messages=messages,
                tools=TOOLS,
            )
        except anthropic.APIError as exc:
            yield f"data: {json.dumps({'type': 'error', 'content': str(exc)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Stream text content word-by-word
        full_text = ""
        tool_uses = []
        for block in response.content:
            if block.type == "text":
                full_text += block.text
            elif block.type == "tool_use":
                tool_uses.append(block)

        if full_text:
            words = full_text.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

        # Serialize content blocks for conversation history
        history_content = []
        for block in response.content:
            if block.type == "text":
                history_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                history_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})

        messages.append({"role": "assistant", "content": history_content})

        if response.stop_reason != "tool_use" or not tool_uses:
            break

        # Execute tools and continue
        tool_results = []
        for tool in tool_uses:
            yield f"data: {json.dumps({'type': 'tool_start', 'name': tool.name})}\n\n"
            result_text = await asyncio.to_thread(_execute_tool, tool.name, tool.input)
            tool_results.append({"type": "tool_result", "tool_use_id": tool.id, "content": result_text})
            yield f"data: {json.dumps({'type': 'tool_end', 'name': tool.name})}\n\n"

        messages.append({"role": "user", "content": tool_results})

    # Persist last 20 messages
    _SESSIONS[session_id] = messages[-20:]
    yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"


# ── Endpoints ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


@router.post("/copilot/stream")
async def stream_chat(body: ChatRequest, user_id: UserId) -> StreamingResponse:
    """Streaming AI chat with InvestmentAgent01 skills via Anthropic API."""
    sid = body.session_id or str(uuid.uuid4())
    return StreamingResponse(
        _stream_response(body.message, sid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Session-Id": sid,
        },
    )


@router.delete("/copilot/session/{session_id}")
async def clear_session(session_id: str, user_id: UserId) -> dict[str, str]:
    """Clear conversation history for a session."""
    _SESSIONS.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}
