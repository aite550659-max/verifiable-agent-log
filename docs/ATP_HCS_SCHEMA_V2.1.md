# ATP HCS Message Schema v2.1

**Purpose:** Complete specification of all HCS message types for ATP protocol  
**Topic:** Single topic per agent (e.g., 0.0.10261370)  
**Format:** JSON, UTF-8 encoded  
**Version:** 2.1 (Hedera-Native Architecture)  
**Last Updated:** March 10, 2026  
**Changelog v2.1:**
- `agent_created` payload: added `did`, `registration_uri`, `a2a_endpoint` fields
- `rental_initiated` constraints: added `enforcement` field (cooperative|audited|sdk|tee)
- `runtime_attestation` payload: added optional `tee_attestation` nested object
- `agent_bridged` new message type for cross-chain identity linking
- `agent_id` field now accepts both HCS topic IDs and did:hedera DIDs

---

## Core Principles

1. **Single source of truth** — HCS is the canonical state log
2. **Event-sourced** — All state changes logged as events
3. **Gap-free** — HCS consensus guarantees no missing sequences
4. **Timestamped** — Consensus timestamps prove event ordering
5. **Publicly verifiable** — Anyone can replay and verify
6. **Signed** — All messages signed per VAL v1.1 §4.1 **(new in v2.1)**

---

## Message Structure

All ATP messages follow this envelope:

```json
{
  "atp_version": "2.1",
  "message_type": "rental_initiated",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": { ... },
  "sig": "ed25519:..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `atp_version` | string | Yes | ATP protocol version. `"2.1"` for this spec. |
| `message_type` | string | Yes | Event type (see below) |
| `agent_id` | string | Yes | Agent identifier. Either NFT token ID (e.g., `0.0.XXXXXX`) or DID (e.g., `did:hedera:mainnet:z..._0.0.XXXXXX`). Both formats accepted. |
| `timestamp` | ISO 8601 | Yes | Client timestamp (advisory, consensus timestamp is canonical) |
| `payload` | object | Yes | Event-specific data |
| `sig` | string | Yes | Cryptographic signature per VAL v1.1 §4.1. **New in v2.1.** |

---

## Message Types

### 1. Agent Lifecycle

#### 1.1 `agent_created`

Logged when agent NFT is minted.

```json
{
  "atp_version": "2.1",
  "message_type": "agent_created",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": {
    "creator": "0.0.111111",
    "owner": "0.0.111111",
    "name": "Aite",
    "manifest_uri": "ipfs://Qm.../manifest.json",
    "soul_hash": "sha256:abc123...",
    "hcs_topic": "0.0.10305159",
    "royalty_percentage": 5,
    "creation_date": "2026-03-10",
    "did": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
    "registration_uri": "https://example.com/.well-known/agent.json",
    "a2a_endpoint": "https://example.com/a2a"
  },
  "sig": "ed25519:..."
}
```

**New fields in v2.1:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `did` | string | no | Agent's W3C DID (did:hedera or other method). |
| `registration_uri` | string | no | URL of agent registration file (ERC-8004 format recommended). |
| `a2a_endpoint` | string | no | URL of A2A Agent Card endpoint for discovery. |

The `manifest_uri` content SHOULD conform to the ERC-8004 agent registration file format. VAL/ATP-specific fields (soul_hash, pricing, constraints) use the ERC-8004 extensions mechanism.

#### 1.2 `agent_ownership_transfer`

Logged when NFT ownership changes. Unchanged from v2.0.

```json
{
  "atp_version": "2.1",
  "message_type": "agent_ownership_transfer",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": {
    "from": "0.0.111111",
    "to": "0.0.222222",
    "sale_price_usd": 1000.00,
    "sale_price_hbar": 10000.00,
    "transaction_id": "0.0.111111@1770518724.733714736",
    "active_rentals": ["rental_abc123"]
  },
  "sig": "ed25519:..."
}
```

#### 1.3 `agent_pricing_update`

Logged when owner changes rental pricing. Unchanged from v2.0.

```json
{
  "atp_version": "2.1",
  "message_type": "agent_pricing_update",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": {
    "owner": "0.0.111111",
    "previous_pricing": {
      "flash_base_fee": 0.02,
      "standard_base_fee": 5.00,
      "per_instruction": 0.05,
      "per_minute": 0.01,
      "llm_markup_bps": 150,
      "tool_markup_bps": 150
    },
    "new_pricing": {
      "flash_base_fee": 0.01,
      "standard_base_fee": 3.00,
      "per_instruction": 0.03,
      "per_minute": 0.01,
      "llm_markup_bps": 150,
      "tool_markup_bps": 150
    },
    "effective_date": "2026-03-11T00:00:00Z"
  },
  "sig": "ed25519:..."
}
```

#### 1.4 `agent_bridged` **(New in v2.1)**

Logged when an existing agent from another chain (e.g., ERC-8004 on EVM) is onboarded to VAL/ATP.

```json
{
  "atp_version": "2.1",
  "message_type": "agent_bridged",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": {
    "source_chain": "ethereum",
    "source_identity": "0x1234...abcd",
    "source_standard": "ERC-8004",
    "source_nft_contract": "0x5678...efgh",
    "source_nft_token_id": "42",
    "hedera_did": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
    "hedera_hcs_topic": "0.0.YYYYYY",
    "hedera_nft_token_id": "0.0.ZZZZZZ",
    "bridged_by": "0.0.111111",
    "registration_uri": "https://example.com/.well-known/agent.json"
  },
  "sig": "ed25519:..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_chain` | string | yes | Origin chain (e.g., "ethereum", "base", "polygon") |
