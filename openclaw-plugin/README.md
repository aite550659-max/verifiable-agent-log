# VAL Auto-Attestation Plugin for OpenClaw

Automatic, framework-level attestation of AI agent tool executions to [Hedera Consensus Service](https://hedera.com/consensus-service) via the [Verifiable Agent Log (VAL)](https://github.com/aite550659-max/verifiable-agent-log) protocol.

## What It Does

Every time your agent uses a tool (web search, file edit, message send, etc.), this plugin automatically:

1. Checks the attestation policy (should this tool be logged?)
2. Hashes the input/output for privacy (raw content is never published)
3. Signs the attestation with Ed25519/ECDSA
4. Submits it to an immutable HCS topic

The agent never decides whether to attest. The framework handles it. This is **SDK-level enforcement** — one of VAL's four enforcement tiers (`cooperative → audited → sdk → tee`).

## Install

```bash
openclaw plugins install -l ./openclaw-plugin
```

Or copy to `~/.openclaw/extensions/val-attestation/`.

## Configure

Add to your OpenClaw config (`openclaw config`):

```json
{
  "plugins": {
    "entries": {
      "val-attestation": {
        "enabled": true,
        "config": {
          "topicId": "0.0.XXXXX",
          "operatorId": "0.0.XXXXX",
          "operatorKeyRef": "keychain:aite-private-key",
          "policy": "standard",
          "network": "mainnet"
        }
      }
    }
  }
}
```

### Config Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `topicId` | Yes | — | HCS topic for attestations |
| `operatorId` | Yes | — | Hedera account ID |
| `operatorKey` | One of key/keyRef | — | Private key (DER hex) |
| `operatorKeyRef` | One of key/keyRef | — | Keychain reference (`keychain:<service>`) |
| `policy` | No | `standard` | `minimal` / `standard` / `strict` |
| `network` | No | `mainnet` | `mainnet` / `testnet` |
| `agentName` | No | — | Agent name in VAL log |
| `did` | No | auto | Agent DID (`did:hedera:...`) |
| `async` | No | `true` | Non-blocking attestation |

### Policy Levels

| Level | What Gets Attested |
|-------|--------------------|
| `minimal` | Financial, identity, external communications |
| `standard` | + data access, system operations |
| `strict` | Everything including internal memory lookups |

## How It Works

```
Agent calls tool → OpenClaw executes → after_tool_call hook fires
                                              ↓
                                     Policy check (attest?)
                                              ↓
                                     Sign + submit to HCS
                                              ↓
                                     Immutable audit trail
```

The plugin uses OpenClaw's `after_tool_call` lifecycle hook. Attestations are:
- **Signed** (Ed25519 with canonical JSON)
- **Hash-chained** (each attestation references the previous)
- **Privacy-preserving** (inputs/outputs are SHA-256 hashed, never raw)
- **Non-blocking** by default (fire-and-forget, configurable)

## Attestation Format

Each attestation follows [VAL v1.1](https://github.com/aite550659-max/verifiable-agent-log/blob/main/docs/VAL_SPEC_v1.1.md):

```json
{
  "val": "1.1",
  "type": "action",
  "ts": "2026-03-10T05:30:00.000Z",
  "agent": "did:hedera:mainnet:z..._0.0.10305159",
  "data": {
    "tool": "web_search",
    "status": "success",
    "desc": "web_search (1204ms)",
    "input_hash": "sha256:a1b2c3...",
    "output_hash": "sha256:d4e5f6..."
  },
  "prev": "sha256:...",
  "sig": "ed25519:base64..."
}
```

## Verification

Anyone can verify the attestation trail:

```bash
# View on HashScan
open https://hashscan.io/mainnet/topic/0.0.XXXXX

# Verify signatures with val-sdk
npm install val-sdk
```

```typescript
import { VALReader } from "val-sdk";
const reader = new VALReader({ topicId: "0.0.XXXXX" });
const attestations = await reader.readAll();
```

## Cost

Each HCS attestation costs ~$0.0001. At `standard` policy with typical agent usage:
- ~50-200 attestations/day
- ~$0.005-0.02/day
- ~$0.15-0.60/month

## License

MIT
