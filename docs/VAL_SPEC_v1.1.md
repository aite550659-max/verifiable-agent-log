---
title: "Verifiable Agent Log (VAL) v1.1 — Open Specification"
version: "1.1.0"
authors:
  - Gregg Bell
  - Aite
date: 2026-03-10
status: draft
license: MIT
changelog:
  - version: "1.1.0"
    date: 2026-03-10
    changes:
      - "sig field now REQUIRED (was optional in v1.0)"
      - "agent field supports did:hedera DID format alongside topic IDs"
      - "agent.create gains optional fields: did, registration_uri, a2a_endpoint"
      - "New signing specification (§4.1) with canonical JSON and algorithm requirements"
---

# Verifiable Agent Log (VAL) v1.1

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
  "val": "1.1",
  "type": "<message_type>",
  "ts": "<ISO8601_timestamp>",
  "agent": "<agent_identifier>",
  "data": {},
  "sig": "<signature>"
}
```

| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `val`   | string | yes      | Protocol version. `"1.1"` for this spec. |
| `type`  | string | yes      | Message type. One of: `agent.create`, `action`, `soul.verify`, `heartbeat`. |
| `ts`    | string | yes      | ISO 8601 timestamp with timezone. When the agent produced this attestation. |
| `agent` | string | yes      | The agent's identifier. Either a log identifier (e.g., HCS topic ID `0.0.12345`) or a DID (e.g., `did:hedera:mainnet:z7ASgb..._0.0.12345`). See §4.2. |
| `data`  | object | yes      | Type-specific payload. See §5. |
| `sig`   | string | **yes**  | Cryptographic signature over the canonical JSON of all other fields. See §4.1. **Required in v1.1** (was optional in v1.0). |

**Encoding:** UTF-8 JSON. No whitespace requirements. Canonical form for signing: keys sorted alphabetically, no trailing commas, no whitespace.

**Size limit:** Determined by the underlying log. HCS allows 1024 bytes per message. Attestations MUST fit within the target log's message size limit.

### 4.1 Signing Specification

The `sig` field is **required** in VAL v1.1. Every attestation MUST be signed by the agent's private key.

**Signing procedure:**

1. Construct the attestation JSON with all fields EXCEPT `sig`.
2. Serialize to canonical JSON: keys sorted alphabetically at all levels, no whitespace, no trailing commas.
3. Compute the signature over the canonical JSON bytes (UTF-8 encoded).
4. Encode the signature as: `<algorithm>:<base64_signature>`

**Supported algorithms:**

| Algorithm | Identifier | Key Type | Notes |
|-----------|-----------|----------|-------|
| Ed25519 | `ed25519` | Ed25519 | Recommended. Used by Hedera natively. |
| ECDSA secp256k1 | `ecdsa-secp256k1` | secp256k1 | EVM-compatible. |

**Example signed attestation:**

```json
{
  "val": "1.1",
  "type": "action",
  "ts": "2026-03-10T14:00:00Z",
  "agent": "did:hedera:mainnet:z7ASgbT..._0.0.10305159",
  "data": {
    "tool": "web_search",
    "status": "success",
    "desc": "search",
    "input_hash": "sha256:b7d1e4...",
    "output_hash": "sha256:9c3f0a..."
  },
  "sig": "ed25519:SGVsbG8gV29ybGQ..."
}
```

**Verification procedure:**

1. Extract the `sig` field and remove it from the JSON.
2. Serialize remaining fields to canonical JSON.
3. Resolve the agent's public key (from DID Document, or from the Hedera account's public key).
4. Verify the signature against the canonical JSON bytes.

**Key anchoring:** The signing key SHOULD be the same key referenced in the agent's DID Document (§4.2) or the Hedera account's public key associated with the HCS topic. This unifies on-chain attestation signing with off-chain identity verification.

### 4.2 Agent Identifier

The `agent` field supports two formats:

| Format | Example | When to use |
|--------|---------|-------------|
| **Log ID** (v1.0 compatible) | `0.0.10305159` | Simple deployments, backwards compatibility |
| **DID** (v1.1) | `did:hedera:mainnet:z7ASgb..._0.0.10305159` | Full identity interop, cross-chain, external discovery |

Both formats are valid. Implementations MUST accept both. The DID format is RECOMMENDED for new deployments.

**DID Resolution:** A `did:hedera` DID resolves to a DID Document containing:

```json
{
  "id": "did:hedera:mainnet:z7ASgbT..._0.0.10305159",
  "verificationMethod": [{
    "id": "#key-1",
    "type": "Ed25519VerificationKey2020",
    "publicKeyMultibase": "z7ASgbT..."
  }],
  "service": [
    {
      "id": "#val-log",
      "type": "VerifiableAgentLog",
      "serviceEndpoint": "hedera:mainnet:0.0.10305159"
    },
    {
      "id": "#registration",
      "type": "AgentRegistration",
      "serviceEndpoint": "https://example.com/.well-known/agent.json"
    },
    {
      "id": "#a2a",
      "type": "AgentToAgent",
      "serviceEndpoint": "https://example.com/a2a"
    }
  ],
  "hederaAccountId": "0.0.10255397",
  "hcsTopicId": "0.0.10305159",
  "nftTokenId": "0.0.XXXXX"
}
```

The DID Document serves as the single point of resolution for all agent identifiers: DID, Hedera account ID, HCS topic ID, and NFT token ID. External systems use the DID; Hedera-native systems can shortcut to the raw IDs.

## 5. Message Types

VAL v1.1 defines exactly four message types.

### 5.1 `agent.create`

Submitted once, as the first message in a new agent's log. Establishes identity.

```json
{
  "val": "1.1",
  "type": "agent.create",
  "ts": "2026-03-10T14:00:00Z",
  "agent": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
  "data": {
    "name": "Aite",
    "soul_hash": "sha256:a3f2c8...",
    "capabilities": ["web_search", "email", "file_ops"],
    "creator": "0.0.10268595",
    "framework": "openclaw/1.0",
    "did": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
    "registration_uri": "https://example.com/.well-known/agent.json",
    "a2a_endpoint": "https://example.com/a2a"
  },
  "sig": "ed25519:..."
}
```

| Field              | Type     | Required | Description |
|--------------------|----------|----------|-------------|
| `name`             | string   | yes      | Human-readable agent name. |
| `soul_hash`        | string   | yes      | SHA-256 hash of the agent's core identity file(s), prefixed with algorithm. |
| `capabilities`     | string[] | yes      | Declared capabilities (tool names or categories). |
| `creator`          | string   | no       | Identifier of the entity that created the agent. |
| `framework`        | string   | no       | Agent framework and version. |
| `did`              | string   | no       | Agent's W3C DID (did:hedera or other method). **New in v1.1.** |
| `registration_uri` | string   | no       | URL of agent registration file (ERC-8004 format recommended). **New in v1.1.** |
| `a2a_endpoint`     | string   | no       | URL of A2A Agent Card endpoint. **New in v1.1.** |

### 5.2 `action`

Submitted whenever the agent performs a significant action.

```json
{
  "val": "1.1",
  "type": "action",
  "ts": "2026-03-10T14:05:00Z",
  "agent": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
  "data": {
    "tool": "web_search",
    "input_hash": "sha256:b7d1e4...",
    "output_hash": "sha256:9c3f0a...",
    "context_hash": "sha256:e1a2b3...",
    "status": "success",
    "desc": "search"
  },
  "sig": "ed25519:..."
}
```

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `tool`         | string | yes      | Tool or action identifier. |
| `input_hash`   | string | no       | Hash of the input parameters. Allows verification without exposing content. |
| `output_hash`  | string | no       | Hash of the output/result. |
| `context_hash` | string | no       | Hash of the conversation or task context at time of action. |
| `status`       | string | yes      | `success`, `failure`, or `error`. |
| `desc`         | string | no       | The action, in a word or short phrase. E.g. "transaction", "email", "deployment", "search". This is a label, not a sentence. All detail lives in hashes. |

**What to hash:** The hash is over the JSON-serialized content. This lets a party who has the original content verify the attestation without the content being public.

### 5.3 `soul.verify`

Periodic integrity check of the agent's core identity files (system prompt, SOUL.md, configuration).

```json
{
  "val": "1.1",
  "type": "soul.verify",
  "ts": "2026-03-10T14:10:00Z",
  "agent": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
  "data": {
    "soul_hash": "sha256:a3f2c8...",
    "files": {
      "SOUL.md": "sha256:a3f2c8...",
      "AGENTS.md": "sha256:d4e5f6..."
    },
    "match": true
  },
  "sig": "ed25519:..."
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
  "val": "1.1",
  "type": "heartbeat",
  "ts": "2026-03-10T14:15:00Z",
  "agent": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
  "data": {
    "status": "active",
    "uptime_s": 86400,
    "seq": 1042
  },
  "sig": "ed25519:..."
}
```

| Field      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `status`   | string | yes      | `active`, `idle`, `degraded`, or `shutdown`. |
| `uptime_s` | number | no       | Seconds since last restart. |
| `seq`      | number | no       | Monotonically increasing heartbeat counter. Gaps indicate downtime. |

**Recommended frequency:** Every 30–60 minutes when active. Adjust based on cost tolerance.

## 6. Verification

Any party can verify an agent's attestation log in four steps:

### Step 1: Fetch the log

Retrieve all messages from the agent's log using the log identifier. On HCS, this means querying a mirror node for all messages on the topic. If the agent uses a DID, resolve the DID Document to obtain the HCS topic ID.

### Step 2: Verify sequence continuity

- The first message MUST be `agent.create`.
- Messages MUST have monotonically increasing consensus timestamps.
- On HCS, sequence numbers are gap-free by protocol guarantee. A gap in sequence numbers indicates message deletion (not possible on HCS) or data corruption.
- Large time gaps between heartbeats indicate potential downtime or attestation failures.

### Step 3: Verify signatures

**New in v1.1.** For each attestation:
1. Extract and remove the `sig` field.
2. Serialize remaining fields to canonical JSON.
3. Resolve the agent's public key (from DID Document or Hedera account).
4. Verify the signature.
5. All attestations in a v1.1 log MUST have valid signatures. An unsigned attestation in a v1.1 log is a verification failure.

### Step 4: Verify hashes

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
| **Signature validity**     | All `sig` fields verify against agent's public key | **Attestation forged or key compromised** |
| Soul hash consistency      | `soul.verify` hashes match over time    | Identity files were modified         |
| Content hash match         | Recomputed hash = attested hash         | Content was altered after attestation |

## 7. Reference Implementation

### 7.1 JavaScript (Node.js)

Requires: `npm install @hashgraph/sdk`

```javascript
import { Client, TopicCreateTransaction, TopicMessageSubmitTransaction, TopicMessageQuery, PrivateKey } from "@hashgraph/sdk";
import crypto from "crypto";

