"""Verify an agent's VAL attestation log from Hedera HCS."""

import sys

from val_langchain import fetch_log, verify_log

def main() -> None:
    topic_id = sys.argv[1] if len(sys.argv) > 1 else "0.0.12345"
    network = sys.argv[2] if len(sys.argv) > 2 else "testnet"

    print(f"Fetching VAL log for {topic_id} on {network}...")
    messages = fetch_log(topic_id, network=network)
    print(f"Found {len(messages)} messages\n")

    result = verify_log(messages)
    print(result)

    if messages:
        print(f"\nAgent ID: {messages[0].get('agent', 'unknown')}")
        print(f"Created:  {messages[0].get('ts', 'unknown')}")
        types = {}
        for m in messages:
            t = m.get("type", "unknown")
            types[t] = types.get(t, 0) + 1
        print("Message types:", dict(types))

if __name__ == "__main__":
    main()
