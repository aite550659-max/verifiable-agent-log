# val-langchain

**Verifiable Agent Log (VAL)** callback handler for LangChain — immutable AI audit trails on [Hedera HCS](https://hedera.com/consensus-service).

Every tool call your agent makes gets cryptographically attested to an append-only public ledger. No trust required — anyone can verify.

## Quick Start

```python
from val_langchain import VALHandler

handler = VALHandler("0.0.YOUR_TOPIC", "0.0.YOUR_ACCOUNT", "your_private_key")
llm = ChatOpenAI(callbacks=[handler])  # That's it. Every tool call is now attested.
```

## Installation

```bash
pip install val-langchain
```

## Setup

### 1. Get a Hedera Testnet Account (Free)

1. Go to [portal.hedera.com](https://portal.hedera.com) and sign up
2. Create a testnet account — you'll get an Account ID and private key
3. Your account comes with free testnet HBAR

### 2. Environment Variables

```bash
export HEDERA_ACCOUNT_ID="0.0.12345"
export HEDERA_PRIVATE_KEY="302e020100300506..."
export HEDERA_NETWORK="testnet"         # or "mainnet"
export VAL_TOPIC_ID="0.0.67890"         # your agent's HCS topic
```

### 3. Add to Your Agent

```python
import os
from langchain_openai import ChatOpenAI
from val_langchain import VALHandler

handler = VALHandler(
    topic_id=os.environ["VAL_TOPIC_ID"],
    account_id=os.environ["HEDERA_ACCOUNT_ID"],
    private_key=os.environ["HEDERA_PRIVATE_KEY"],
    network=os.environ.get("HEDERA_NETWORK", "testnet"),
)

# Attach to any LangChain LLM or agent
llm = ChatOpenAI(model="gpt-4o-mini", callbacks=[handler])
```

## What Gets Logged

| Event | VAL Type | Data |
|-------|----------|------|
| Tool invoked | `action` | tool name, input hash, status=started |
| Tool completed | `action` | tool name, input hash, output hash, status=success |
| Tool error | `action` | tool name, input hash, status=error |
| LLM start | `heartbeat` | (optional, enable with `attest_heartbeats=True`) |
| Chain start/end | `action` | (optional, enable with `attest_chains=True`) |

## VAL Message Format

```json
{
  "val": "1.0",
  "type": "action",
  "ts": "2025-01-15T12:00:00+00:00",
  "agent": "0.0.67890",
  "data": {
    "tool": "get_weather",
    "input_hash": "sha256:abc123...",
    "output_hash": "sha256:def456...",
    "status": "success",
    "desc": "Tool get_weather completed"
  }
}
```

## Verification

Verify any agent's audit trail:

```python
from val_langchain import fetch_log, verify_log

messages = fetch_log("0.0.67890", network="testnet")
result = verify_log(messages)
print(result)  # ✅ VALID (42 messages)
```

Or from the command line:

```bash
python -m examples.verify_agent 0.0.67890 testnet
```

## API Reference

### `VALHandler(topic_id, account_id, private_key, network="testnet")`

LangChain `BaseCallbackHandler` that attests tool calls to HCS.

- `attest_chains=True` — also log chain start/end events
- `attest_heartbeats=True` — log LLM start as heartbeats

### `HCSClient(account_id, private_key, network="testnet")`

Low-level HCS client.

- `submit_attestation(topic_id, attestation_dict)` — submit to HCS
- `create_topic(name, soul_hash, capabilities)` — create agent topic
- `build_attestation(topic_id, msg_type, data)` — build without submitting

### `fetch_log(topic_id, network="mainnet")` → `List[Dict]`

Fetch all messages from mirror node.

### `verify_log(messages)` → `VerificationResult`

Check sequence continuity, timestamps, required fields.

### `verify_hash(content, attested_hash)` → `bool`

Recompute SHA-256 and compare.

## Dependencies

- `langchain-core>=0.1.0`
- `requests>=2.28.0`
- Optional: `hedera-sdk-py` (for actual HCS submission; without it, attestations are logged locally)

## Links

- [VAL Spec](https://github.com/aite550659-max/verifiable-agent-log)
- [Hedera HCS Docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service)

## License

MIT
