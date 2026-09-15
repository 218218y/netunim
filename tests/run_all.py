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
from local_scheduler import can_start, default_jobs, schedule_order
from suite_process import SuiteProcess

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


def write_results(directory: Path, label: str, records: list[dict], elapsed: float):
    temporary = directory / "results.json.tmp"
    temporary.write_text(json.dumps({"group": label, "wall_seconds": round(elapsed, 3), "suites": records}, indent=2) + "\n", encoding="utf-8")
    temporary.replace(directory / "results.json")


def write_report(directory: Path, label: str, records: list[dict], elapsed: float = 0):
    directory.mkdir(parents=True, exist_ok=True)
    write_results(directory, label, records, elapsed)
    suite = ET.Element("testsuite", name=label, tests=str(len(records)),
                       failures=str(sum(row["status"] in ("failed", "cancelled") for row in records)),
                       skipped=str(sum(row["status"] == "not-run" for row in records)),
                       time=str(round(elapsed, 3)))
    lines = [f"### Verification: {label}", "", f"Wall time: {elapsed:.2f}s. Summed suite time: {sum(row['seconds'] for row in records):.2f}s.", "", "| Suite | Result | Seconds |", "| --- | --- | ---: |"]
    for row in records:
        case = ET.SubElement(suite, "testcase", classname=label, name=row["suite"], time=str(row["seconds"]))
        if row["status"] in ("failed", "cancelled"):
            ET.SubElement(case, "failure", message=f"Exit {row['exit_code']}; see {row['suite']}.log")
        elif row["status"] == "not-run":
            ET.SubElement(case, "skipped", message="Verification stopped before this suite started")
        lines.append(f"| {row['suite']} | {row['status']} | {row['seconds']:.2f} |")
    ET.ElementTree(suite).write(directory / "junit.xml", encoding="utf-8", xml_declaration=True)
    summary = "\n".join(lines) + "\n"
    (directory / "summary.md").write_text(summary, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(summary)


def run_suites(suites: list[str], *, keep_going=False, report_dir: Path | None = None, label="full", timeout=1200,
               jobs=1, browser_jobs=2, verbose=True) -> int:
    if jobs < 1 or browser_jobs < 1 or len(suites) != len(set(suites)):
        raise ValueError("Positive job limits and a disjoint suite list are required")
    records = [{"suite": name, "status": "not-run", "seconds": 0.0, "exit_code": None,
                "started_seconds": None, "finished_seconds": None} for name in suites]
    rows = {row["suite"]: row for row in records}
    pending = schedule_order(suites, jobs)
    active = {}
    failed = 0
    started = heartbeat = time.monotonic()
    # Only this coordinator writes reports/console output. Each child owns a log
    # and a disposable process tree, including its browsers and database servers.
    with tempfile.TemporaryDirectory(prefix="netunim-verify-") as scratch:
        directory = report_dir or Path(scratch)
        directory.mkdir(parents=True, exist_ok=True)

        def finish(name, process, rc, diagnostic="", cancelled=False):
            nonlocal failed
            path = directory / f"{name}.log"
            try:
                if process:
                    process.close()
            except Exception as error:
                diagnostic += f"\nERROR: process cleanup failed: {error}\n"
                rc = rc or 2
            if diagnostic:
                with path.open("a", encoding="utf-8") as log:
                    log.write(diagnostic)
            row = rows[name]
            row.update(status="cancelled" if cancelled else ("passed" if rc == 0 else "failed"),
                       seconds=round(time.monotonic() - (process.started if process else started + row["started_seconds"]), 3),
                       finished_seconds=round(time.monotonic() - started, 3), exit_code=rc)
            if verbose or rc:
                with path.open(encoding="utf-8", errors="replace") as log:
                    for line in log:
                        print(line, end="")
            print(f"{row['status'].upper()}: {name} ({row['seconds']:.2f}s)", flush=True)
            failed = failed or rc
            if report_dir:
                write_results(directory, label, records, time.monotonic() - started)

        try:
            while pending or active:
                # Observe completions BEFORE allocating more work: fail-fast stops
                # new launches but lets already running suites finish normally.
                for name, process in list(active.items()):
                    rc = process.poll()
                    if rc is not None:
                        finish(name, process, rc)
                        del active[name]
                    elif time.monotonic() - process.started >= timeout:
                        finish(name, process, 124, f"\nERROR: suite exceeded {timeout}s; terminating its process tree.\n")
                        del active[name]
                if not failed or keep_going:
                    launched = False
                    for name in list(pending):
                        if not can_start(name, active, jobs=jobs, browser_jobs=browser_jobs):
                            continue
                        pending.remove(name)
                        launched = True
                        rows[name].update(status="running", started_seconds=round(time.monotonic() - started, 3))
                        print(f">>> {name}", flush=True)
                        try:
                            active[name] = SuiteProcess(TESTS / name, directory / f"{name}.log", cwd=ROOT)
                        except Exception as error:
                            finish(name, None, 2, f"\nERROR: could not start suite: {error}\n")
                            if not keep_going:
                                break
                    if report_dir and launched:
                        write_results(directory, label, records, time.monotonic() - started)
                if not active:
                    break
                if time.monotonic() - heartbeat >= 15:
                    running = ", ".join(f"{name} {time.monotonic() - proc.started:.0f}s" for name, proc in active.items())
                    print(f"RUNNING [{time.monotonic() - started:.0f}s total]: {running}", flush=True)
                    heartbeat = time.monotonic()
                time.sleep(0.05)
        except KeyboardInterrupt:
            failed = 130
            print("\nVerification cancelled; stopping owned process trees.", flush=True)
        finally:
            for name, process in active.items():
                finish(name, process, 130, "\nERROR: verification interrupted.\n", cancelled=True)
            # An interrupt during Popen/assignment is cleaned by SuiteProcess's
            # constructor, before it can be registered in active.
            for row in records:
                if row["status"] == "running":
                    finish(row["suite"], None, 130, "\nERROR: launch interrupted.\n", cancelled=True)
            if report_dir:
                write_report(report_dir, label, records, time.monotonic() - started)
        print(f"Verification wall time: {time.monotonic() - started:.2f}s", flush=True)
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
    parser.add_argument("--jobs", type=int, help="local concurrent suites; default up to 4, or NETUNIM_VERIFY_JOBS; CI groups default to 1")
    parser.add_argument("--browser-jobs", type=int, default=2, choices=(1, 2), help="maximum concurrent browser suites (default 2)")
    parser.add_argument("--verbose", action="store_true", help="also print successful suite logs (always saved to disk)")
    args = parser.parse_args(argv)
    validate_plan()
    if args.ci_matrix:
        print(json.dumps(ci_matrix(), separators=(",", ":")))
        return 0
    try:
        jobs = args.jobs if args.jobs is not None else (1 if args.group else int(os.environ.get("NETUNIM_VERIFY_JOBS", default_jobs())))
    except ValueError:
        parser.error("NETUNIM_VERIFY_JOBS must be a positive integer")
    if jobs < 1:
        parser.error("--jobs / NETUNIM_VERIFY_JOBS must be a positive integer")
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
    report_dir = args.report_dir or Path(tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=_local_report_root()))
    print(f"Scheduling: {jobs} suite(s), up to {min(jobs, args.browser_jobs)} browser suite(s), one database suite; performance runs alone.", flush=True)
    print(f"Reports: {report_dir.resolve()}", flush=True)
    rc = run_suites(suites, keep_going=args.keep_going, report_dir=report_dir, label=label,
                    jobs=jobs, browser_jobs=args.browser_jobs, verbose=args.verbose or bool(args.group))
    if rc:
        return rc
    print("ALL SELECTED SUITES PASSED (partial verification)" if partial else "ALL VERIFICATION SUITES PASSED", flush=True)
    return 0


def _local_report_root() -> Path:
    directory = ROOT / ".work" / "verification"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


if __name__ == "__main__":
    raise SystemExit(main())
