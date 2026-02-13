"""Hedera HCS client for submitting VAL attestations."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

MIRROR_URLS = {
    "mainnet": "https://mainnet.mirrornode.hedera.com",
    "testnet": "https://testnet.mirrornode.hedera.com",
}

# Hedera REST API (consensus service) endpoints
HEDERA_API_URLS = {
    "mainnet": "https://mainnet.hedera.com",
    "testnet": "https://testnet.hedera.com",
}


def _sha256(data: str) -> str:
    """Return prefixed SHA-256 hex digest of a string."""
    return "sha256:" + hashlib.sha256(data.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class HCSClient:
    """Minimal Hedera Consensus Service client using the REST/mirror API.

    For production use, consider using the official Hedera SDK.
    This client uses the mirror node for reads and attempts SDK submission
    for writes (falling back to logging if SDK unavailable).
    """

    def __init__(
        self,
        account_id: str,
        private_key: str,
        network: str = "testnet",
    ) -> None:
        self.account_id = account_id
        self.private_key = private_key
        self.network = network
        self.mirror_url = MIRROR_URLS.get(network, MIRROR_URLS["testnet"])
        self._sdk_available: Optional[bool] = None

    # ------------------------------------------------------------------
    # SDK helpers
    # ------------------------------------------------------------------

    def _check_sdk(self) -> bool:
        if self._sdk_available is None:
            try:
                import hedera  # type: ignore[import-untyped]
                self._sdk_available = True
            except ImportError:
                self._sdk_available = False
                logger.info(
                    "hedera-sdk-py not installed — HCS writes will be logged locally only. "
                    "Install with: pip install hedera-sdk-py"
                )
        return self._sdk_available

    def _submit_via_sdk(self, topic_id: str, message: str) -> Optional[str]:
        """Submit a message to HCS via the official Python SDK."""
        try:
            from hedera import (  # type: ignore[import-untyped]
                Client,
                AccountId,
                PrivateKey,
                TopicId,
                TopicMessageSubmitTransaction,
            )

            if self.network == "mainnet":
                client = Client.forMainnet()
            else:
                client = Client.forTestnet()

            acct = AccountId.fromString(self.account_id)
            key = PrivateKey.fromString(self.private_key)
            client.setOperator(acct, key)

            tx = (
                TopicMessageSubmitTransaction()
                .setTopicId(TopicId.fromString(topic_id))
                .setMessage(message)
            )
            receipt = tx.execute(client).getReceipt(client)
            seq = str(receipt.topicSequenceNumber)
            logger.info("HCS message submitted: topic=%s seq=%s", topic_id, seq)
            return seq
        except Exception as exc:
            logger.error("SDK submission failed: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def submit_attestation(self, topic_id: str, attestation: Dict[str, Any]) -> Optional[str]:
        """Submit a VAL attestation dict to HCS.

        Returns the sequence number on success, or None.
        """
        message = json.dumps(attestation, separators=(",", ":"), sort_keys=True)

        if self._check_sdk():
            return self._submit_via_sdk(topic_id, message)

        # Fallback: log locally so nothing is silently lost
        logger.warning(
            "HCS SDK unavailable — attestation logged locally only:\n%s", message
        )
        return None

    def create_topic(
        self,
        name: str,
        soul_hash: str,
        capabilities: List[str],
    ) -> Optional[str]:
        """Create a new HCS topic and publish an agent.create attestation.

        Returns the new topic ID string (e.g. '0.0.12345') or None.
        """
        if not self._check_sdk():
            logger.error("Cannot create topic without hedera-sdk-py")
            return None

        try:
            from hedera import (  # type: ignore[import-untyped]
                Client,
                AccountId,
                PrivateKey,
                TopicCreateTransaction,
            )

            if self.network == "mainnet":
                client = Client.forMainnet()
            else:
                client = Client.forTestnet()

            acct = AccountId.fromString(self.account_id)
            key = PrivateKey.fromString(self.private_key)
            client.setOperator(acct, key)

            tx = TopicCreateTransaction().setTopicMemo(f"VAL:{name}")
            receipt = tx.execute(client).getReceipt(client)
            topic_id = str(receipt.topicId)

            # Publish agent.create as the first message
            attestation = {
                "val": "1.0",
                "type": "agent.create",
                "ts": _now_iso(),
                "agent": topic_id,
                "data": {
                    "name": name,
                    "soul_hash": soul_hash,
                    "capabilities": capabilities,
                },
            }
            self.submit_attestation(topic_id, attestation)
            logger.info("Created VAL agent topic: %s", topic_id)
            return topic_id

        except Exception as exc:
            logger.error("Topic creation failed: %s", exc)
            return None

    def build_attestation(
        self,
        topic_id: str,
        msg_type: str,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Build a well-formed VAL attestation dict (does NOT submit)."""
        return {
            "val": "1.0",
            "type": msg_type,
            "ts": _now_iso(),
            "agent": topic_id,
            "data": data,
        }