| `source_identity` | string | yes | Agent's identity on origin chain (e.g., EVM address) |
| `source_standard` | string | yes | Identity standard on origin chain (e.g., "ERC-8004") |
| `source_nft_contract` | string | no | NFT contract address on origin chain |
| `source_nft_token_id` | string | no | NFT token ID on origin chain |
| `hedera_did` | string | yes | New did:hedera DID created for the agent |
| `hedera_hcs_topic` | string | yes | New HCS topic for VAL attestation log |
| `hedera_nft_token_id` | string | no | New HTS NFT token ID (if minted) |
| `bridged_by` | string | yes | Hedera account that initiated the bridge |
| `registration_uri` | string | no | Updated registration file URL (includes both chain identities) |

### 2. Rental Lifecycle

#### 2.1 `rental_initiated`

Logged when a rental begins.

```json
{
  "atp_version": "2.1",
  "message_type": "rental_initiated",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T15:00:00.123Z",
  "payload": {
    "rental_id": "rental_abc123",
    "renter": "0.0.333333",
    "owner": "0.0.111111",
    "rental_type": "session",
    "stake_usd": 50.00,
    "stake_hbar": 500.00,
    "usage_buffer_usd": 100.00,
    "usage_buffer_hbar": 1000.00,
    "escrow_account": "0.0.888888",
    "pricing_snapshot": {
      "flash_base_fee": 0.02,
      "standard_base_fee": 5.00,
      "per_instruction": 0.05,
      "per_minute": 0.01,
      "llm_markup_bps": 150,
      "tool_markup_bps": 150
    },
    "constraints": {
      "tools_blocked": ["wallet", "exec_elevated"],
      "memory_access_level": "sandboxed",
      "topics_blocked": [],
      "max_per_instruction_cost": 10.00,
      "max_daily_cost": 50.00,
      "enforcement": "audited"
    },
    "expected_duration_minutes": 120,
    "parent_rental_id": null
  },
  "sig": "ed25519:..."
}
```

**New field in v2.1:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enforcement` | string | no | `"cooperative"` | How constraints are enforced. One of: `"cooperative"`, `"audited"`, `"sdk"`, `"tee"`. See §Enforcement Levels. |

#### Enforcement Levels

| Level | Meaning | Trust Model | Available Today |
|-------|---------|-------------|----------------|
| `cooperative` | Agent promises to comply via prompt-level instructions | Trust the agent | Yes |
| `audited` | Agent actions are locally logged with hash-chain integrity, anchored to HCS. Violations are detectable after the fact. | Trust but verify | Yes |
| `sdk` | Runtime SDK prevents violations in real-time via tool whitelists and spending caps | Trust the SDK | Future (AI Studio Policies) |
| `tee` | Hardware enclave makes violations impossible; produces hardware attestation proof | Trust the hardware | Future (EQTY Lab) |

Agents MUST honestly declare their enforcement level. Claiming `"tee"` without a valid TEE attestation (see §7.1) is detectable and constitutes a trust violation.

The `audited` level reflects the current best practice: a local Merkle tree of all actions, periodically hash-anchored to HCS. The agent could theoretically violate constraints, but the evidence would be in the immutable log. This is how most financial auditing works.

#### 2.2–2.7: Unchanged from v2.0

The following message types are unchanged from v2.0 except for the addition of the `sig` field to the envelope:

- `rental_instruction` (§2.2)
- `rental_heartbeat` (§2.3)
- `rental_downtime` (§2.4)
- `rental_completed` (§2.5)
- `rental_terminated` (§2.6)
- `rental_violation` (§2.7)

See ATP HCS Schema v2.0 for full field definitions. All v2.0 fields remain valid and required/optional as specified.

### 3. Sub-Rental

#### 3.1 `subrental_initiated`

Unchanged from v2.0 except for the addition of the `sig` field and `enforcement` inheriting from parent rental.

### 4. Disputes

#### 4.1–4.3: Unchanged from v2.0

- `dispute_filed` (§4.1)
- `dispute_assigned` (§4.2)
- `dispute_resolved` (§4.3)

### 5. Reputation Events

#### 5.1 `reputation_snapshot`

Unchanged from v2.0.

### 6. Trust & Staking

#### 6.1–6.2: Unchanged from v2.0

- `trust_tier_staked` (§6.1)
- `trust_tier_unstaked` (§6.2)

### 7. Runtime Attestation

#### 7.1 `runtime_attestation`

Logged periodically by runtime to prove compliance.

```json
{
  "atp_version": "2.1",
  "message_type": "runtime_attestation",
  "agent_id": "did:hedera:mainnet:z7ASgb..._0.0.XXXXXX",
  "timestamp": "2026-03-10T12:00:00.123Z",
  "payload": {
    "runtime_name": "openclaw",
    "runtime_version": "25.5.0",
    "atp_sdk_version": "1.0.2",
    "runtime_hash": "sha256:runtime_binary_hash...",
    "attestation_statement": "Running unmodified ATP runtime v1.0.2, memory isolation active",
    "memory_isolation": true,
    "operator": "0.0.111111",
    "operator_stake": 500.00,
    "tee_attestation": null
  },
  "sig": "ed25519:..."
}
```

**New field in v2.1:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tee_attestation` | object\|null | no | Hardware attestation proof from a Trusted Execution Environment. `null` or absent when not available. **Reserved for future use.** See below. |

