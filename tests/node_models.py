"""Discover every deterministic JavaScript test, including newly added files."""
from pathlib import Path
import argparse
import os
import subprocess

from ci_timing import balanced_partition, timing_weights

ROOT = Path(__file__).resolve().parents[1]
SHARD_SUITES = ("node_models_1.py", "node_models_2.py")


def test_files(*, shard=None):
    files = sorted((ROOT / "tests").glob("*.test.mjs"))
    if not files:
        raise RuntimeError("No JavaScript model tests discovered")
    names = [path.relative_to(ROOT).as_posix() for path in files]
    if shard is None:
        return names
    if type(shard) is not int or shard not in (1, 2):
        raise ValueError("Node model shard must be 1 or 2")
    return balanced_partition(names, 2, timing_weights("node_seconds"))[shard - 1]


def run_files(files, report_dir):
    if not files:
        raise ValueError("Refusing to pass an empty Node test selection")
    report_dir.mkdir(parents=True, exist_ok=True)
    return subprocess.call([
        "node", "--test", "--test-concurrency=2", "--test-timeout=180000",
        "--test-reporter=spec", "--test-reporter-destination=stdout",
        f"--test-reporter={(ROOT / 'tests/node_timing_reporter.mjs').as_uri()}",
        f"--test-reporter-destination={report_dir.resolve() / 'node-files.jsonl'}", *files,
    ], cwd=ROOT)


def main(argv=None, *, shard=None):
    parser = argparse.ArgumentParser(description="Run all JavaScript models or one disjoint file partition.")
    parser.add_argument("--report-dir", type=Path)
    args = parser.parse_args(argv)
    files = test_files(shard=shard)
    label = f"shard {shard}/2" if shard else "all"
    print(f"Running {label}: {len(files)} JavaScript test files (2 isolated workers)", flush=True)
    report_dir = args.report_dir or Path(os.environ.get("NETUNIM_SUITE_REPORT_DIR",
                            ROOT / '.work/node-models' / (f'shard-{shard}' if shard else 'full')))
    return run_files(files, report_dir)


if __name__ == "__main__":
    raise SystemExit(main())
