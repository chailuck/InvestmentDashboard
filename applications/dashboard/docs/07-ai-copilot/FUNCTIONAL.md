# AI Copilot — Functional Specification

---

## 1. Overview

The AI Copilot (`/ai-copilot`) is a streaming chat interface powered by Anthropic Claude. It has direct access to portfolio data, live prices, and a personal trading knowledge base. Responses stream token-by-token for a real-time feel.

---

## 2. Interface

- **Chat history** — scrollable list of user and assistant messages, markdown-rendered
- **Input box** — multi-line with Enter to send (Shift+Enter for new line)
- **Session controls** — New Session button clears conversation history
- **Tool indicators** — when the AI calls a tool, a chip shows which tool is running (`📊 get_portfolio_positions…`)

---

## 3. Available Commands

The AI understands these slash-commands:

| Command | Description |
|---------|-------------|
| `/portList` | List all open positions with live P&L |
| `/portAction` | Generate a portfolio action plan |
| `/portPlan` | Suggest portfolio adjustments |
| `/portHist` | Show performance history |
| `/analyze TICKER` | Technical + fundamental analysis of a stock |

Any text (not just slash commands) is accepted — the AI handles natural language questions about investments, Thai SET stocks, and trading strategy.

---

## 4. AI Tools

The AI can autonomously call these tools during a conversation:

| Tool | Trigger | What it does |
|------|---------|-------------|
| `get_portfolio_positions` | `/portList`, `/portAction` | Reads the Excel file, fetches live prices |
| `get_live_price` | `/analyze`, price questions | Queries Yahoo Finance for a stock price |
| `get_performance_summary` | `/portHist` | Reads performance data (by stock, by period) |
| `read_knowledge_doc` | `/analyze`, strategy questions | Reads markdown files from the knowledge base |
| `run_analysis_script` | `/portHist`, `/portAction` | Runs a Python script from the investment agent |

---

## 5. Knowledge Base

The AI reads files from `/app/investment_agent/knowledge/`:
- `personal-trading-style.md` — user's personal trading rules
- `knowledge_fibo.md` — Fibonacci analysis knowledge
- `technical-analysis.md` — technical analysis principles
- Other `.md` files as they are added

The system prompt is built dynamically by reading these files.

---

## 6. Session Management

- Each browser tab gets a `session_id` (UUID) generated on first message.
- The session stores the last 20 messages server-side (in-memory per worker).
- Clicking **New Session** calls `DELETE /api/v1/ai/copilot/session/{id}` to clear history and creates a new `session_id`.
- Sessions are **not persisted** across backend restarts.

---

## 7. Language

The AI responds in English unless the user writes in Thai, in which case it responds in Thai.

---

## 8. Error Handling

| Error | Display |
|-------|---------|
| API key not configured | "Anthropic API key not configured. Set ANTHROPIC_API_KEY in backend/.env and restart." |
| Network error | "Connection lost. Please check your network." |
| Tool failure | AI explains the failure inline (e.g. "Could not fetch price for XYZ") |
