"""Verification utilities for VAL audit logs on Hedera HCS."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

from val_langchain.client import MIRROR_URLS

logger = logging.getLogger(__name__)


@dataclass
class VerificationResult:
    """Outcome of a VAL log verification."""

    valid: bool
    messages_checked: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def __str__(self) -> str:
        status = "✅ VALID" if self.valid else "❌ INVALID"
        parts = [f"{status} ({self.messages_checked} messages)"]
        for e in self.errors:
            parts.append(f"  ERROR: {e}")
        for w in self.warnings:
            parts.append(f"  WARN:  {w}")
        return "\n".join(parts)


def fetch_log(
    topic_id: str,
    network: str = "mainnet",
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Fetch all VAL messages for a topic from the Hedera mirror node.

    Returns a list of parsed JSON message dicts, ordered by sequence number.
    """
    mirror = MIRROR_URLS.get(network, MIRROR_URLS["mainnet"])
    url = f"{mirror}/api/v1/topics/{topic_id}/messages"
    messages: List[Dict[str, Any]] = []
    params: Dict[str, Any] = {"limit": min(limit, 100), "order": "asc"}

    while True:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for msg in data.get("messages", []):
            raw = msg.get("message", "")
            try:
                decoded = base64.b64decode(raw).decode("utf-8")
                parsed = json.loads(decoded)
                parsed["_seq"] = msg.get("sequence_number")
                parsed["_consensus_ts"] = msg.get("consensus_timestamp")
                messages.append(parsed)
            except (json.JSONDecodeError, Exception) as exc:
                logger.warning("Skipping unparseable message seq=%s: %s", msg.get("sequence_number"), exc)

        links = data.get("links", {})
        next_link = links.get("next")
        if not next_link or len(messages) >= limit:
            break
        # next_link is a relative path like /api/v1/topics/.../messages?...
        url = f"{mirror}{next_link}"
        params = {}  # params are embedded in next_link

    return messages


def verify_hash(content: str, attested_hash: str) -> bool:
    """Verify that content matches an attested sha256 hash.

    Args:
        content: The original content string.
        attested_hash: Hash in format ``sha256:<hex>``.
    """
    if not attested_hash.startswith("sha256:"):
        return False
    expected = attested_hash.split(":", 1)[1]
    actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return actual == expected


def verify_log(messages: List[Dict[str, Any]]) -> VerificationResult:
    """Verify structural integrity of a VAL message log.

    Checks:
    - First message should be ``agent.create``
    - Sequence numbers are contiguous (1, 2, 3, ...)
    - Timestamps are monotonically non-decreasing
    - All messages have required VAL fields
    """
    result = VerificationResult(valid=True, messages_checked=len(messages))

    if not messages:
        result.warnings.append("Empty log — nothing to verify")
        return result

    # Check first message type
    first = messages[0]
    if first.get("type") != "agent.create":
        result.errors.append(
            f"First message should be 'agent.create', got '{first.get('type')}'"
        )
        result.valid = False

    prev_seq: Optional[int] = None
    prev_ts: Optional[str] = None

    for i, msg in enumerate(messages):
        # Required fields
        for field_name in ("val", "type", "ts", "agent"):
            if field_name not in msg:
                result.errors.append(f"Message {i}: missing required field '{field_name}'")
                result.valid = False

        # Sequence continuity
        seq = msg.get("_seq")
        if seq is not None and prev_seq is not None:
            if seq != prev_seq + 1:
                result.errors.append(
                    f"Sequence gap: expected {prev_seq + 1}, got {seq}"
                )
                result.valid = False
        prev_seq = seq

        # Timestamp ordering
        ts = msg.get("_consensus_ts", "")
        if prev_ts and ts and ts < prev_ts:
            result.errors.append(
                f"Timestamp regression at seq {seq}: {ts} < {prev_ts}"
            )
            result.valid = False
        prev_ts = ts

    return result
