"""VAL (Verifiable Agent Log) integration for CrewAI."""

from val_crewai.client import VALClient
from val_crewai.callbacks import val_step_callback, val_task_callback
from val_crewai.crew import VALCrew
from val_crewai.verify import fetch_log, verify_log, verify_hash

__version__ = "0.1.0"
__all__ = [
    "VALClient",
    "VALCrew",
    "val_step_callback",
    "val_task_callback",
    "fetch_log",
    "verify_log",
    "verify_hash",
]
