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


def balanced_partition(items, count, weights, *, initial_loads=None):
    """Longest processing time first, with stable names as the tie breaker."""
    if type(count) is not int or not 1 <= count <= len(items) or len(items) != len(set(items)):
        raise ValueError("A disjoint inventory and a valid partition count are required")
    costs = estimates(items, weights)
    loads = list(initial_loads) if initial_loads is not None else [0.0] * count
    if len(loads) != count or any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in loads):
        raise ValueError("Partition overhead must be finite, nonnegative and match the partition count")
    groups = [[] for _ in range(count)]
    ordered = sorted(items, key=lambda name: (-costs[name], name))
    for position, name in enumerate(ordered):
        empty = [index for index, group in enumerate(groups) if not group]
        candidates = empty if len(ordered) - position == len(empty) else range(count)
        index = min(candidates, key=lambda index: (loads[index], index))
        groups[index].append(name)
        loads[index] += costs[name]
    return groups
