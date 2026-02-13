"""Minimal example: add VAL attestation to any LangChain agent in 5 lines."""

import os

from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

from val_langchain import VALHandler

# 1. Create the VAL handler
handler = VALHandler(
    topic_id=os.environ["VAL_TOPIC_ID"],          # e.g. "0.0.12345"
    account_id=os.environ["HEDERA_ACCOUNT_ID"],    # e.g. "0.0.67890"
    private_key=os.environ["HEDERA_PRIVATE_KEY"],   # Ed25519 DER hex
    network=os.environ.get("HEDERA_NETWORK", "testnet"),
)

# 2. Use it with any LangChain LLM / agent
llm = ChatOpenAI(model="gpt-4o-mini", callbacks=[handler])


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"Sunny, 72°F in {city}"


# 3. Bind tools and invoke — every tool call is attested to HCS
llm_with_tools = llm.bind_tools([get_weather])
response = llm_with_tools.invoke("What's the weather in Miami?")

print("Response:", response.content)
print("✅ All tool calls attested to Hedera HCS topic", os.environ["VAL_TOPIC_ID"])
