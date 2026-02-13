"""Minimal CrewAI crew with VAL attestation.

Set environment variables before running:
    export HEDERA_ACCOUNT_ID=0.0.xxxxx
    export HEDERA_PRIVATE_KEY=302e...
    export HEDERA_NETWORK=testnet
"""

from crewai import Agent, Task, Crew

from val_crewai import VALCrew

# 1. Define your crew as usual
researcher = Agent(
    role="Researcher",
    goal="Find interesting facts about AI",
    backstory="You are a curious AI researcher.",
    verbose=True,
)

task = Task(
    description="List 3 interesting facts about large language models.",
    expected_output="A numbered list of 3 facts.",
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[task], verbose=True)

# 2. Wrap with VAL — that's it!
val_crew = VALCrew(crew, topic_id="0.0.12345")

# 3. Run
result = val_crew.kickoff()
print(result)
