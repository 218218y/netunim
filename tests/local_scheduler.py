"""Resource limits for multiple independent suites on ONE workstation."""
from __future__ import annotations

from dataclasses import dataclass
import os

from verification_plan import GROUPS, RUNTIME_SUITES

# Start the long independent workloads early; no result/timing cache is consulted.
START_FIRST = ("runtime_morning.py", "runtime_sync_postgres.py", "module_contracts.py")


@dataclass(frozen=True)
class Resources:
    browser: bool = False
    database: bool = False
    exclusive: bool = False


def resources(name: str) -> Resources:
    return Resources(browser=name in RUNTIME_SUITES,
                     database=name in GROUPS["database"] + GROUPS["browser-database"],
                     exclusive=name == "runtime_performance.py")


def default_jobs() -> int:
    cpus = getattr(os, "process_cpu_count", os.cpu_count)() or 1
    return max(1, min(4, cpus // 2))


def schedule_order(suites: list[str], jobs: int) -> list[str]:
    if jobs == 1:
        return list(suites)
    first = [name for name in START_FIRST if name in suites]
    rest = [name for name in suites if name not in first and not resources(name).exclusive]
    return first + rest + [name for name in suites if resources(name).exclusive]


def can_start(name: str, active: list[str], *, jobs: int, browser_jobs: int) -> bool:
    if len(active) >= jobs:
        return False
    requested = resources(name)
    running = [resources(item) for item in active]
    if any(item.exclusive for item in running) or (requested.exclusive and running):
        return False
    if requested.browser and sum(item.browser for item in running) >= browser_jobs:
        return False
    if requested.database and any(item.database for item in running):
        return False
    return True
