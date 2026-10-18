"""Deterministic scheduling estimates, never cached test results or exclusions."""
import json
import math
from pathlib import Path
import statistics

SNAPSHOT = Path(__file__).with_name("ci_timings.json")


def timing_weights(kind, path=SNAPSHOT):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1:
        raise ValueError("Unsupported CI timing snapshot version")
    weights = data[kind]
    if not isinstance(weights, dict) or any(
        not isinstance(name, str) or type(seconds) not in (int, float)
        or not math.isfinite(seconds) or seconds <= 0
        for name, seconds in weights.items()
    ):
        raise ValueError(f"Invalid CI timing estimates: {kind}")
    return weights


def estimates(items, weights):
    """New tests get the median known cost; discovery never depends on timings."""
    known = [weights[name] for name in items if name in weights]
    fallback = statistics.median(known) if known else 1.0
    return {name: weights.get(name, fallback) for name in items}


def balanced_partition(items, count, weights):
    """Longest processing time first, with stable names as the tie breaker."""
    if type(count) is not int or not 1 <= count <= len(items) or len(items) != len(set(items)):
        raise ValueError("A disjoint inventory and a valid partition count are required")
    costs = estimates(items, weights)
    groups, loads = [[] for _ in range(count)], [0.0] * count
    for name in sorted(items, key=lambda name: (-costs[name], name)):
        index = min(range(count), key=lambda index: (loads[index], index))
        groups[index].append(name)
        loads[index] += costs[name]
    return groups
