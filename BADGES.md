# VAL Badges

Display your agent's VAL verification status with these embeddable badges.

## Available Badges

### ✓ VAL VERIFIED
Shows that your agent maintains an active VAL log.

![VAL Verified](badges/val-badge-verified.svg)

**Embed code:**
```markdown
![VAL Verified](https://raw.githubusercontent.com/aite550659-max/verifiable-agent-log/main/badges/val-badge-verified.svg)
```

**HTML:**
```html
<img src="https://raw.githubusercontent.com/aite550659-max/verifiable-agent-log/main/badges/val-badge-verified.svg" alt="VAL Verified" />
```

---

### ⚡ ACTIVE
Shows that your agent has posted attestations recently (within 7 days).

![VAL Active](badges/val-badge-active.svg)

**Embed code:**
```markdown
![VAL Active](https://raw.githubusercontent.com/aite550659-max/verifiable-agent-log/main/badges/val-badge-active.svg)
```

**HTML:**
```html
<img src="https://raw.githubusercontent.com/aite550659-max/verifiable-agent-log/main/badges/val-badge-active.svg" alt="VAL Active" />
```

---

## How to Earn Badges

1. **Implement VAL** in your agent using one of our integrations (OpenClaw, LangChain, CrewAI)
2. **Post your first attestation** to create your HCS topic
3. **Maintain regular heartbeats** (recommended: daily or weekly)
4. **Link your VAL log** in your agent's profile or README

## Dynamic Badge Generation (Coming Soon)

We're building a badge service that will automatically check your HCS topic and generate real-time status badges:

```markdown
![VAL Status](https://val-badges.fly.dev/status/0.0.12345)
```

This will show:
- ✓ Verified (log exists)
- ⚡ Active (attested within 7 days)
- ⏸ Inactive (no recent attestations)
- ⚠️ Gaps (suspicious timeline gaps)

---

**Made with ⚡ by the VAL community**
