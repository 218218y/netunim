from __future__ import annotations

import argparse
from pathlib import Path
import importlib.util
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent
DEV_NODE_MODULES = Path(os.environ.get("NETUNIM_OFFLINE_NODE_MODULES", ROOT / "node_modules"))

CORE_SUITES = [
    "static_contracts.py",
    "offline_dependencies_contracts.py",
    "confirmation_contracts.py",
    "asset_contracts.py",
    "deploy_preflight.py",
    "service_worker_contracts.py",
    "module_contracts.py",
    "calendar_contracts.py",
    "bank_bridge_contracts.py",
]

RUNTIME_SUITES = [
    "runtime_smoke.py",
    "runtime_responsive.py",
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


def fail(message: str) -> int:
    print(f"ERROR: {message}")
    return 2


def preflight(*, require_browser: bool) -> int:
    if sys.version_info < (3, 10):
        return fail(f"Python 3.10+ is required; found {sys.version.split()[0]}")
    if not shutil.which("node"):
        return fail("Node.js was not found in PATH (required for JavaScript syntax checks)")
    if not (DEV_NODE_MODULES / "eslint/bin/eslint.js").is_file():
        return fail("Development tools are missing. Run npm ci in the repository root.")
    if not require_browser:
        return 0
    if importlib.util.find_spec("websocket") is None:
        return fail(
            "Python package 'websocket-client' is missing. Install it once with: "
            f"{sys.executable} -m pip install -r {TESTS / 'requirements.txt'}"
        )
    from browser_harness import find_browser

    if not find_browser():
        return fail(
            "Chrome, Edge or Chromium was not found (required for runtime tests). "
            "NETUNIM_BROWSER may point to an explicit test-browser executable."
        )
    return 0


def run_suites(suites: list[str]) -> int:
    for filename in suites:
        print(f"\n>>> {filename}", flush=True)
        result = subprocess.run([sys.executable, str(TESTS / filename)], cwd=ROOT)
        if result.returncode != 0:
            print(f"\nFAILED: {filename} (exit {result.returncode})", flush=True)
            return result.returncode or 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the NETUNIM verification suites.")
    parser.add_argument(
        "--core-only",
        action="store_true",
        help="run deterministic non-browser suites only; never use this as the production deployment gate",
    )
    args = parser.parse_args(argv)

    rc = preflight(require_browser=not args.core_only)
    if rc:
        return rc

    print("=" * 72, flush=True)
    if args.core_only:
        print("NETUNIM VERIFY - core verification (browser runtime suites skipped)", flush=True)
    else:
        print("NETUNIM VERIFY - full pre-deploy verification", flush=True)
    print("=" * 72, flush=True)

    rc = run_suites(CORE_SUITES)
    if rc:
        return rc
    if not args.core_only:
        rc = run_suites(RUNTIME_SUITES)
        if rc:
            return rc

    print("\n" + "=" * 72, flush=True)
    if args.core_only:
        print("ALL CORE VERIFICATION SUITES PASSED", flush=True)
        print("Browser runtime suites were NOT executed; this is not a deployment-grade full verification.", flush=True)
    else:
        print("ALL VERIFICATION SUITES PASSED", flush=True)
    print("=" * 72, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
