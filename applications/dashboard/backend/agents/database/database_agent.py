"""
DatabaseAgent — PostgreSQL schema, migrations, indexing, and query optimisation.
"""

from __future__ import annotations

from typing import ClassVar

from ..core.base_agent import BaseAgent
from ..core.models import AgentResponse, AgentTask, AgentType, Artifact
from ..shared.prompts import DATABASE_SYSTEM


class DatabaseAgent(BaseAgent):
    """
    Owns the data layer: schema design, Alembic migrations, index strategy,
    connection pooling, and query optimisation for the investment platform.
    """

    agent_type: ClassVar[AgentType] = AgentType.DATABASE

    capabilities: ClassVar[list[str]] = [
        "schema_design",
        "migration",
        "index_optimisation",
        "query_optimisation",
        "connection_pooling",
        "timeseries_schema",
        "database_review",
    ]

    system_prompt: ClassVar[str] = DATABASE_SYSTEM

    async def process_task(self, task: AgentTask) -> AgentResponse:
        dispatch = {
            "schema_design": self._design_schema,
            "migration": self._generate_migration,
            "index_optimisation": self._optimise_indexes,
            "query_optimisation": self._optimise_query,
            "connection_pooling": self._configure_pooling,
            "timeseries_schema": self._design_timeseries,
            "database_review": self._review_database,
        }
        handler = dispatch.get(task.task_type)
        if handler:
            return await handler(task)
        return await self._generic(task)

    async def _design_schema(self, task: AgentTask) -> AgentResponse:
        domain = task.payload.get("domain", "")
        entities = task.payload.get("entities", [])
        constraints = task.payload.get("constraints", [])

        prompt = (
            f"Design the PostgreSQL schema for the `{domain}` domain.\n\n"
            f"Entities: {entities}\n"
            f"Business constraints: {constraints}\n\n"
            f"For each table provide:\n"
            f"1. CREATE TABLE DDL (with proper types, not nullability, defaults)\n"
            f"2. Primary key strategy (UUID vs BIGSERIAL)\n"
            f"3. Foreign key relationships with ON DELETE behaviour\n"
            f"4. Partial or functional indexes for common query patterns\n"
            f"5. Partitioning strategy if table > 10M rows expected\n"
            f"6. Audit columns (created_at, updated_at, deleted_at)\n"
            f"7. Check constraints and unique constraints\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"schema_{domain}.sql",
            content=content,
            metadata={"language": "sql", "domain": domain},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _generate_migration(self, task: AgentTask) -> AgentResponse:
        description = task.payload.get("description", "")
        changes = task.payload.get("changes", [])
        is_destructive = task.payload.get("is_destructive", False)

        prompt = (
            f"Generate an Alembic migration script.\n\n"
            f"Description: {description}\n"
            f"Changes: {changes}\n"
            f"Destructive: {is_destructive}\n\n"
            f"Include:\n"
            f"1. Full upgrade() function\n"
            f"2. Full downgrade() function (must be reversible)\n"
            f"3. Zero-downtime strategy if adding NOT NULL column\n"
            f"4. Data migration steps if needed\n"
            f"5. Index creation CONCURRENTLY where appropriate\n"
            f"{'6. Safety check — warn about lock duration on large tables' if is_destructive else ''}\n"
        )
        content = await self.invoke_llm(prompt)
        artifact = Artifact(
            artifact_type="code",
            name=f"migration_{description[:30].replace(' ', '_')}.py",
            content=content,
            metadata={"type": "alembic_migration", "destructive": is_destructive},
        )
        return self._success_response(task, content, artifacts=[artifact])

    async def _optimise_indexes(self, task: AgentTask) -> AgentResponse:
        table = task.payload.get("table", "")
        query_patterns = task.payload.get("query_patterns", [])

        prompt = (
            f"Design the index strategy for table `{table}`.\n\n"
            f"Query patterns:\n"
            + "\n".join(f"- {q}" for q in query_patterns)
            + f"\n\n"
            f"For each recommended index:\n"
            f"1. CREATE INDEX statement (with CONCURRENTLY)\n"
            f"2. Index type (BTree, GIN, BRIN, partial)\n"
            f"3. Columns and order\n"
            f"4. Expected query improvement\n"
            f"5. Write overhead trade-off\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _optimise_query(self, task: AgentTask) -> AgentResponse:
        query = task.payload.get("query", "")
        explain_output = task.payload.get("explain_output", "")

        prompt = (
            f"Optimise the following PostgreSQL query.\n\n"
            f"Original query:\n```sql\n{query}\n```\n\n"
            f"EXPLAIN ANALYSE output:\n{explain_output}\n\n"
            f"Provide:\n"
            f"1. Root cause of performance issue\n"
            f"2. Optimised query with explanation\n"
            f"3. Required index changes\n"
            f"4. Alternative approaches (CTEs, materialised views)\n"
            f"5. Expected performance improvement\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _configure_pooling(self, task: AgentTask) -> AgentResponse:
        expected_connections = task.payload.get("expected_connections", 500)
        prompt = (
            f"Configure async database connection pooling for {expected_connections} "
            f"expected concurrent connections.\n\n"
            f"Provide:\n"
            f"1. SQLAlchemy async engine config (pool_size, max_overflow, pool_timeout)\n"
            f"2. asyncpg pool configuration\n"
            f"3. PgBouncer config for Kubernetes deployment\n"
            f"4. Health-check query\n"
            f"5. Connection lifecycle management in FastAPI lifespan\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _design_timeseries(self, task: AgentTask) -> AgentResponse:
        data_type = task.payload.get("data_type", "market_prices")
        retention_days = task.payload.get("retention_days", 3650)

        prompt = (
            f"Design the TimescaleDB hypertable schema for `{data_type}` "
            f"with {retention_days} day retention.\n\n"
            f"Include:\n"
            f"1. Hypertable creation (time column, chunk_time_interval)\n"
            f"2. Compression policy\n"
            f"3. Retention policy\n"
            f"4. Continuous aggregate for daily/weekly rollups\n"
            f"5. Indexes for symbol + time range queries\n"
            f"6. Partition strategy\n"
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _review_database(self, task: AgentTask) -> AgentResponse:
        schema = task.payload.get("schema", "")
        prompt = (
            f"Review the following database schema for issues:\n\n"
            f"```sql\n{schema}\n```\n\n"
            f"Check: normalisation, missing indexes, N+1 query risks, "
            f"cascade delete safety, missing audit columns, and type choices."
        )
        content = await self.invoke_llm(prompt)
        return self._success_response(task, content)

    async def _generic(self, task: AgentTask) -> AgentResponse:
        content = await self.invoke_llm(
            f"Database request — {task.task_type}: {task.payload}"
        )
        return self._success_response(task, content)
