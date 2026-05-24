"""
TaskQueue — priority-ordered async queue with dependency tracking.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from .models import AgentTask, TaskPriority, TaskStatus

logger = logging.getLogger(__name__)


class QueuedTask:
    """Wrapper held inside the asyncio.PriorityQueue."""

    __slots__ = ("priority", "enqueued_at", "task")

    def __init__(self, task: AgentTask) -> None:
        self.priority = task.priority.value
        self.enqueued_at = datetime.utcnow()
        self.task = task

    def __lt__(self, other: "QueuedTask") -> bool:
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.enqueued_at < other.enqueued_at

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, QueuedTask):
            return NotImplemented
        return self.task.task_id == other.task.task_id


class TaskQueue:
    """
    Priority async queue with dependency resolution.

    Features:
    - Four priority levels (CRITICAL / HIGH / NORMAL / LOW)
    - Dependency tracking: tasks are held until all dependencies complete
    - Metrics: enqueue count, dequeue count, current depth
    """

    def __init__(self, maxsize: int = 0) -> None:
        self._pq: asyncio.PriorityQueue[QueuedTask] = asyncio.PriorityQueue(maxsize=maxsize)
        self._held: dict[str, QueuedTask] = {}
        self._completed: set[str] = set()
        self._all_tasks: dict[str, AgentTask] = {}
        self._lock = asyncio.Lock()
        self._enqueue_count = 0
        self._dequeue_count = 0

    # -----------------------------------------------------------------------
    # Enqueue
    # -----------------------------------------------------------------------

    async def enqueue(self, task: AgentTask) -> None:
        async with self._lock:
            self._all_tasks[task.task_id] = task
            self._enqueue_count += 1
            task.status = TaskStatus.QUEUED

        if await self._dependencies_met(task):
            await self._pq.put(QueuedTask(task))
            logger.debug("Enqueued task %s (type=%s)", task.task_id, task.task_type)
        else:
            async with self._lock:
                self._held[task.task_id] = QueuedTask(task)
            logger.debug(
                "Held task %s pending dependencies %s",
                task.task_id,
                task.dependencies,
            )

    async def enqueue_many(self, tasks: list[AgentTask]) -> None:
        for task in tasks:
            await self.enqueue(task)

    # -----------------------------------------------------------------------
    # Dequeue
    # -----------------------------------------------------------------------

    async def dequeue(self, timeout: float | None = None) -> AgentTask | None:
        try:
            if timeout is not None:
                queued = await asyncio.wait_for(self._pq.get(), timeout=timeout)
            else:
                queued = await self._pq.get()
            self._dequeue_count += 1
            return queued.task
        except asyncio.TimeoutError:
            return None

    def dequeue_nowait(self) -> AgentTask | None:
        try:
            queued = self._pq.get_nowait()
            self._dequeue_count += 1
            return queued.task
        except asyncio.QueueEmpty:
            return None

    # -----------------------------------------------------------------------
    # Completion signalling
    # -----------------------------------------------------------------------

    async def mark_complete(self, task_id: str) -> None:
        """Signal task completion; release any tasks waiting on this dependency."""
        async with self._lock:
            self._completed.add(task_id)

        await self._release_held_tasks()

    async def _release_held_tasks(self) -> None:
        async with self._lock:
            to_release = [
                qt for qt in self._held.values()
                if all(dep in self._completed for dep in qt.task.dependencies)
            ]
            for qt in to_release:
                del self._held[qt.task.task_id]

        for qt in to_release:
            await self._pq.put(qt)
            logger.debug("Released held task %s", qt.task.task_id)

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    async def _dependencies_met(self, task: AgentTask) -> bool:
        if not task.dependencies:
            return True
        async with self._lock:
            return all(dep in self._completed for dep in task.dependencies)

    def task_done(self) -> None:
        """Call after processing a dequeued task (mirrors asyncio.Queue.task_done)."""
        self._pq.task_done()

    async def join(self) -> None:
        """Wait until all enqueued tasks have been processed."""
        await self._pq.join()

    # -----------------------------------------------------------------------
    # Introspection
    # -----------------------------------------------------------------------

    @property
    def qsize(self) -> int:
        return self._pq.qsize()

    @property
    def held_count(self) -> int:
        return len(self._held)

    @property
    def completed_count(self) -> int:
        return len(self._completed)

    def metrics(self) -> dict[str, Any]:
        return {
            "queued": self.qsize,
            "held": self.held_count,
            "completed": self.completed_count,
            "total_enqueued": self._enqueue_count,
            "total_dequeued": self._dequeue_count,
        }

    def __repr__(self) -> str:
        return (
            f"<TaskQueue queued={self.qsize} held={self.held_count} "
            f"completed={self.completed_count}>"
        )
