"""Repeat the deterministic race suite; each run gets a fresh Node process."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runs', type=int, default=100)
args = parser.parse_args()
if args.runs < 1:
    parser.error('--runs must be positive')
root = Path(__file__).resolve().parents[1]
for iteration in range(args.runs):
    result = subprocess.run(['node', '--test', 'tests/shared_checks_flight.test.mjs'], cwd=root,
                            capture_output=True, encoding='utf8', timeout=30)
    if result.returncode:
        print(result.stdout, result.stderr)
        raise SystemExit(f'FAIL iteration {iteration + 1}')
print(f'PASS {args.runs} consecutive deterministic Shared Checks race runs; no sleeps')
