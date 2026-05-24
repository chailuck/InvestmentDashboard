# Multi-Agent AI Development System

Enterprise-grade multi-agent architecture for the **AI Investment Dashboard** platform. Built with Python, LangChain, and async-first design.

---

## Agent Hierarchy

```
ChiefArchitectAgent                    ← top-level orchestrator & standards enforcer
├── FrontendLeadAgent                  ← React 18 / TypeScript / Vite architecture
│   ├── UIUXAgent                      ← dark-mode design system, animations
│   └── ResponsiveAgent                ← mobile/tablet/desktop adaptive layouts
├── BackendLeadAgent                   ← FastAPI / Python service architecture
│   ├── APIAgent                       ← REST + WebSocket design & validation
│   └── DatabaseAgent                  ← PostgreSQL schema, migrations, indexes
├── AIAgent                            ← LangChain copilot, streaming, RAG
├── SkillsAgent                        ← portfolio analytics, risk, AI insights
├── DevOpsAgent                        ← Docker, Kubernetes, CI/CD, infrastructure
├── SecurityAgent                      ← JWT, RBAC, hardening, secrets
├── QAAgent                            ← unit, integration, E2E tests
└── PerformanceAgent                   ← frontend, backend, WebSocket optimisation
```

---

## Folder Structure

```
agents/
├── core/                   ← framework foundation
│   ├── base_agent.py       ← abstract BaseAgent (all agents extend this)
│   ├── models.py           ← AgentTask, AgentResponse, enums
│   ├── registry.py         ← AgentRegistry — registers and routes agents
│   ├── router.py           ← AgentRouter — maps task types to agent types
│   ├── task_queue.py       ← priority async queue with dependency tracking
│   ├── context.py          ← SharedContext — async-safe key-value store
│   ├── memory.py           ← AgentMemory — per-agent conversation + KV store
│   └── logging.py          ← structlog configuration
│
├── architect/              ← ChiefArchitectAgent
├── frontend/               ← FrontendLeadAgent
├── backend/                ← BackendLeadAgent
├── uiux/                   ← UIUXAgent
├── responsive/             ← ResponsiveAgent
├── api/                    ← APIAgent
├── database/               ← DatabaseAgent
├── ai/                     ← AIAgent
├── skills/                 ← SkillsAgent
├── devops/                 ← DevOpsAgent
├── security/               ← SecurityAgent
├── qa/                     ← QAAgent
├── performance/            ← PerformanceAgent
│
├── shared/                 ← cross-agent utilities
│   ├── prompts.py          ← system prompt strings for all agents
│   ├── tools.py            ← shared LangChain tools
│   └── utils.py            ← helper functions
│
├── orchestrator.py         ← AgentOrchestrator — top-level entry point
├── requirements.txt
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r applications/dashboard/backend/agents/requirements.txt
```

### 2. Set your API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Use the orchestrator

```python
import asyncio
from agents.orchestrator import create_orchestrator
from agents.core.models import AgentTask, TaskPriority

async def main():
    async with create_orchestrator(model="claude-sonnet-4-6") as orch:

        # Generate a React component
        task = orch.build_task(
            task_type="frontend_component",
            payload={
                "name": "PortfolioSummaryCard",
                "description": "Card displaying portfolio value, P&L, and allocation",
                "props": ["portfolioId", "onExpand"],
                "has_state": True,
                "uses_api": True,
            },
        )
        response = await orch.dispatch(task)
        print(response.content)

        # Review code for security issues
        sec_task = orch.build_task(
            task_type="vulnerability_scan",
            payload={"code": "<your python code here>", "scan_type": "owasp"},
            priority=TaskPriority.HIGH,
        )
        sec_response = await orch.dispatch(sec_task)
        print(sec_response.content)

asyncio.run(main())
```

---

## Core Concepts

### AgentTask

```python
AgentTask(
    task_type="api_design",          # maps to an agent via the routing table
    payload={"domain": "portfolios", "operations": ["list", "create", "delete"]},
    priority=TaskPriority.HIGH,
    dependencies=["task-uuid-abc"],  # wait for this task to complete first
)
```

### AgentResponse

```python
AgentResponse(
    task_id="...",
    agent_id="api_...",
    agent_type=AgentType.API,
    status=ResponseStatus.SUCCESS,
    content="# API Design\n...",    # generated content
    artifacts=[Artifact(...)],       # code files, reports, etc.
    execution_time_ms=1240.5,
)
```

### Task Routing Table

| task_type | → Agent |
|---|---|
| `architecture_review` | ChiefArchitectAgent |
| `frontend_component` | FrontendLeadAgent |
| `backend_service` | BackendLeadAgent |
| `design_system` | UIUXAgent |
| `responsive_layout` | ResponsiveAgent |
| `api_design` / `rest_endpoint` | APIAgent |
| `schema_design` / `migration` | DatabaseAgent |
| `ai_copilot` / `streaming_chat` | AIAgent |
| `portfolio_analytics` / `risk_calculation` | SkillsAgent |
| `dockerfile` / `kubernetes_manifest` | DevOpsAgent |
| `jwt_setup` / `rbac_policy` | SecurityAgent |
| `unit_test` / `e2e_test` | QAAgent |
| `frontend_perf` / `cache_strategy` | PerformanceAgent |

Full routing table: `orchestrator.routing_table()`

### Delegation

Agents can delegate sub-tasks to other agents:

```python
# Inside any agent's process_task():
response = await self.delegate_task(
    target_type=AgentType.SECURITY,
    task=subtask,
    reason="Needs JWT implementation",
)
```

Parallel delegation:

```python
responses = await self.delegate_tasks_parallel([
    (AgentType.QA,          qa_task,   "Generate tests"),
    (AgentType.PERFORMANCE, perf_task, "Profile endpoint"),
])
```

### SharedContext

All agents share a global async key-value store:

```python
await context.set("platform.theme", "dark")
theme = await context.get("platform.theme")

# Watch for changes
context.watch("platform.theme", lambda key, val: print(f"{key} → {val}"))
```

### AgentMemory

Each agent has its own memory for conversation history and persistent KV:

```python
agent.memory.remember("last_schema_version", "v3")
version = agent.memory.recall("last_schema_version")

history = agent.memory.get_recent_history(last_n=5)  # LangChain messages
```

---

## Adding a New Agent

1. Create `agents/<domain>/<name>_agent.py`:

```python
from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType

class MyNewAgent(BaseAgent):
    agent_type = AgentType.MY_TYPE          # add to AgentType enum first
    capabilities = ["my_task_type"]
    system_prompt = "You are ..."

    async def process_task(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(task.payload.get("description", ""))
        return self._success_response(task, content)
```

2. Register it in [orchestrator.py](orchestrator.py) `_register_all_agents()`.

3. Add routing rules in [core/router.py](core/router.py) `TASK_TYPE_ROUTES`.

---

## Architecture Principles

- **Async-first**: All I/O is `await`-able; no blocking calls in the event loop.
- **LangChain integration**: Each agent uses `BaseChatModel`; swap providers without changing agents.
- **No hard coupling**: Agents communicate via `DelegationRequest` and `SharedContext`, never by direct import.
- **Extensible routing**: Static table + pluggable `RoutingRule` instances.
- **Memory isolation**: Each agent has its own `AgentMemory`; shared state lives in `SharedContext`.
- **Production logging**: structlog with JSON output for log aggregation pipelines.
