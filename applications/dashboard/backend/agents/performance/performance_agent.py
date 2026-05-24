"""
PerformanceAgent — frontend, backend, WebSocket, and query optimisation.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import PERFORMANCE_SYSTEM


class PerformanceAgent(BaseAgent):
    """
    Identifies and resolves performance bottlenecks across all layers
    of the investment platform.
    """

    agent_type: ClassVar[AgentType] = AgentType.PERFORMANCE

    capabilities: ClassVar[list[str]] = [
        "frontend_perf",
        "backend_perf",
        "websocket_scaling",
        "cache_strategy",
        "load_testing",
        "bundle_optimisation",
        "api_profiling",
    ]

    system_prompt: ClassVar[str] = PERFORMANCE_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "frontend_perf": self._optimise_frontend,
            "backend_perf": self._optimise_backend,
            "websocket_scaling": self._scale_websockets,
            "cache_strategy": self._design_caching,
            "load_testing": self._design_load_test,
            "bundle_optimisation": self._optimise_bundle,
            "api_profiling": self._profile_api,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _optimise_frontend(self, task: AgentTask) -> AgentResponse:
        metrics = task.payload.get("metrics", {})
        issues = task.payload.get("issues", [])

        prompt = (
            f"Optimise the React frontend performance.\n\n"
            f"Current metrics: {metrics}\n"
            f"Identified issues: {issues}\n\n"
            f"Apply:\n"
            f"1. Code splitting (React.lazy + Suspense per route)\n"
            f"2. Bundle analysis (vite-bundle-visualizer findings)\n"
            f"3. Image optimisation (WebP, lazy loading, blur placeholder)\n"
            f"4. React rendering optimisation (memo, useMemo, useCallback)\n"
            f"5. Virtual list for large datasets (react-virtual)\n"
            f"6. Preloading critical routes\n"
            f"7. Web Vitals targets: LCP <2.5s, FID <100ms, CLS <0.1\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _optimise_backend(self, task: AgentTask) -> AgentResponse:
        endpoint = task.payload.get("endpoint", "")
        p99_ms = task.payload.get("p99_ms", 0)
        profile_data = task.payload.get("profile_data", "")

        prompt = (
            f"Optimise the FastAPI backend for endpoint: {endpoint}\n\n"
            f"Current p99: {p99_ms}ms\n"
            f"Profile data:\n{profile_data}\n\n"
            f"Apply:\n"
            f"1. Async I/O everywhere (no blocking calls in event loop)\n"
            f"2. N+1 query elimination (selectinload / joinedload)\n"
            f"3. Response caching (Redis cache-aside)\n"
            f"4. Pagination with cursor-based strategy\n"
            f"5. Background tasks for non-critical work\n"
            f"6. Connection pool tuning\n"
            f"7. Target: p99 <100ms\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _scale_websockets(self, task: AgentTask) -> AgentResponse:
        concurrent = task.payload.get("concurrent_connections", 10000)
        channels = task.payload.get("channels", [])

        prompt = (
            f"Design a WebSocket scaling strategy for {concurrent} concurrent connections.\n\n"
            f"Channels: {channels}\n\n"
            f"Cover:\n"
            f"1. Redis Pub/Sub for multi-node message fanout\n"
            f"2. Connection manager architecture\n"
            f"3. Horizontal scaling with sticky sessions (or stateless design)\n"
            f"4. Backpressure handling (slow consumer)\n"
            f"5. Heartbeat and dead connection cleanup\n"
            f"6. Message batching and compression (permessage-deflate)\n"
            f"7. Load test scenario (k6 WebSocket)\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_caching(self, task: AgentTask) -> AgentResponse:
        resources = task.payload.get("resources", [])
        ttl_map = task.payload.get("ttl_map", {})

        prompt = (
            f"Design the multi-layer caching strategy for resources: {resources}\n\n"
            f"TTL requirements: {ttl_map}\n\n"
            f"Layers:\n"
            f"1. Browser cache (Cache-Control headers per resource type)\n"
            f"2. CDN edge caching (CloudFront rules)\n"
            f"3. API response cache (Redis, cache-aside pattern)\n"
            f"4. Database query result cache\n"
            f"5. In-process LRU cache (functools.lru_cache / aiocache)\n\n"
            f"Include cache invalidation strategy for each layer."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_load_test(self, task: AgentTask) -> AgentResponse:
        target_rps = task.payload.get("target_rps", 1000)
        scenarios = task.payload.get("scenarios", [])

        prompt = (
            f"Design a k6 load test suite for the investment platform.\n\n"
            f"Target: {target_rps} RPS sustained\n"
            f"Scenarios: {scenarios}\n\n"
            f"Provide:\n"
            f"1. k6 script with stages (ramp-up, sustained, ramp-down)\n"
            f"2. Thresholds (p95 <200ms, error rate <0.1%)\n"
            f"3. WebSocket scenario\n"
            f"4. Realistic user simulation (auth + portfolio browsing)\n"
            f"5. CI integration (fail build if thresholds breached)\n"
            f"6. Results dashboard (k6 Cloud or Grafana)\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name="load_test.js",
            content=content,
            metadata={"tool": "k6", "target_rps": target_rps},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _optimise_bundle(self, task: AgentTask) -> AgentResponse:
        bundle_report = task.payload.get("bundle_report", "")
        current_size_kb = task.payload.get("current_size_kb", 0)

        prompt = (
            f"Optimise the Vite bundle. Current size: {current_size_kb}KB\n\n"
            f"Bundle report:\n{bundle_report}\n\n"
            f"Apply:\n"
            f"1. Manual chunk splitting (vendor, charts, AI components)\n"
            f"2. Tree-shaking verification\n"
            f"3. Remove duplicate dependencies\n"
            f"4. Replace heavy libraries with lighter alternatives\n"
            f"5. Dynamic imports for rarely-used features\n"
            f"6. Target: initial JS <200KB gzipped\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _profile_api(self, task: AgentTask) -> AgentResponse:
        endpoint = task.payload.get("endpoint", "")
        slow_queries = task.payload.get("slow_queries", [])

        prompt = (
            f"Profile and optimise the API endpoint: {endpoint}\n\n"
            f"Slow queries identified:\n"
            + "\n".join(f"- {q}" for q in slow_queries)
            + f"\n\n"
            f"Produce:\n"
            f"1. py-spy / cProfile analysis interpretation\n"
            f"2. SQL EXPLAIN ANALYSE for each slow query\n"
            f"3. Optimised query rewrites\n"
            f"4. Required index additions\n"
            f"5. Application-level caching opportunities\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Performance request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
