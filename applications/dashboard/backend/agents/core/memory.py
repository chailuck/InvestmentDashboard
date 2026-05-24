"""
Per-agent memory: conversation history + persistent key-value store.
"""

from __future__ import annotations

import json
import logging
from collections import deque
from datetime import datetime
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

logger = logging.getLogger(__name__)


class ConversationTurn:
    __slots__ = ("human", "ai", "timestamp")

    def __init__(self, human: str, ai: str) -> None:
        self.human = human
        self.ai = ai
        self.timestamp = datetime.utcnow()


class AgentMemory:
    """
    Short-term window memory + persistent key-value store for an agent.

    - Conversation history is kept as a sliding window (default 20 turns).
    - The kv store persists across tasks within one process lifetime;
      attach a real backend (Redis, Postgres) for cross-process persistence.
    """

    DEFAULT_WINDOW = 20

    def __init__(
        self,
        agent_id: str,
        window_size: int = DEFAULT_WINDOW,
    ) -> None:
        self.agent_id = agent_id
        self._history: deque[ConversationTurn] = deque(maxlen=window_size)
        self._kv: dict[str, Any] = {}
        self._window_size = window_size

    # -----------------------------------------------------------------------
    # Conversation history
    # -----------------------------------------------------------------------

    def add_exchange(self, human: str, ai: str) -> None:
        self._history.append(ConversationTurn(human=human, ai=ai))

    def get_recent_history(self, last_n: int | None = None) -> list[BaseMessage]:
        """Return LangChain message objects for the last N turns."""
        turns = list(self._history)
        if last_n is not None:
            turns = turns[-last_n:]

        messages: list[BaseMessage] = []
        for turn in turns:
            messages.append(HumanMessage(content=turn.human))
            messages.append(AIMessage(content=turn.ai))
        return messages

    def clear_history(self) -> None:
        self._history.clear()

    @property
    def history_length(self) -> int:
        return len(self._history)

    # -----------------------------------------------------------------------
    # Key-value store
    # -----------------------------------------------------------------------

    def remember(self, key: str, value: Any) -> None:
        self._kv[key] = value

    def recall(self, key: str, default: Any = None) -> Any:
        return self._kv.get(key, default)

    def forget(self, key: str) -> None:
        self._kv.pop(key, None)

    def recall_all(self) -> dict[str, Any]:
        return dict(self._kv)

    # -----------------------------------------------------------------------
    # Serialisation (for snapshotting / persisting to external store)
    # -----------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "kv": self._kv,
            "history": [
                {
                    "human": t.human,
                    "ai": t.ai,
                    "timestamp": t.timestamp.isoformat(),
                }
                for t in self._history
            ],
        }

    def restore(self, snapshot: dict[str, Any]) -> None:
        self._kv = snapshot.get("kv", {})
        self._history.clear()
        for entry in snapshot.get("history", []):
            turn = ConversationTurn(human=entry["human"], ai=entry["ai"])
            self._history.append(turn)

    def to_json(self) -> str:
        return json.dumps(self.snapshot(), default=str)

    @classmethod
    def from_json(cls, data: str, window_size: int = DEFAULT_WINDOW) -> "AgentMemory":
        payload = json.loads(data)
        mem = cls(agent_id=payload["agent_id"], window_size=window_size)
        mem.restore(payload)
        return mem

    def __repr__(self) -> str:
        return (
            f"<AgentMemory agent_id={self.agent_id} "
            f"history={len(self._history)} kv_keys={len(self._kv)}>"
        )
