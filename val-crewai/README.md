# val-crewai

**VAL (Verifiable Agent Log) integration for CrewAI** — immutable audit trails for AI agent crews on Hedera HCS.

Every tool call, every task completion, cryptographically attested on a public ledger. Three lines to add.

## Quick Start

```python
from crewai import Agent, Task, Crew
from val_crewai import VALCrew

crew = Crew(agents=[...], tasks=[...])
val_crew = VALCrew(crew, topic_id="0.0.12345")
result = val_crew.kickoff()
```

That's it. Every step and task completion is now attested to Hedera HCS.

## Installation

```bash
pip install val-crewai
```

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `HEDERA_ACCOUNT_ID` | Your Hedera account (e.g. `0.0.12345`) | Yes |
| `HEDERA_PRIVATE_KEY` | ED25519 private key | Yes |
| `HEDERA_NETWORK` | `testnet` or `mainnet` (default: `testnet`) | No |

## Getting a Free Hedera Testnet Account

1. Go to [portal.hedera.com](https://portal.hedera.com)
2. Create a free testnet account
3. Copy your Account ID and Private Key
4. Set the environment variables above

## What Gets Logged

| Event | VAL Type | Data |
|---|---|---|
| Agent step (tool use) | `action` | Tool name, input/output hashes |
| Task completion | `action` | Task description, result hash |
| Heartbeat | `heartbeat` | Optional memo |

## Verification

```python
from val_crewai import fetch_log, verify_log

messages = fetch_log("0.0.12345")
is_valid, issues = verify_log(messages)
```

## Manual Callbacks

If you prefer manual control instead of the `VALCrew` wrapper:

```python
from val_crewai import VALClient, val_step_callback, val_task_callback

client = VALClient(topic_id="0.0.12345", account_id="...", private_key="...")

crew = Crew(
    agents=[...],
    tasks=[...],
    step_callback=val_step_callback(client),
    task_callback=val_task_callback(client),
)
```

## VAL Spec

[github.com/aite550659-max/verifiable-agent-log](https://github.com/aite550659-max/verifiable-agent-log)

## License

MIT
