"""Discover every deterministic JavaScript test, including newly added files."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_files():
    files = sorted((ROOT / "tests").glob("*.test.mjs"))
    if not files:
        raise RuntimeError("No JavaScript model tests discovered")
    return [path.relative_to(ROOT).as_posix() for path in files]


if __name__ == "__main__":
    files = test_files()
    print(f"Running all {len(files)} JavaScript test files (2 isolated workers)", flush=True)
    raise SystemExit(subprocess.call([
        "node", "--test", "--test-concurrency=2", "--test-timeout=180000", *files,
    ], cwd=ROOT))
