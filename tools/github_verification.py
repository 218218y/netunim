"""Read-only fast-deploy gate: require full push CI for the exact clean checkout.

Authentication is owned by `gh auth login`; tokens never enter batch arguments,
logs, or files. An unavailable API, pending run, or failed rerun blocks deployment.
"""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from verification_plan import GROUPS

WORKFLOW = "verify.yml"
GATE_JOB = "Verification complete"
PUBLIC_ROOTS = ("netunim-orders/site", "netunim-kupa/site")


def command(*args, root=ROOT):
    try:
        result = subprocess.run(args, cwd=root, capture_output=True, encoding="utf-8", errors="replace", timeout=60)
    except FileNotFoundError as error:
        raise RuntimeError(f"{args[0]} is required on PATH. For GitHub CLI, install gh and run gh auth login.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} timed out; verification could not be confirmed.") from error
    if result.returncode:
        # gh errors can contain network/proxy details. Keep credentials out of logs.
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode}). Check connectivity and gh auth status.")
    return result.stdout.strip()


def api(endpoint):
    return json.loads(command("gh", "api", "--hostname", "github.com", endpoint))


def repository_slug(remote):
    match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?", remote)
    if not match:
        raise RuntimeError("origin must be a GitHub.com repository URL without embedded credentials.")
    return match.group(1)


def clean_head(root=ROOT):
    if command("git", "status", "--porcelain=v1", "--untracked-files=all", root=root):
        raise RuntimeError("Uncommitted/untracked changes exist. Commit and push them, wait for CI, or use the normal full-verification deployment.")
    # git status hides ignored files; Wrangler would still upload them.
    for site in PUBLIC_ROOTS:
        if command("git", "ls-files", "--others", "--ignored", "--exclude-standard", "--", site, root=root):
            raise RuntimeError(f"Ignored files exist in {site}; the upload would differ from the tested commit.")
    return command("git", "rev-parse", "HEAD", root=root)


def successful_run(runs, sha, repo):
    matching = [run for run in runs if run.get("head_sha") == sha and run.get("event") == "push"
                and run.get("repository", {}).get("full_name", "").lower() == repo.lower()]
    if not matching:
        raise RuntimeError(f"No push verification exists for {sha[:12]}. Push this commit and wait for the full workflow.")
    latest = max(matching, key=lambda run: (run["run_number"], run.get("run_attempt", 1)))
    if latest.get("status") != "completed" or latest.get("conclusion") != "success":
        raise RuntimeError(f"Latest verification for {sha[:12]} is {latest.get('status')}/{latest.get('conclusion')}. See {latest.get('html_url', 'GitHub Actions')}.")
    if latest.get("path", "").split("@", 1)[0] != f".github/workflows/{WORKFLOW}":
        raise RuntimeError("Unexpected verification workflow path.")
    return latest


def validate_jobs(jobs):
    expected = {"Plan verification", "Windows deployment contracts", GATE_JOB, *[f"Verify / {group}" for group in GROUPS]}
    counts = Counter(job.get("name") for job in jobs)
    if any(counts[name] != 1 for name in expected):
        raise RuntimeError("Full verification jobs are missing or duplicated; refusing a partial green run.")
    if any(job.get("status") != "completed" or job.get("conclusion") != "success" for job in jobs):
        raise RuntimeError("At least one verification job failed, was skipped, cancelled, or is still running.")


def verify(root=ROOT):
    sha = clean_head(root)
    repo = repository_slug(command("git", "remote", "get-url", "origin", root=root))
    query = urlencode({"event": "push", "head_sha": sha, "per_page": 100})
    runs = api(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?{query}")["workflow_runs"]
    run = successful_run(runs, sha, repo)
    # filter=latest includes successful jobs retained when only failed jobs rerun.
    jobs = api(f"repos/{repo}/actions/runs/{run['id']}/jobs?filter=latest&per_page=100")
    if jobs["total_count"] != len(jobs["jobs"]):
        raise RuntimeError("Incomplete verification job response.")
    validate_jobs(jobs["jobs"])
    current = api(f"repos/{repo}/actions/runs/{run['id']}")
    if (current.get("run_attempt"), current.get("status"), current.get("conclusion")) != (run.get("run_attempt"), "completed", "success"):
        raise RuntimeError("Verification was rerun while checking; retry after it completes.")
    if clean_head(root) != sha:
        raise RuntimeError("Checkout changed during verification.")
    print(f"PASS full GitHub verification for {sha}")
    print(run["html_url"])
    return sha


if __name__ == "__main__":
    try:
        verify()
    except (RuntimeError, ValueError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