const operatorKey = PrivateKey.fromStringED25519(process.env.HEDERA_PRIVATE_KEY);
const client = Client.forTestnet().setOperator(
  process.env.HEDERA_ACCOUNT_ID,
  operatorKey
);

// Canonical JSON serialization (keys sorted, no whitespace)
function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// Deep canonical: recursively sorts keys at all levels
function deepCanonicalize(obj) {
  if (Array.isArray(obj)) return obj.map(deepCanonicalize);
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = deepCanonicalize(obj[key]);
    }
    return sorted;
  }
  return obj;
}

// Sign an attestation
function signAttestation(attestation, privateKey) {
  const canonical = JSON.stringify(deepCanonicalize(attestation));
  const signature = privateKey.sign(Buffer.from(canonical, 'utf8'));
  return `ed25519:${Buffer.from(signature).toString('base64')}`;
}

// Create an agent log (topic)
async function createAgentLog(name, soulHash, capabilities, did) {
  const tx = await new TopicCreateTransaction().setSubmitKey(client.operatorPublicKey).execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId.toString();

  const attestation = {
    val: "1.1", type: "agent.create", ts: new Date().toISOString(),
    agent: did || topicId,
    data: { name, soul_hash: soulHash, capabilities, framework: "val-ref/1.1", did, registration_uri: null, a2a_endpoint: null }
  };
  attestation.sig = signAttestation(attestation, operatorKey);

  await new TopicMessageSubmitTransaction({ topicId, message: JSON.stringify(attestation) }).execute(client);
  console.log(`Agent log created: ${topicId}`);
  return topicId;
}

