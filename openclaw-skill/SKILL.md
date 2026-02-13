# VAL — Verifiable Agent Log

**name:** val  
**description:** Log verifiable attestations to Hedera HCS. Prove what your agent did with immutable, publicly auditable records.

## Overview

VAL gives any OpenClaw agent an immutable audit trail on Hedera Consensus Service. Every significant action gets a timestamped, publicly verifiable attestation. Anyone can read the log and verify what the agent did.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEDERA_ACCOUNT_ID` | yes | Your Hedera account (e.g., `0.0.12345`) |
| `HEDERA_PRIVATE_KEY` | yes | Ed25519 or ECDSA private key for the account |
| `HEDERA_NETWORK` | no | `testnet` (default) or `mainnet` |

## Dependencies

Requires `@hashgraph/sdk`. Install if missing:
```bash
cd /Users/aite/.openclaw/workspace && npm install @hashgraph/sdk
```

## Commands

### 1. Initialize a VAL Topic

Creates a new HCS topic and submits the `agent.create` attestation. Run once per agent.

```bash
node skills/val/scripts/val-init.js --name "AgentName" --network testnet
```

Options:
- `--name` (required) — Agent name
- `--network` — `testnet` or `mainnet` (default: testnet)
- `--capabilities` — Comma-separated list (default: auto-detected)
- `--framework` — Framework identifier (default: `openclaw/1.0`)

Saves config to `~/.val/config.json`.

### 2. Attest an Action

Log a tool call or significant action:

```bash
node skills/val/scripts/val-attest.js --tool "web_search" --desc "Searched for HBAR price" --status success
```

Options:
- `--tool` (required) — Tool or action name
- `--desc` (required) — Brief description
- `--status` — `success`, `failure`, or `error` (default: success)
- `--input` — JSON string of input (auto-hashed, not stored)
- `--output` — JSON string of output (auto-hashed, not stored)
- `--network` — Override network

### 3. Verify an Agent's Log

Read and verify any agent's attestation history:

```bash
node skills/val/scripts/val-verify.js --topic 0.0.12345 --network testnet
```

Options:
- `--topic` (required) — HCS topic ID
- `--network` — `testnet` or `mainnet` (default: testnet)

Checks: first message is `agent.create`, sequence continuity, timestamp ordering.

### 4. Soul Verification

Hash identity files and attest their integrity:

```bash
node skills/val/scripts/val-soul.js
```

Hashes SOUL.md, AGENTS.md, IDENTITY.md (whichever exist), compares to last attested `soul_hash`, and submits a `soul.verify` attestation.

## Attestation Format

See `references/VAL_SPEC_v1.md` for the full specification.

```json
{
  "val": "1.0",
  "type": "action",
  "ts": "2026-02-13T14:05:00Z",
  "agent": "0.0.topicId",
  "data": {
    "tool": "web_search",
    "input_hash": "sha256:...",
    "output_hash": "sha256:...",
    "status": "success",
    "desc": "Brief description"
  }
}
```

Types: `agent.create`, `action`, `soul.verify`, `heartbeat`

## When to Attest

- **Always:** Tool calls with side effects (emails, transactions, file writes)
- **Recommended:** External API calls, web searches, significant decisions
- **Optional:** Read-only operations, internal reasoning steps
- **Automatic:** Soul verification (run periodically via heartbeat)