**`tee_attestation` object (when present):**

```json
{
  "tee_attestation": {
    "platform": "nvidia_blackwell",
    "enclave_hash": "sha256:...",
    "attestation_proof": "base64:...",
    "verified_by": "eqty_lab",
    "verification_endpoint": "https://verify.eqtylab.io/v1/attest"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | yes | TEE platform (e.g., "intel_sgx", "intel_tdx", "amd_sev", "nvidia_blackwell") |
| `enclave_hash` | string | yes | Hash of the code running in the enclave |
| `attestation_proof` | string | yes | Base64-encoded hardware attestation proof |
| `verified_by` | string | yes | Entity that can verify the proof (e.g., "eqty_lab", "intel", "nvidia") |
| `verification_endpoint` | string | no | URL to verify the attestation proof |

**Verification:** The `attestation_proof` is generated by TEE hardware and signed by the chip manufacturer's key. It cannot be forged by the agent. Verifiers contact the `verification_endpoint` (or the manufacturer's attestation service) to confirm authenticity. A fabricated `tee_attestation` will fail verification.

**Current status:** No agent can populate `tee_attestation` today. This field is reserved for future integration with EQTY Lab and other TEE providers. When populated, it enables the `"tee"` enforcement level in rental constraints.

---

## Architecture: Four-Layer Trust Stack

ATP and VAL together provide a complete AI agent trust infrastructure, organized in four layers:

### Layer 1: Data Provenance
**What:** Immutable record of what the agent did, when, and with what data.
**How:** HCS attestation log (VAL) + content hashes (input_hash, output_hash, soul_hash).
**Hedera primitive:** HCS topics with gap-free sequencing and consensus timestamps.

### Layer 2: Access Control
**What:** Constraints on what the agent CAN do during a rental.
**How:** ATP rental constraints (tools_blocked, memory_access_level, max_daily_cost) with declared enforcement level.
**Hedera primitive:** HCS messages + future AI Studio Policies (SDK enforcement).

### Layer 3: Verified Execution
**What:** Proof that the agent ran the code it claimed to run.
**How:** Runtime attestation (self-reported hash today, hardware TEE attestation future).
**Hedera primitive:** HCS messages + future EQTY Lab TEE integration.

### Layer 4: Coordination
**What:** Ordering, settlement, and multi-party coordination.
**How:** HCS message ordering for event sequencing. HBAR escrow for financial settlement.
**Hedera primitive:** HCS consensus ordering + Scheduled Transactions + HTS.

---

## Indexer Requirements

An ATP indexer MUST:

1. **Subscribe** to the agent's HCS topic via mirror node
2. **Process** all message types above
3. **Validate** message structure against this schema
4. **Verify signatures** on all v2.1 messages **(new in v2.1)**
5. **Compute** derived state (reputation scores, active rentals, uptime)
6. **Provide** REST API for runtime queries
7. **Detect** gaps in sequence numbers (evidence of logging failure)

---

## Query API (Indexer)

Unchanged from v2.0. See ATP HCS Schema v2.0 for full endpoint definitions.

---

## Versioning

```
ATP Protocol: 2.1
HCS Schema: 2.1
VAL Dependency: v1.1 (signing required)
```

**Breaking changes** (new major version):
- Removing required fields
- Changing field types
- Renaming message types

**Non-breaking changes** (new minor version):
- Adding optional fields ✓ (enforcement, tee_attestation, did, registration_uri, a2a_endpoint)
- Adding new message types ✓ (agent_bridged)
- Making previously optional fields required ✓ (sig)

v2.1 is backwards compatible with v2.0: all v2.0 messages are valid v2.1 messages (with `sig` added). New fields are optional.

---

## Reference Implementation

See `@agent-trust-protocol/sdk` for Node.js implementation of:
- HCS message submission with signing
- Schema validation (v2.0 and v2.1)
- DID resolution and verification
- Indexer sync logic
- ERC-8004 registration file generation

---

**Document Version:** 2.1  
**Last Updated:** March 10, 2026  
**Status:** Draft

For questions, contributions, or implementations: [github.com/aite550659-max/verifiable-agent-log](https://github.com/aite550659-max/verifiable-agent-log)