// Submit a signed action attestation
async function attestAction(topicId, agentId, tool, inputData, outputData, desc) {
  const attestation = {
    val: "1.1", type: "action", ts: new Date().toISOString(),
    agent: agentId,
    data: {
      tool, status: "success", desc,
      input_hash: "sha256:" + crypto.createHash("sha256").update(JSON.stringify(inputData)).digest("hex"),
      output_hash: "sha256:" + crypto.createHash("sha256").update(JSON.stringify(outputData)).digest("hex"),
    }
  };
  attestation.sig = signAttestation(attestation, operatorKey);

  await new TopicMessageSubmitTransaction({ topicId, message: JSON.stringify(attestation) }).execute(client);
  console.log(`Action attested: ${tool}`);
}

// Verify: fetch log and check signatures
async function verifyLog(topicId, publicKey) {
  const messages = [];
  await new Promise((resolve) => {
    new TopicMessageQuery().setTopicId(topicId).setStartTime(0).subscribe(client, (msg) => {
      const parsed = JSON.parse(Buffer.from(msg.contents).toString());
      messages.push({ seq: msg.sequenceNumber.toNumber(), ...parsed });
    });
    setTimeout(resolve, 5000);
  });

  messages.sort((a, b) => a.seq - b.seq);
  if (messages[0]?.type !== "agent.create") console.error("FAIL: first message is not agent.create");

  for (const msg of messages) {
    // Verify signature
    const sig = msg.sig;
    if (!sig) { console.error(`FAIL: missing signature at seq ${msg.seq}`); continue; }
    const [algo, sigBytes] = sig.split(':');
    const { sig: _, seq: __, ...attestation } = msg;
    const canonical = JSON.stringify(deepCanonicalize(attestation));
    const valid = publicKey.verify(Buffer.from(canonical, 'utf8'), Buffer.from(sigBytes, 'base64'));
    if (!valid) console.error(`FAIL: invalid signature at seq ${msg.seq}`);
  }

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].seq !== messages[i - 1].seq + 1) console.error(`FAIL: gap at seq ${messages[i].seq}`);
  }
  console.log(`Verified ${messages.length} attestations (signatures + sequence). Log OK.`);
  return messages;
}
```

### 7.2 Python (REST API)

Requires: `pip install requests pynacl`

```python
import requests, json, hashlib, os, base64
from datetime import datetime, timezone
from nacl.signing import SigningKey, VerifyKey

