"""Refresh reviewed scheduling estimates from downloaded verification artifacts.

This is an explicit maintenance command. CI never downloads a previous result
or uses this snapshot to decide whether a test needs to run.
"""
import argparse
from collections import defaultdict
from datetime import date
import json
import math
from pathlib import Path
import statistics


def collect_timings(roots, sources):
    suites, nodes = defaultdict(list), defaultdict(list)

    def add(samples, name, seconds):
        if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError(f"Invalid successful timing for {name}: {seconds}")
        samples[name].append(seconds)

    reports = set()
    for root in roots:
        if not root.is_dir():
            raise ValueError(f"Report directory missing: {root}")
        reports.update(path.resolve() for path in root.rglob("results.json"))
        reports.update(path.resolve() for path in root.rglob("node-files.jsonl"))
    for path in sorted(reports):
        if path.name == "results.json":
            for row in json.loads(path.read_text(encoding="utf-8"))["suites"]:
                if row["status"] == "passed":
                    add(suites, row["suite"], row["seconds"])
        else:
            for line in path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                if row["status"] == "passed":
                    add(nodes, row["file"], row["seconds"])
    if not suites and not nodes:
        raise ValueError("No successful timing samples found")
    return {"version": 1, "recorded_on": date.today().isoformat(), "sources": sources,
            "suite_seconds": {name: max(.001, round(statistics.median(values), 3)) for name, values in sorted(suites.items())},
            "node_seconds": {name: max(.001, round(statistics.median(values), 3)) for name, values in sorted(nodes.items())}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-root", type=Path, action="append", required=True)
    parser.add_argument("--source", action="append", required=True, help="Run URL or description of the measured environment")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "tests/ci_timings.json")
    args = parser.parse_args(argv)
    snapshot = collect_timings(args.report_root, args.source)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(snapshot['suite_seconds'])} suite and {len(snapshot['node_seconds'])} Node file estimates to {args.output}")


if __name__ == "__main__":
    main()
