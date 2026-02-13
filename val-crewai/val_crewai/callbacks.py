"""CrewAI step_callback and task_callback implementations for VAL attestation."""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from val_crewai.client import VALClient


def val_step_callback(client: VALClient) -> Callable[[Any], None]:
    """Return a CrewAI step_callback that attests each agent step.

    Usage::

        crew = Crew(
            ...,
            step_callback=val_step_callback(client),
        )
    """

    def _callback(step_output: Any) -> None:
        # CrewAI step_output varies by version; normalise to strings.
        tool = "unknown"
        input_str = ""
        output_str = ""
        status = "success"
        desc = ""

        if hasattr(step_output, "tool"):
            tool = str(step_output.tool)
        elif isinstance(step_output, dict) and "tool" in step_output:
            tool = step_output["tool"]

        if hasattr(step_output, "tool_input"):
            input_str = json.dumps(step_output.tool_input, default=str)
        elif isinstance(step_output, dict) and "tool_input" in step_output:
            input_str = json.dumps(step_output["tool_input"], default=str)

        if hasattr(step_output, "result"):
            output_str = str(step_output.result)
        elif hasattr(step_output, "output"):
            output_str = str(step_output.output)
        elif isinstance(step_output, dict):
            output_str = json.dumps(step_output.get("output", step_output), default=str)
        else:
            output_str = str(step_output)

        if not desc:
            desc = f"Step: {tool}"

        client.attest_action(
            tool=tool,
            input_data=input_str,
            output_data=output_str,
            status=status,
            desc=desc,
        )

    return _callback


def val_task_callback(client: VALClient) -> Callable[[Any], None]:
    """Return a CrewAI task_callback that attests task completion.

    Usage::

        crew = Crew(
            ...,
            task_callback=val_task_callback(client),
        )
    """

    def _callback(task_output: Any) -> None:
        description = ""
        result = ""

        if hasattr(task_output, "description"):
            description = str(task_output.description)
        if hasattr(task_output, "raw"):
            result = str(task_output.raw)
        elif hasattr(task_output, "result"):
            result = str(task_output.result)
        elif isinstance(task_output, str):
            result = task_output
        else:
            result = str(task_output)

        client.attest_action(
            tool="task_completion",
            input_data=description,
            output_data=result,
            status="success",
            desc=f"Task completed: {description[:80]}" if description else "Task completed",
        )

    return _callback