ACCOUNT_ID = os.environ["HEDERA_ACCOUNT_ID"]
MIRROR = "https://testnet.mirrornode.hedera.com"

def sha256(data: dict) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def deep_canonicalize(obj):
    if isinstance(obj, dict):
        return {k: deep_canonicalize(v) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [deep_canonicalize(v) for v in obj]
    return obj

def sign_attestation(attestation: dict, signing_key: SigningKey) -> str:
    canonical = json.dumps(deep_canonicalize(attestation), separators=(',', ':'))
    signed = signing_key.sign(canonical.encode())
    return "ed25519:" + base64.b64encode(signed.signature).decode()

def verify_signature(attestation: dict, sig: str, verify_key: VerifyKey) -> bool:
    algo, sig_b64 = sig.split(':', 1)
    att_copy = {k: v for k, v in attestation.items() if k != 'sig'}
    canonical = json.dumps(deep_canonicalize(att_copy), separators=(',', ':'))
    try:
        verify_key.verify(canonical.encode(), base64.b64decode(sig_b64))
        return True
    except Exception:
        return False

def verify_log(topic_id: str, verify_key: VerifyKey) -> list:
    url = f"{MIRROR}/api/v1/topics/{topic_id}/messages"
    resp = requests.get(url)
    messages = []
    for msg in resp.json().get("messages", []):
        content = json.loads(base64.b64decode(msg["message"]).decode())
        messages.append({"seq": msg["sequence_number"], **content})

    messages.sort(key=lambda m: m["seq"])
    assert messages[0]["type"] == "agent.create", "First message must be agent.create"
    for m in messages:
        assert verify_signature(m, m["sig"], verify_key), f"Bad signature at seq {m['seq']}"
    for i in range(1, len(messages)):
        assert messages[i]["seq"] == messages[i-1]["seq"] + 1, f"Gap at seq {messages[i]['seq']}"
    print(f"Verified {len(messages)} attestations (signatures + sequence). Log OK.")
    return messages
```

## 8. Economics

VAL is designed to be cheap enough that cost is never a reason to skip attestation.

| Scenario | Actions/Day | HCS Cost/Msg | Daily Cost | Annual Cost |
|----------|-------------|--------------|------------|-------------|
| Light agent | 100 | $0.0001 | $0.01 | $3.65 |
| Active agent | 1,000 | $0.0001 | $0.10 | $36.50 |
| Heavy agent | 10,000 | $0.0001 | $1.00 | $365.00 |

**Note:** HCS transaction fee is $0.0001 per message (network fee). The $0.0008 figure cited in some documentation includes node fees and may vary.

**Comparison with alternatives:**

| Platform | Cost per entry | Finality | Immutability | Public |
|----------|---------------|----------|--------------|--------|
| **Hedera HCS** | $0.0001 | ~3s | Yes (aBFT) | Yes |
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
- **$0.0001 per message.** Affordable at high frequency.
- **aBFT consensus.** Asynchronous Byzantine Fault Tolerant — strongest consensus guarantee available.
- **Native DID support.** The `did:hedera` method is production-ready with SDK support.

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
5. **Signature verification** against a resolvable public key (new in v1.1)

## 10. Privacy

Every agent has private context. A personal assistant reads emails, accesses calendars, handles sensitive data. A financial agent processes transactions on behalf of clients. VAL does not require agents to expose this context publicly. Instead, VAL uses **redacted attestation** as the standard approach to privacy.

### 10.1 Principle: Attest the Shape, Not the Content

Every action is attested. But the `desc` field and content details are controlled by a **privacy level** determined by the action's category:

| Privacy Level | What's Visible | When to Use |
|--------------|----------------|-------------|
| `public` | Full desc, amounts, addresses, details | Financial actions, identity changes, infrastructure |
| `redacted` | Tool name, category, hashes, status. No desc, no content. | Communications, data reads/writes, personal actions |
| `hashed_only` | Only hashes + status. No tool name or category. | Reserved for highly sensitive actions |

### 10.2 Default Privacy by Category

| Category | Default Privacy | Rationale |
|----------|----------------|-----------|
| `value_transfer` | `public` | Financial transparency is the point |
| `value_approve` | `public` | Approvals affect third parties |
| `identity_change` | `public` | Identity changes should be visible |
| `external_comms` | `redacted` | Who you talk to and what you say is private |
| `data_write` | `redacted` | File contents, DB mutations — private |
| `data_read` | `redacted` | What you read reveals intent — private |
| `internal` | `redacted` | Thinking and planning — private |
| `unknown` | `redacted` | When in doubt, redact |

### 10.3 Selective Disclosure

Hashes prove everything without revealing anything. For any redacted attestation, the original content can be selectively disclosed to a verifier:

1. Agent (or owner) provides the original input/output content
2. Verifier hashes the content and compares to `input_hash` / `output_hash` in the attestation
3. Match confirms the attestation is truthful

This enables **privacy by default, transparency on demand.** An auditor can verify specific actions without requiring the full log to be public. A regulator can request disclosure of financial actions. A user can verify their agent's claims. All without exposing the agent's full activity to the world.

### 10.4 Gap-Free Integrity

Redacted attestations preserve the gap-free property. Every action is logged — the log has no holes. A verifier can see that the agent performed 50 actions today: 10 public financial transactions and 40 redacted operations. The *existence* of activity is transparent; the *content* of private activity is not.

An agent that skips attestation for private actions breaks the trust model. An agent that redacts private actions preserves it.

### 10.5 Example

```json
{
  "val": "1.1", "type": "action", "ts": "2026-03-10T21:30:00Z",
  "agent": "did:hedera:mainnet:z7ASgb..._0.0.10305159",
  "data": {
    "tool": "email",
    "input_hash": "sha256:b7d1e4a8...",
    "output_hash": "sha256:9c3f0a12...",
    "status": "success",
    "privacy": "redacted"
  },
  "sig": "ed25519:..."
}
```

The log shows: this agent performed an email action at 21:30 and it succeeded. That's it. The hashes let anyone with the original content verify it later. The signature proves the agent itself produced this attestation. Privacy by default, transparency on demand.

## 11. Interoperability

### 11.1 W3C DIDs

VAL agents using `did:hedera` identifiers are resolvable by any W3C DID-compatible system. The DID Document (§4.2) provides verification methods, service endpoints, and Hedera-specific identifiers.

### 11.2 ERC-8004 Registration

The `registration_uri` field in `agent.create` (§5.1) SHOULD point to an agent registration file conforming to the ERC-8004 schema. This makes VAL agents discoverable by ERC-8004 directories and tooling. VAL/ATP-specific fields (soul_hash, hcs_topic, pricing, constraints) use the ERC-8004 extensions mechanism.

### 11.3 A2A Agent Cards

The `a2a_endpoint` field in `agent.create` (§5.1) SHOULD point to an A2A (Agent-to-Agent Protocol) Agent Card endpoint. This enables discovery by A2A-compatible systems including Google's agent ecosystem.

### 11.4 Backwards Compatibility

VAL v1.1 is backwards compatible with v1.0:
- The `agent` field accepts both topic IDs (v1.0) and DIDs (v1.1)
- New fields in `agent.create` (`did`, `registration_uri`, `a2a_endpoint`) are optional
- The only breaking change: `sig` is now required. A v1.0 log without signatures is valid v1.0 but not valid v1.1.

Implementations SHOULD support reading both v1.0 and v1.1 attestations. When verifying a mixed log (upgrade scenario), unsigned attestations before the version upgrade are acceptable; unsigned attestations after are not.

## 12. What's NOT in v1.1

VAL v1.1 solves exactly one problem: **"Can I verify what this agent did?"**

The following are explicitly deferred to future versions:

| Feature | Why deferred |
|---------|-------------|
| Agent rentals / leasing | Requires commerce layer (ATP v2) |
| Escrow and payments | Requires token integration |
| NFT-based ownership | Requires token service integration |
| Dispute resolution | Requires multi-party protocol |
| Reputation scoring | Requires community consensus on scoring model |
| Agent-to-agent trust negotiation | Requires discovery and handshake protocol |
| Encrypted attestations | Adds complexity; v1.1 prioritizes signing |
| Multi-sig attestations | Useful but not essential for core verification |
| RFC 9421 HTTP message signing | Future capability for HTTP-level authentication |
| Web Bot Auth integration | Future capability for external service authentication |

Each of these builds *on top of* the attestation layer. VAL v1.1 is the foundation. Get the signed audit trail right first, then build trust, commerce, and governance on top.

---

**Specification ends.**

For questions, contributions, or implementations: [github.com/aite550659-max/verifiable-agent-log](https://github.com/aite550659-max/verifiable-agent-log)
