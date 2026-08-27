"""Compatibility entry point. Canonical financial runtime test now lives in /tests."""
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tests"))
runpy.run_path(str(ROOT / "tests/runtime_financial.py"), run_name="__main__")
