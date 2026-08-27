"""Compatibility entry point. Canonical validation now lives in /tests."""
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[4]
runpy.run_path(str(ROOT / "tests/static_contracts.py"), run_name="__main__")
