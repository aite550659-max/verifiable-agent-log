"""VALCrew — drop-in wrapper that auto-instruments a CrewAI Crew with VAL logging."""

from __future__ import annotations

import os
from typing import Any, Optional

from val_crewai.client import VALClient
from val_crewai.callbacks import val_step_callback, val_task_callback


class VALCrew:
    """Wrap an existing CrewAI ``Crew`` to automatically attest every step and task.

    Usage::

        from crewai import Agent, Task, Crew
        from val_crewai import VALCrew

        crew = Crew(agents=[...], tasks=[...])
        val_crew = VALCrew(crew, topic_id="0.0.12345")
        result = val_crew.kickoff()

    Environment variables (used as defaults when constructor args omitted):
        - ``HEDERA_ACCOUNT_ID``
        - ``HEDERA_PRIVATE_KEY``
        - ``HEDERA_NETWORK`` (default ``testnet``)
    """

    def __init__(
        self,
        crew: Any,  # crewai.Crew — Any to avoid hard import at module level
        topic_id: str,
        account_id: Optional[str] = None,
        private_key: Optional[str] = None,
        network: Optional[str] = None,
    ) -> None:
        self.crew = crew
        self.topic_id = topic_id
        self.account_id = account_id or os.environ["HEDERA_ACCOUNT_ID"]
        self.private_key = private_key or os.environ["HEDERA_PRIVATE_KEY"]
        self.network = network or os.environ.get("HEDERA_NETWORK", "testnet")

        self.client = VALClient(
            topic_id=self.topic_id,
            account_id=self.account_id,
            private_key=self.private_key,
            network=self.network,
        )

        # Inject callbacks into the crew
        self.crew.step_callback = val_step_callback(self.client)
        self.crew.task_callback = val_task_callback(self.client)

    def kickoff(self, **kwargs: Any) -> Any:
        """Start the crew run (delegates to ``Crew.kickoff``)."""
        return self.crew.kickoff(**kwargs)

    def attest_heartbeat(self, memo: str = "") -> None:
        """Manually submit a heartbeat attestation."""
        self.client.attest_heartbeat(memo)
