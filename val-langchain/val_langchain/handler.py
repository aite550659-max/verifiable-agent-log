"""LangChain callback handler that attests agent actions to Hedera HCS via VAL."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Sequence, Union
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult

from val_langchain.client import HCSClient

logger = logging.getLogger(__name__)


def _hash(obj: Any) -> str:
    """SHA-256 hash of the JSON-serialised object."""
    raw = json.dumps(obj, separators=(",", ":"), sort_keys=True, default=str)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


class VALHandler(BaseCallbackHandler):
    """Callback handler that writes VAL attestations to Hedera HCS.

    Usage::

        handler = VALHandler(
            topic_id="0.0.12345",
            account_id="0.0.67890",
            private_key="302e...",
            network="testnet",
        )
        llm = ChatOpenAI(callbacks=[handler])
    """

    def __init__(
        self,
        topic_id: str,
        account_id: str,
        private_key: str,
        network: str = "testnet",
        *,
        attest_chains: bool = False,
        attest_heartbeats: bool = False,
    ) -> None:
        super().__init__()
        self.topic_id = topic_id
        self.client = HCSClient(account_id, private_key, network)
        self.attest_chains = attest_chains
        self.attest_heartbeats = attest_heartbeats
        # Track in-flight tool runs keyed by run_id
        self._pending: Dict[UUID, Dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _submit(self, msg_type: str, data: Dict[str, Any]) -> None:
        attestation = self.client.build_attestation(self.topic_id, msg_type, data)
        self.client.submit_attestation(self.topic_id, attestation)

    # ------------------------------------------------------------------
    # LLM callbacks
    # ------------------------------------------------------------------

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        if self.attest_heartbeats:
            self._submit("heartbeat", {"desc": "llm_start"})

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        pass  # intentionally silent — tool calls are the important events

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        self._submit("action", {
            "tool": "llm",
            "status": "error",
            "desc": str(error)[:200],
        })

    # ------------------------------------------------------------------
    # Tool callbacks
    # ------------------------------------------------------------------

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        tool_name = serialized.get("name", "unknown")
        input_hash = _hash(input_str)
        self._pending[run_id] = {"tool": tool_name, "input_hash": input_hash}
        self._submit("action", {
            "tool": tool_name,
            "input_hash": input_hash,
            "status": "started",
            "desc": f"Tool {tool_name} invoked",
        })

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        pending = self._pending.pop(run_id, {})
        self._submit("action", {
            "tool": pending.get("tool", "unknown"),
            "input_hash": pending.get("input_hash", ""),
            "output_hash": _hash(output),
            "status": "success",
            "desc": f"Tool {pending.get('tool', 'unknown')} completed",
        })

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        pending = self._pending.pop(run_id, {})
        self._submit("action", {
            "tool": pending.get("tool", "unknown"),
            "input_hash": pending.get("input_hash", ""),
            "status": "error",
            "desc": str(error)[:200],
        })

    # ------------------------------------------------------------------
    # Chain callbacks (optional)
    # ------------------------------------------------------------------

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        if self.attest_chains:
            chain_name = serialized.get("name", serialized.get("id", ["unknown"])[-1])
            self._submit("action", {
                "tool": f"chain:{chain_name}",
                "input_hash": _hash(inputs),
                "status": "started",
                "desc": f"Chain {chain_name} started",
            })

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        if self.attest_chains:
            self._submit("action", {
                "output_hash": _hash(outputs),
                "status": "success",
                "desc": "Chain completed",
            })

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        self._submit("action", {
            "status": "error",
            "desc": f"Chain error: {str(error)[:200]}",
        })

    # ------------------------------------------------------------------
    # Agent callbacks (pass-through to chain)
    # ------------------------------------------------------------------

    def on_agent_action(
        self,
        action: AgentAction,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        pass  # tool_start handles this

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        pass  # chain_end handles this
