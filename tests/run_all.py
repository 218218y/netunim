from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

from verification_plan import CORE_SUITES, RUNTIME_SUITES, GROUPS, ci_matrix, validate_plan

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent
DEV_NODE_MODULES = Path(os.environ.get("NETUNIM_OFFLINE_NODE_MODULES", ROOT / "node_modules"))


def fail(message: str) -> int:
    print(f"ERROR: {message}", flush=True)
    return 2


def preflight(*, require_browser: bool, require_postgres: bool = True) -> int:
    if sys.version_info < (3, 10):
        return fail(f"Python 3.10+ is required; found {sys.version.split()[0]}")
    if not shutil.which("node"):
        return fail("Node.js was not found in PATH")
    if not (DEV_NODE_MODULES / "eslint/bin/eslint.js").is_file():
        return fail("Development tools are missing. Run npm ci in the repository root.")
    if require_postgres:
        missing = [name for name in ("postgres", "initdb", "pg_ctl", "psql") if not shutil.which(name)]
        if missing:
            return fail(f"PostgreSQL server tools required on PATH: {', '.join(missing)}")
        version = subprocess.check_output(["postgres", "--version"], text=True, timeout=10)
        major = re.search(r"PostgreSQL\) (\d+)", version)
        if not major or int(major.group(1)) < 17:
            return fail("PostgreSQL 17+ is required by the migration MAINTAIN grants; CI uses PostgreSQL 18.")
    # The disposable PostgreSQL fixture imports the browser harness too.
    if require_browser or require_postgres:
        if importlib.util.find_spec("websocket") is None:
            return fail(f"Install Python dependencies: {sys.executable} -m pip install -r tests/requirements.txt")
    if require_browser:
        from browser_harness import find_browser
        if not find_browser():
            return fail("Chrome, Edge or Chromium required. NETUNIM_BROWSER may point to an explicit browser executable.")
    return 0


def write_report(directory: Path, label: str, records: list[dict]):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "results.json").write_text(json.dumps({"group": label, "suites": records}, indent=2) + "\n", encoding="utf-8")
    suite = ET.Element("testsuite", name=label, tests=str(len(records)),
                       failures=str(sum(row["status"] == "failed" for row in records)),
                       skipped=str(sum(row["status"] == "not-run" for row in records)),
                       time=str(round(sum(row["seconds"] for row in records), 3)))
    lines = [f"### Verification: {label}", "", "| Suite | Result | Seconds |", "| --- | --- | ---: |"]
    for row in records:
        case = ET.SubElement(suite, "testcase", classname=label, name=row["suite"], time=str(row["seconds"]))
        if row["status"] == "failed":
            ET.SubElement(case, "failure", message=f"Exit {row['exit_code']}; see {row['suite']}.log")
        elif row["status"] == "not-run":
            ET.SubElement(case, "skipped", message="Earlier failure stopped this local run")
        lines.append(f"| {row['suite']} | {row['status']} | {row['seconds']:.2f} |")
    ET.ElementTree(suite).write(directory / "junit.xml", encoding="utf-8", xml_declaration=True)
    summary = "\n".join(lines) + "\n"
    (directory / "summary.md").write_text(summary, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(summary)


def run_suites(suites: list[str], *, keep_going=False, report_dir: Path | None = None, label="full", timeout=1200) -> int:
    records = [{"suite": name, "status": "not-run", "seconds": 0.0, "exit_code": None} for name in suites]
    failed = 0
    # Spool child output to disk so a timeout still leaves its complete log in CI.
    with tempfile.TemporaryDirectory(prefix="netunim-verify-") as scratch:
        directory = report_dir or Path(scratch)
        directory.mkdir(parents=True, exist_ok=True)
        for row in records:
            name = row["suite"]
            print(f"\n>>> {name}", flush=True)
            start = time.monotonic()
            path = directory / f"{name}.log"
            with path.open("w", encoding="utf-8") as log:
                try:
                    result = subprocess.run([sys.executable, "-u", str(TESTS / name)], cwd=ROOT,
                                            stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
                                            env={**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"})
                    rc = result.returncode
                except subprocess.TimeoutExpired:
                    log.write(f"\nERROR: suite exceeded {timeout}s; CI will discard this isolated runner.\n")
                    rc = 124
            with path.open(encoding="utf-8", errors="replace") as log:
                for line in log:
                    print(line, end="")
            row.update(status="passed" if rc == 0 else "failed", seconds=round(time.monotonic() - start, 3), exit_code=rc)
            print(f"{row['status'].upper()}: {name} ({row['seconds']:.2f}s)", flush=True)
            if report_dir:
                (directory / "results.json").write_text(json.dumps({"group": label, "suites": records}, indent=2) + "\n", encoding="utf-8")
            if rc:
                failed = failed or rc
                if not keep_going:
                    break
        if report_dir:
            write_report(report_dir, label, records)
    return failed


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Run the complete NETUNIM verification or one CI group.")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--core-only", action="store_true", help="repair feedback only; browser suites are skipped")
    selection.add_argument("--group", choices=GROUPS, help="one partial CI group, never a full deployment gate by itself")
    selection.add_argument("--ci-matrix", action="store_true", help="print the complete GitHub matrix without running tests")
    parser.add_argument("--keep-going", action="store_true", help="run remaining suites after failures and return failure at the end")
    parser.add_argument("--report-dir", type=Path, help="write suite logs, JSON, JUnit XML and a timing summary")
    args = parser.parse_args(argv)
    validate_plan()
    if args.ci_matrix:
        print(json.dumps(ci_matrix(), separators=(",", ":")))
        return 0
    suites = GROUPS[args.group] if args.group else CORE_SUITES + ([] if args.core_only else RUNTIME_SUITES)
    label = args.group or ("core-only" if args.core_only else "full")
    partial = bool(args.group or args.core_only)
    print(f"NETUNIM VERIFY - {label} ({len(suites)} suites)", flush=True)
    if partial:
        print("PARTIAL verification: this selection alone is not a full deployment gate.", flush=True)
    rc = preflight(require_browser=any(name in RUNTIME_SUITES for name in suites),
                   require_postgres=any(name in GROUPS["database"] + GROUPS["browser-database"] for name in suites))
    if rc:
        return rc
    rc = run_suites(suites, keep_going=args.keep_going, report_dir=args.report_dir, label=label)
    if rc:
        return rc
    print("ALL SELECTED SUITES PASSED (partial verification)" if partial else "ALL VERIFICATION SUITES PASSED", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
