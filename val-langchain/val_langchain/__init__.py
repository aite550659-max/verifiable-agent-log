"""VAL (Verifiable Agent Log) — LangChain integration for immutable AI audit trails on Hedera HCS."""

from val_langchain.handler import VALHandler
from val_langchain.client import HCSClient
from val_langchain.verify import fetch_log, verify_log, verify_hash

__version__ = "0.1.0"
__all__ = ["VALHandler", "HCSClient", "fetch_log", "verify_log", "verify_hash"]
