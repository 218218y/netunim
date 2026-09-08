"""Run the Edge handler tests against a deterministic Morning/ledger transport."""
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
raise SystemExit(subprocess.call(['node',str(ROOT/'tests/morning_edge.test.mjs')],cwd=ROOT))
