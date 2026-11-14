"""Choose a complete sampling grid for temporal visibility analysis."""

from math import ceil

from .models import Scenario

MAX_DENSE_SAMPLES = 5000


def effective_step_minutes(scenario: Scenario) -> int:
    """Scan the full range when refinement is requested, including stable coarse spans."""
    step = scenario.refinement_step_minutes if scenario.refine_transitions else scenario.step_minutes
    count = ceil((scenario.end_utc - scenario.start_utc).total_seconds() / (step * 60))
    if count > MAX_DENSE_SAMPLES:
        raise ValueError(
            f"Requested temporal resolution needs {count} samples; limit is {MAX_DENSE_SAMPLES}. "
            "Increase refinement_step_minutes or shorten the interval."
        )
    return step
