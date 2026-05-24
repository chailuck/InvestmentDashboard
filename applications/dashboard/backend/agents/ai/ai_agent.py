"""
AIAgent — LangChain copilot, streaming chat, and LLM orchestration.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import AI_SYSTEM


class AIAgent(BaseAgent):
    """
    Designs and implements the AI copilot layer: streaming chat,
    RAG pipelines, tool-use, and LLM provider integration.
    """

    agent_type: ClassVar[AgentType] = AgentType.AI

    capabilities: ClassVar[list[str]] = [
        "ai_copilot",
        "llm_integration",
        "streaming_chat",
        "ai_orchestration",
        "prompt_engineering",
        "rag_pipeline",
        "tool_use_design",
        "agent_design",
    ]

    system_prompt: ClassVar[str] = AI_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "ai_copilot": self._design_copilot,
            "llm_integration": self._integrate_llm,
            "streaming_chat": self._implement_streaming,
            "ai_orchestration": self._design_orchestration,
            "prompt_engineering": self._engineer_prompt,
            "rag_pipeline": self._design_rag,
            "tool_use_design": self._design_tools,
            "agent_design": self._design_agent,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _design_copilot(self, task: AgentTask) -> AgentResponse:
        features = task.payload.get("features", [])
        prompt = (
            f"Design the AI copilot architecture for the investment dashboard.\n\n"
            f"Required features: {features}\n\n"
            f"Cover:\n"
            f"1. LangChain conversational chain setup (with memory)\n"
            f"2. Tool registry (portfolio lookup, market data, news fetch)\n"
            f"3. System prompt design for fintech domain\n"
            f"4. Streaming response via Server-Sent Events (FastAPI + LangChain)\n"
            f"5. Conversation history storage (PostgreSQL + Redis for hot sessions)\n"
            f"6. Context window management (token counting, summarisation)\n"
            f"7. Safety filters (output validation, PII detection)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _integrate_llm(self, task: AgentTask) -> AgentResponse:
        provider = task.payload.get("provider", "anthropic")
        model = task.payload.get("model", "claude-sonnet-4-6")

        prompt = (
            f"Integrate the `{provider}` LLM provider (model: {model}) into the "
            f"FastAPI backend using LangChain.\n\n"
            f"Include:\n"
            f"1. LangChain ChatModel initialisation with retry logic\n"
            f"2. Environment-based API key management\n"
            f"3. Fallback provider chain (primary → secondary)\n"
            f"4. Token usage tracking and cost estimation\n"
            f"5. Request/response logging (without PII)\n"
            f"6. Async invocation with timeout\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"llm_{provider}_client.py",
            content=content,
            metadata={"provider": provider, "model": model},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _implement_streaming(self, task: AgentTask) -> AgentResponse:
        prompt = (
            f"Implement streaming chat for the investment AI copilot.\n\n"
            f"Backend (FastAPI):\n"
            f"1. SSE endpoint using StreamingResponse\n"
            f"2. LangChain astream() integration\n"
            f"3. Delta token forwarding\n"
            f"4. Stream cancellation handling\n"
            f"5. Error injection into stream\n\n"
            f"Frontend (React):\n"
            f"1. EventSource / fetch-based SSE client\n"
            f"2. Token accumulation and progressive rendering\n"
            f"3. Markdown rendering while streaming\n"
            f"4. Abort controller for cancellation\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_orchestration(self, task: AgentTask) -> AgentResponse:
        workflow = task.payload.get("workflow", "")
        prompt = (
            f"Design LangChain agent orchestration for: {workflow}\n\n"
            f"Define:\n"
            f"1. LangGraph workflow nodes and edges\n"
            f"2. State schema (TypedDict)\n"
            f"3. Conditional routing logic\n"
            f"4. Tool-calling nodes\n"
            f"5. Human-in-the-loop checkpoints\n"
            f"6. Parallel execution branches\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _engineer_prompt(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "investment analysis")
        goal = task.payload.get("goal", "")
        constraints = task.payload.get("constraints", [])

        prompt = (
            f"Engineer a production-quality prompt for: {goal}\n\n"
            f"Domain: {domain}\n"
            f"Constraints: {constraints}\n\n"
            f"Provide:\n"
            f"1. System prompt (persona, capabilities, limitations)\n"
            f"2. Instruction format with few-shot examples\n"
            f"3. Output schema specification\n"
            f"4. Chain-of-thought guidance\n"
            f"5. Guardrails and refusal patterns\n"
            f"6. Evaluation criteria\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_rag(self, task: AgentTask) -> AgentResponse:
        data_sources = task.payload.get("data_sources", [])
        prompt = (
            f"Design a RAG pipeline for the investment copilot.\n\n"
            f"Data sources: {data_sources}\n\n"
            f"Cover:\n"
            f"1. Document ingestion pipeline (chunking strategy)\n"
            f"2. Embedding model selection (OpenAI / local)\n"
            f"3. Vector store (pgvector in PostgreSQL)\n"
            f"4. Retrieval strategy (similarity + BM25 hybrid)\n"
            f"5. Re-ranking step\n"
            f"6. Context injection into LLM prompt\n"
            f"7. Citation tracking\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_tools(self, task: AgentTask) -> AgentResponse:
        tool_names = task.payload.get("tools", [])
        prompt = (
            f"Design LangChain tools for the investment copilot: {tool_names}\n\n"
            f"For each tool:\n"
            f"1. Tool class definition (name, description, args_schema)\n"
            f"2. Async _arun() implementation\n"
            f"3. Error handling and fallback\n"
            f"4. Input/output type validation\n"
            f"5. Rate limiting and caching\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_agent(self, task: AgentTask) -> AgentResponse:
        agent_name = task.payload.get("agent_name", "")
        responsibilities = task.payload.get("responsibilities", [])
        prompt = (
            f"Design the `{agent_name}` LangChain agent.\n\n"
            f"Responsibilities: {responsibilities}\n\n"
            f"Specify:\n"
            f"1. Agent type (ReAct / OpenAI Functions / LangGraph)\n"
            f"2. Available tools\n"
            f"3. Memory configuration\n"
            f"4. Stopping criteria\n"
            f"5. Output parser\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"AI/LLM request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
