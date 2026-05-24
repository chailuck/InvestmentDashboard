"""
Core data models for the multi-agent system.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    DELEGATED = "delegated"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(int, Enum):
    CRITICAL = 0
    HIGH = 1
    NORMAL = 2
    LOW = 3


class AgentType(str, Enum):
    CHIEF_ARCHITECT = "chief_architect"
    FRONTEND_LEAD = "frontend_lead"
    BACKEND_LEAD = "backend_lead"
    UIUX = "uiux"
    RESPONSIVE = "responsive"
    API = "api"
    DATABASE = "database"
    AI = "ai"
    SKILLS = "skills"
    DEVOPS = "devops"
    SECURITY = "security"
    QA = "qa"
    PERFORMANCE = "performance"


class ResponseStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    DELEGATED = "delegated"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Task models
# ---------------------------------------------------------------------------

class TaskMetadata(BaseModel):
    source_agent: str | None = None
    trace_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tags: list[str] = Field(default_factory=list)
    context_keys: list[str] = Field(default_factory=list)
    retry_count: int = 0
    max_retries: int = 3
    timeout_seconds: int = 300


class AgentTask(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_type: str
    priority: TaskPriority = TaskPriority.NORMAL
    payload: dict[str, Any] = Field(default_factory=dict)
    dependencies: list[str] = Field(default_factory=list)
    metadata: TaskMetadata = Field(default_factory=TaskMetadata)
    status: TaskStatus = TaskStatus.PENDING
    assigned_agent: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None

    def mark_in_progress(self, agent_id: str) -> None:
        self.status = TaskStatus.IN_PROGRESS
        self.assigned_agent = agent_id
        self.updated_at = datetime.utcnow()

    def mark_completed(self) -> None:
        self.status = TaskStatus.COMPLETED
        self.completed_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def mark_failed(self) -> None:
        self.status = TaskStatus.FAILED
        self.updated_at = datetime.utcnow()

    def can_retry(self) -> bool:
        return self.metadata.retry_count < self.metadata.max_retries


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class Artifact(BaseModel):
    artifact_type: str
    name: str
    content: Any
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    response_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str
    agent_id: str
    agent_type: AgentType
    status: ResponseStatus
    content: str
    artifacts: list[Artifact] = Field(default_factory=list)
    sub_responses: list["AgentResponse"] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    execution_time_ms: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def is_successful(self) -> bool:
        return self.status in (ResponseStatus.SUCCESS, ResponseStatus.DELEGATED)


AgentResponse.model_rebuild()


# ---------------------------------------------------------------------------
# Event models
# ---------------------------------------------------------------------------

class AgentEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    source_agent: str
    target_agent: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DelegationRequest(BaseModel):
    from_agent: str
    to_agent_type: AgentType
    task: AgentTask
    reason: str
    context_snapshot: dict[str, Any] = Field(default_factory=dict)


class DelegationResponse(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    accepted: bool
    agent_id: str | None = None
    message: str = ""
    estimated_completion_ms: int | None = None
