---
title: "Verifiable Agent Log (VAL) v1.0 — Open Specification"
version: "1.0.0"
authors:
  - Gregg Bell
  - Aite
date: 2026-02-13
status: draft
license: MIT
---

# Verifiable Agent Log (VAL) v1.0

![VAL Verified](badges/val-badge-verified.svg) ![VAL Active](badges/val-badge-active.svg)

**[📛 Get Your Badge](BADGES.md)** | **[📖 Read the Spec](#1-abstract)** | **[🔧 Integrations](#integrations)** | **[💬 Community](https://discord.gg/val)** | **[🌐 Live Example](https://hashscan.io/mainnet/topic/0.0.10261370)**

---

## 1. Abstract

AI agents perform actions — transactions, API calls, file modifications — but produce no verifiable record of what they actually did. Local logs are mutable, deletable, and untrustworthy to third parties. The Verifiable Agent Log (VAL) defines a minimal, standardized attestation format for recording agent actions to immutable, append-only logs. VAL is chain-agnostic by design, with Hedera Consensus Service (HCS) as the reference implementation.

## 2. Problem Statement

AI agents are increasingly autonomous. They execute financial transactions, send emails, make API calls, modify files, and interact with other agents — often without human supervision. Yet every major agent framework (LangChain, CrewAI, AutoGen, OpenAI Assistants) stores execution logs locally. These logs can be modified, deleted, or fabricated after the fact. There is no mechanism for a third party — a user, an auditor, another agent — to independently verify what an agent did, when it did it, or whether its core identity has been tampered with.

This is the trust gap. An agent claims it sent an email at 3:00 PM. Did it? An agent claims it never accessed a restricted API. Can you prove otherwise? An agent's system prompt says it follows safety guidelines. Has that prompt changed since deployment? Without immutable, externally-verifiable records, every claim an agent makes about its own behavior requires blind trust. VAL closes this gap by defining a standard format for attestations and a verification procedure anyone can follow.

## 3. Core Concept

VAL is built on four principles:

1. **One log per agent.** Each agent gets a single append-only log (e.g., an HCS topic). The log's identifier *is* the agent's verifiable identity.
2. **Attest significant actions.** Every action worth auditing — tool calls, identity changes, state transitions — gets an immutable, timestamped entry.
3. **Public verifiability.** Anyone with the log identifier can read the full history and verify its integrity. No special access required.
4. **Reputation is history.** An agent's trustworthiness is derived entirely from its attestation log. A long, consistent, gap-free log *is* the reputation.

VAL does not define what agents *should* do. It defines how to *prove* what they did.

## 4. Attestation Format

Every attestation is a JSON envelope submitted to the agent's log:

```json
{
  "val": "1.0",
  "type": "<message_type>",
  "ts": "<ISO8601_timestamp>",
  "agent": "<log_identifier>",
  "data": {},
  "sig": "<optional_signature>"
}
```

| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `aap`   | string | yes      | Protocol version. Always `"1.0"` for this spec. |
| `type`  | string | yes      | Message type. One of: `agent.create`, `action`, `soul.verify`, `heartbeat`. |
| `ts`    | string | yes      | ISO 8601 timestamp with timezone. When the agent produced this attestation. |
| `agent` | string | yes      | The agent's log identifier (e.g., HCS topic ID `0.0.12345`). |
| `data`  | object | yes      | Type-specific payload. See §5. |
| `sig`   | string | no       | Ed25519 or ECDSA signature over the canonical JSON of the other fields. Optional in v1. |

**Encoding:** UTF-8 JSON. No whitespace requirements. Canonical form for signing: keys sorted alphabetically, no trailing commas, no whitespace.

**Size limit:** Determined by the underlying log. HCS allows 1024 bytes per message. Attestations MUST fit within the target log's message size limit.

## 5. Message Types

VAL v1 defines exactly four message types.

### 5.1 `agent.create`

Submitted once, as the first message in a new agent's log. Establishes identity.

```json
{
  "val": "1.0",
  "type": "agent.create",
  "ts": "2026-02-13T14:00:00Z",
  "agent": "0.0.6284099",
  "data": {
    "name": "Aite",
    "soul_hash": "sha256:a3f2c8...",
    "capabilities": ["web_search", "email", "file_ops"],
    "creator": "0.0.10268595",
    "framework": "openclaw/1.0"
  }
}
```

| Field          | Type     | Required | Description |
|----------------|----------|----------|-------------|
| `name`         | string   | yes      | Human-readable agent name. |
| `soul_hash`    | string   | yes      | SHA-256 hash of the agent's core identity file(s), prefixed with algorithm. |
| `capabilities` | string[] | yes      | Declared capabilities (tool names or categories). |
| `creator`      | string   | no       | Identifier of the entity that created the agent. |
| `framework`    | string   | no       | Agent framework and version. |

### 5.2 `action`

Submitted whenever the agent performs a significant action.

```json
{
  "val": "1.0",
  "type": "action",
  "ts": "2026-02-13T14:05:00Z",
  "agent": "0.0.6284099",
  "data": {
    "tool": "web_search",
    "input_hash": "sha256:b7d1e4...",
    "output_hash": "sha256:9c3f0a...",
    "context_hash": "sha256:e1a2b3...",
    "status": "success",
    "desc": "Searched for HBAR price data"
  }
}
```

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `tool`         | string | yes      | Tool or action identifier. |
| `input_hash`   | string | no       | Hash of the input parameters. Allows verification without exposing content. |
| `output_hash`  | string | no       | Hash of the output/result. |
| `context_hash` | string | no       | Hash of the conversation or task context at time of action. |
| `status`       | string | yes      | `success`, `failure`, or `error`. |
| `desc`         | string | no       | Brief human-readable description. Keep under 100 chars. |

**What to hash:** The hash is over the JSON-serialized content. This lets a party who has the original content verify the attestation without the content being public.

### 5.3 `soul.verify`

Periodic integrity check of the agent's core identity files (system prompt, SOUL.md, configuration).

```json
{
  "val": "1.0",
  "type": "soul.verify",
  "ts": "2026-02-13T14:10:00Z",
  "agent": "0.0.6284099",
  "data": {
    "soul_hash": "sha256:a3f2c8...",
    "files": {
      "SOUL.md": "sha256:a3f2c8...",
      "AGENTS.md": "sha256:d4e5f6..."
    },
    "match": true
  }
}
```

| Field       | Type    | Required | Description |
|-------------|---------|----------|-------------|
| `soul_hash` | string  | yes      | Current composite hash of all identity files. |
| `files`     | object  | no       | Individual file hashes for granular verification. |
| `match`     | boolean | yes      | Whether current hash matches the last attested hash. `false` = identity changed. |

When `match` is `false`, the agent SHOULD submit a follow-up attestation explaining the change (an `action` with `tool: "soul.update"` and a description of what changed and why).

### 5.4 `heartbeat`

Liveness signal. Proves the agent is operational at a given time.

```json
{
  "val": "1.0",
  "type": "heartbeat",
  "ts": "2026-02-13T14:15:00Z",
  "agent": "0.0.6284099",
  "data": {
    "status": "active",
    "uptime_s": 86400,
    "seq": 1042
  }
}
```

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `status`   | string | yes      | `active`, `idle`, `degraded`, or `shutdown`. |
| `uptime_s` | number | no       | Seconds since last restart. |
| `seq`      | number | no       | Monotonically increasing heartbeat counter. Gaps indicate downtime. |

**Recommended frequency:** Every 30–60 minutes when active. Adjust based on cost tolerance.

## 6. Verification

Any party can verify an agent's attestation log in three steps:

### Step 1: Fetch the log

Retrieve all messages from the agent's log using the log identifier. On HCS, this means querying a mirror node for all messages on the topic.

### Step 2: Verify sequence continuity

- The first message MUST be `agent.create`.
- Messages MUST have monotonically increasing consensus timestamps.
- On HCS, sequence numbers are gap-free by protocol guarantee. A gap in sequence numbers indicates message deletion (not possible on HCS) or data corruption.
- Large time gaps between heartbeats indicate potential downtime or attestation failures.

### Step 3: Verify hashes

For any attested action:
1. Obtain the original content (input, output, or soul files) from the agent operator.
2. Compute the SHA-256 hash of the content.
3. Compare against the hash in the attestation.
4. Match = content is authentic. Mismatch = content has been altered.

| Verification Check         | Pass Condition                          | Failure Implication                  |
|----------------------------|-----------------------------------------|--------------------------------------|
| First message is `agent.create` | Type = `agent.create`, seq = 1     | Log may be incomplete or tampered    |
| Sequence continuity        | No gaps in sequence numbers             | Messages may be missing              |
| Timestamp ordering         | Each `ts` ≥ previous `ts`              | Clock manipulation or replay attack  |
| Soul hash consistency      | `soul.verify` hashes match over time    | Identity files were modified         |
| Content hash match         | Recomputed hash = attested hash         | Content was altered after attestation |

## 7. Reference Implementation

### 7.1 JavaScript (Node.js)

Requires: `npm install @hashgraph/sdk`

```javascript
import { Client, TopicCreateTransaction, TopicMessageSubmitTransaction, TopicMessageQuery } from "@hashgraph/sdk";
import crypto from "crypto";

const client = Client.forTestnet().setOperator(
  process.env.HEDERA_ACCOUNT_ID,
  process.env.HEDERA_PRIVATE_KEY
);

// Create an agent log (topic)
async function createAgentLog(name, soulHash, capabilities) {
  const tx = await new TopicCreateTransaction().setSubmitKey(client.operatorPublicKey).execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId.toString();

  const attestation = JSON.stringify({
    aap: "1.0", type: "agent.create", ts: new Date().toISOString(),
    agent: topicId,
    data: { name, soul_hash: soulHash, capabilities, framework: "aap-ref/1.0" }
  });

  await new TopicMessageSubmitTransaction({ topicId, message: attestation }).execute(client);
  console.log(`Agent log created: ${topicId}`);
  return topicId;
}

// Submit an action attestation
async function attestAction(topicId, tool, inputData, outputData, desc) {
  const attestation = JSON.stringify({
    aap: "1.0", type: "action", ts: new Date().toISOString(),
    agent: topicId,
    data: {
      tool, status: "success", desc,
      input_hash: "sha256:" + crypto.createHash("sha256").update(JSON.stringify(inputData)).digest("hex"),
      output_hash: "sha256:" + crypto.createHash("sha256").update(JSON.stringify(outputData)).digest("hex"),
    }
  });

  await new TopicMessageSubmitTransaction({ topicId, message: attestation }).execute(client);
  console.log(`Action attested: ${tool}`);
}

// Read and verify the log
async function verifyLog(topicId) {
  const messages = [];
  await new Promise((resolve) => {
    new TopicMessageQuery().setTopicId(topicId).setStartTime(0).subscribe(client, (msg) => {
      const parsed = JSON.parse(Buffer.from(msg.contents).toString());
      messages.push({ seq: msg.sequenceNumber.toNumber(), ...parsed });
    });
    setTimeout(resolve, 5000); // wait for mirror node
  });

  messages.sort((a, b) => a.seq - b.seq);
  if (messages[0]?.type !== "agent.create") console.error("FAIL: first message is not agent.create");
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].seq !== messages[i - 1].seq + 1) console.error(`FAIL: gap at seq ${messages[i].seq}`);
  }
  console.log(`Verified ${messages.length} attestations. Log OK.`);
  return messages;
}

// Demo
const topicId = await createAgentLog("TestAgent", "sha256:abc123", ["web_search"]);
await attestAction(topicId, "web_search", { q: "HBAR price" }, { price: 0.38 }, "Price lookup");
await new Promise(r => setTimeout(r, 6000));
await verifyLog(topicId);
```

### 7.2 Python (REST API)

Requires: `pip install requests`

```python
import requests, json, hashlib, os
from datetime import datetime, timezone

ACCOUNT_ID = os.environ["HEDERA_ACCOUNT_ID"]
API_KEY = os.environ["HEDERA_API_KEY"]  # from a relay service, or use SDK directly
MIRROR = "https://testnet.mirrornode.hedera.com"

def sha256(data: dict) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def submit_message(topic_id: str, message: dict):
    """Submit via Hedera SDK or relay. Simplified here with direct mirror read."""
    # In production, use hedera-sdk-py or a relay service to submit.
    # This example focuses on the attestation format and verification.
    print(f"Submit to {topic_id}: {json.dumps(message)}")

def create_agent_log(name: str, soul_hash: str, capabilities: list) -> str:
    topic_id = "0.0.EXAMPLE"  # In production: TopicCreateTransaction via SDK
    attestation = {
        "val": "1.0", "type": "agent.create",
        "ts": datetime.now(timezone.utc).isoformat(),
        "agent": topic_id,
        "data": {"name": name, "soul_hash": soul_hash, "capabilities": capabilities}
    }
    submit_message(topic_id, attestation)
    return topic_id

def attest_action(topic_id: str, tool: str, input_data: dict, output_data: dict, desc: str):
    attestation = {
        "val": "1.0", "type": "action",
        "ts": datetime.now(timezone.utc).isoformat(),
        "agent": topic_id,
        "data": {
            "tool": tool, "status": "success", "desc": desc,
            "input_hash": sha256(input_data), "output_hash": sha256(output_data),
        }
    }
    submit_message(topic_id, attestation)

def verify_log(topic_id: str) -> list:
    url = f"{MIRROR}/api/v1/topics/{topic_id}/messages"
    resp = requests.get(url)
    messages = []
    for msg in resp.json().get("messages", []):
        import base64
        content = json.loads(base64.b64decode(msg["message"]).decode())
        messages.append({"seq": msg["sequence_number"], **content})

    messages.sort(key=lambda m: m["seq"])
    assert messages[0]["type"] == "agent.create", "First message must be agent.create"
    for i in range(1, len(messages)):
        assert messages[i]["seq"] == messages[i-1]["seq"] + 1, f"Gap at seq {messages[i]['seq']}"
    print(f"Verified {len(messages)} attestations. Log OK.")
    return messages

# Demo
topic = create_agent_log("TestAgent", "sha256:abc123", ["web_search"])
attest_action(topic, "web_search", {"q": "HBAR price"}, {"price": 0.38}, "Price lookup")
# verify_log(topic)  # uncomment after messages reach mirror node
```

## 8. Economics

VAL is designed to be cheap enough that cost is never a reason to skip attestation.

| Scenario | Actions/Day | HCS Cost/Msg | Daily Cost | Annual Cost |
|----------|-------------|--------------|------------|-------------|
| Light agent | 100 | $0.0008 | $0.08 | $29.20 |
| Active agent | 1,000 | $0.0008 | $0.80 | $292.00 |
| Heavy agent | 10,000 | $0.0008 | $8.00 | $2,920.00 |

**Comparison with alternatives:**

| Platform | Cost per entry | Finality | Immutability | Public |
|----------|---------------|----------|--------------|--------|
| **Hedera HCS** | $0.0008 | ~3s | Yes (aBFT) | Yes |
| **Ethereum event log** | $0.50–$5.00 | ~12s | Yes (PoS) | Yes |
| **Solana** | $0.001–$0.01 | ~0.4s | Yes (PoH+PoS) | Yes |
| **Arweave** | $0.005–$0.05 | ~2min | Yes (permanent) | Yes |
| **PostgreSQL** | ~$0 | instant | No | No |
| **S3 + CloudTrail** | ~$0.001 | seconds | Partial | No |

HCS provides the best ratio of cost to trust guarantees for high-frequency attestation.

## 9. Chain Compatibility

The VAL attestation format (§4–§5) is **chain-agnostic**. Any system that provides append-only, publicly-readable storage can serve as the underlying log. The JSON envelope is the spec; the transport is an implementation choice.

Hedera HCS is the reference implementation for specific reasons:

- **Gap-free sequencing.** HCS assigns monotonically increasing sequence numbers with no gaps, by protocol. This makes sequence verification trivial.
- **Sub-3-second finality.** Attestations are final within seconds, not minutes.
- **$0.0008 per message.** Affordable at high frequency.
- **aBFT consensus.** Asynchronous Byzantine Fault Tolerant — strongest consensus guarantee available.

**Alternative implementations** are explicitly supported:

| Platform | Feasibility | Notes |
|----------|-------------|-------|
| Ethereum (calldata/events) | High cost, proven immutability | Best for low-frequency, high-value attestations |
| Solana (program logs) | Low cost, fast | Less established for audit trails |
| Arweave | Permanent storage | Good for archival, slower finality |
| IPFS + blockchain anchor | Cheap storage, anchored trust | Two-layer verification required |
| Git repository | Free, versioned | Not Byzantine-fault-tolerant; relies on host integrity |

To implement VAL on a different chain, satisfy these requirements:
1. Append-only (no message deletion or mutation)
2. Publicly readable without special credentials
3. Deterministic ordering (sequence numbers or equivalent)
4. Timestamped by consensus (not self-reported)

## 10. What's NOT in v1

VAL v1 solves exactly one problem: **"Can I verify what this agent did?"**

The following are explicitly deferred to future versions:

| Feature | Why deferred |
|---------|-------------|
| Agent rentals / leasing | Requires commerce layer (ATP v2) |
| Escrow and payments | Requires token integration |
| NFT-based ownership | Requires token service integration |
| Dispute resolution | Requires multi-party protocol |
| Reputation scoring | Requires community consensus on scoring model |
| Agent-to-agent trust negotiation | Requires discovery and handshake protocol |
| Encrypted attestations | Adds complexity; v1 prioritizes simplicity |
| Multi-sig attestations | Useful but not essential for core verification |

Each of these builds *on top of* the attestation layer. VAL v1 is the foundation. Get the audit trail right first, then build trust, commerce, and governance on top.

---

**Specification ends.**

For questions, contributions, or implementations: [github.com/agenttrust/aap-spec](https://github.com/agenttrust/aap-spec) *(pending)*
