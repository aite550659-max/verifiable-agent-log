# @valprotocol/sdk

Immutable audit trails for AI agents. One line to make any agent action verifiable.

```typescript
import { VAL } from "@valprotocol/sdk";

const val = new VAL({
  operatorId: "0.0.12345",
  operatorKey: "302e...",
});
await val.init();

// That's it. Every call writes to Hedera Consensus Service.
await val.attest({ tool: "send_email", desc: "Sent quarterly report" });
await val.attest({ tool: "swap", desc: "Swapped 100 HBAR → USDC", status: "success" });
```

## Why

AI agents act autonomously — transferring tokens, sending emails, calling APIs. But their logs are local, mutable, and unverifiable. VAL writes agent actions to an immutable, publicly-verifiable ledger (Hedera Consensus Service) so anyone can audit what an agent actually did.

- **One log per agent** — an HCS topic IS the agent's verifiable identity
- **Hash-chained** — each attestation references the previous, tamper-evident
- **Public verification** — anyone can read the log, no special access needed
- **< $0.001 per attestation** — HCS consensus fees

## Install

```bash
npm install @valprotocol/sdk
```

## Quick Start

### Write attestations

```typescript
import { VAL } from "@valprotocol/sdk";

const val = new VAL({
  operatorId: process.env.HEDERA_OPERATOR_ID!,
  operatorKey: process.env.HEDERA_OPERATOR_KEY!,
  network: "testnet", // or "mainnet"
  agentName: "my-trading-bot",
});

// Creates HCS topic + posts agent.create message
const topicId = await val.init({
  name: "my-trading-bot",
  soul_hash: "sha256:abc123...",
  capabilities: ["swap", "transfer", "price_check"],
  framework: "langchain/0.3",
});

console.log(`Agent log: https://hashscan.io/testnet/topic/${topicId}`);

// Attest actions
await val.attest({ tool: "swap", desc: "Swapped 50 HBAR for USDC" });
await val.attest({
  tool: "transfer",
  desc: "Sent 10 USDC to 0.0.98765",
  input: { to: "0.0.98765", amount: 10, token: "USDC" }, // hashed, not stored
  status: "success",
});

// Periodic integrity check
await val.verifySoul({
  soul_hash: "sha256:abc123...",
  changed: false,
});

// Heartbeat
await val.heartbeat({ uptime_h: 24, actions_since_last: 15 });

val.close();
```

### Read & verify (no keys needed)

```typescript
import { VALReader } from "@valprotocol/sdk";

const reader = new VALReader("0.0.12345", "testnet");

// Fetch full log
const log = await reader.fetch();
console.log(`${log.length} attestations`);

// Verify hash chain integrity
const { valid, brokenAt, reason } = reader.verifyChain(log);
console.log(valid ? "Chain intact" : `Broken at ${brokenAt}: ${reason}`);

// Quick summary
const summary = await reader.summary();
console.log(summary);
// { topicId: "0.0.12345", totalMessages: 47, agentName: "my-bot", chainValid: true, ... }
```

## Use with any framework

VAL is framework-agnostic. The SDK is a standalone npm package. Wrap it in whatever your agent uses:

```typescript
// LangChain tool callback
async function onToolEnd(tool: string, output: string) {
  await val.attest({ tool, desc: output.slice(0, 80), output });
}

// Coinbase AgentKit action provider
class VALActionProvider {
  async attestAction(tool: string, desc: string) {
    return val.attest({ tool, desc });
  }
}

// ElizaOS plugin
const valPlugin = {
  name: "val-attestation",
  actions: [{ name: "attest", handler: (params) => val.attest(params) }],
};
```

## Attestation format

Every message follows the [VAL v1 spec](https://github.com/valprotocol/val-sdk/blob/main/SPEC.md):

```json
{
  "val": "1.0",
  "type": "action",
  "ts": "2026-03-01T16:47:00Z",
  "agent": "0.0.12345",
  "data": {
    "tool": "swap",
    "status": "success",
    "desc": "Swapped 50 HBAR for USDC",
    "input_hash": "sha256:a3f2c8..."
  },
  "prev": "sha256:9b1d4e..."
}
```

## Costs

| Operation | Hedera Fee |
|-----------|-----------|
| Create topic (one-time) | ~$0.01 |
| Submit attestation | ~$0.0001 |
| Read from mirror node | Free |

## License

MIT
