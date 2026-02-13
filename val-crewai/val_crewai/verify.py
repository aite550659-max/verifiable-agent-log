"""Verification utilities for VAL attestation logs on Hedera HCS."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

import requests

from val_crewai.client import MIRROR_URLS


def fetch_log(
    topic_id: str,
    network: str = "testnet",
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Fetch all messages from an HCS topic via the mirror node REST API."""
    mirror = MIRROR_URLS.get(network, MIRROR_URLS["testnet"])
    url = f"{mirror}/api/v1/topics/{topic_id}/messages"
    messages: List[Dict[str, Any]] = []
    params: Dict[str, Any] = {"limit": limit}

    while url:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for msg in data.get("messages", []):
            raw = msg.get("message", "")
            try:
                decoded = base64.b64decode(raw).decode("utf-8")
                parsed = json.loads(decoded)
            except Exception:
                parsed = {"_raw": raw}
            messages.append({
                "sequence_number": msg.get("sequence_number"),
                "consensus_timestamp": msg.get("consensus_timestamp"),
                "parsed": parsed,
            })

        # Pagination
        next_link = data.get("links", {}).get("next")
        if next_link:
            url = f"{mirror}{next_link}"
            params = {}
        else:
            url = None  # type: ignore[assignment]

    return messages


def verify_hash(content: str, attested_hash: str) -> bool:
    """Verify that content matches an attested sha256 hash."""
    expected = "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()
    return expected == attested_hash


def verify_log(messages: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """Verify structural integrity of a VAL attestation log.

    Checks:
    1. First message should be ``agent.create``
    2. Sequence numbers are monotonically increasing
    3. Timestamps are non-decreasing
    4. All messages have required VAL fields

    Returns:
        (is_valid, list_of_issues)
    """
    issues: List[str] = []

    if not messages:
        return False, ["Log is empty"]

    # Check first message
    first = messages[0].get("parsed", {})
    if first.get("type") != "agent.create":
        issues.append(f"First message type is '{first.get('type')}', expected 'agent.create'")

    prev_seq: Optional[int] = None
    prev_ts: Optional[str] = None

    for i, msg in enumerate(messages):
        parsed = msg.get("parsed", {})

        # Required fields
        for field in ("val", "type", "ts"):
            if field not in parsed and "_raw" not in parsed:
                issues.append(f"Message {i}: missing field '{field}'")

        # Sequence check
        seq = msg.get("sequence_number")
        if seq is not None and prev_seq is not None:
            if seq <= prev_seq:
                issues.append(f"Message {i}: sequence {seq} <= previous {prev_seq}")
        prev_seq = seq

        # Timestamp check
        ts = msg.get("consensus_timestamp")
        if ts is not None and prev_ts is not None:
            if ts < prev_ts:
                issues.append(f"Message {i}: timestamp {ts} < previous {prev_ts}")
        prev_ts = ts

    return len(issues) == 0, issues
