"""Verify a crew's VAL attestation log."""

from val_crewai import fetch_log, verify_log

TOPIC_ID = "0.0.12345"  # Replace with your topic
NETWORK = "testnet"

# Fetch the full log from Hedera mirror node
messages = fetch_log(TOPIC_ID, network=NETWORK)
print(f"Fetched {len(messages)} messages from {TOPIC_ID}\n")

# Verify integrity
is_valid, issues = verify_log(messages)

if is_valid:
    print("✅ Log is valid — all checks passed.")
else:
    print("❌ Log verification failed:")
    for issue in issues:
        print(f"  • {issue}")

# Print log summary
print("\n--- Log Summary ---")
for msg in messages:
    p = msg["parsed"]
    print(f"  [{msg['sequence_number']}] {p.get('type', '?')} — {p.get('ts', '?')}")
