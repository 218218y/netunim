from __future__ import annotations

from pathlib import Path
import importlib.util
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent


def fail(message: str) -> int:
    print(f"ERROR: {message}")
    return 2


def preflight() -> int:
    if sys.version_info < (3, 10):
        return fail(f"Python 3.10+ is required; found {sys.version.split()[0]}")
    if not shutil.which("node"):
        return fail("Node.js was not found in PATH (required for JavaScript syntax checks)")
    if not (ROOT / 'node_modules/eslint/bin/eslint.js').is_file():
        return fail('Development tools are missing. Run npm ci in the repository root.')
    if importlib.util.find_spec("websocket") is None:
        return fail(
            "Python package 'websocket-client' is missing. Install it once with: "
            f"{sys.executable} -m pip install -r {TESTS / 'requirements.txt'}"
        )
    from browser_harness import find_browser
    if not find_browser():
        return fail("Chrome, Edge or Chromium was not found (required for runtime tests)")
    return 0


def main() -> int:
    rc = preflight()
    if rc:
        return rc
    suites = [
        "static_contracts.py",
        "confirmation_contracts.py",
        "asset_contracts.py",
        "deploy_preflight.py",
        "service_worker_contracts.py",
        "module_contracts.py",
        "calendar_contracts.py",
        "runtime_smoke.py",
        "runtime_calendar.py",
        "runtime_events.py",
        "runtime_security.py",
        "runtime_workflows.py",
        "runtime_pwa.py",
        "runtime_performance.py",
        "runtime_data_integrity.py",
        "runtime_sync_recovery.py",
        "runtime_financial.py",
    ]
    print("=" * 72, flush=True)
    print("NETUNIM VERIFY - full pre-deploy verification", flush=True)
    print("=" * 72, flush=True)
    for filename in suites:
        print(f"\n>>> {filename}", flush=True)
        result = subprocess.run([sys.executable, str(TESTS / filename)], cwd=ROOT)
        if result.returncode != 0:
            print(f"\nFAILED: {filename} (exit {result.returncode})", flush=True)
            return result.returncode or 1
    print("\n" + "=" * 72, flush=True)
    print("ALL VERIFICATION SUITES PASSED", flush=True)
    print("=" * 72, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
