"""Behavioral contracts for CI selection, failure reporting and fast-deploy trust."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from verification_plan import CORE_SUITES, RUNTIME_SUITES, GROUPS, ci_matrix, validate_plan
import run_all
import browser_harness
from node_models import test_files

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import github_verification as gate


def successful_fixture():
    return {"id": 10, "run_number": 4, "run_attempt": 1, "head_sha": "abc123", "event": "push",
            "repository": {"full_name": "owner/repo"}, "path": ".github/workflows/verify.yml",
            "status": "completed", "conclusion": "success", "html_url": "https://github.com/owner/repo/actions/runs/10"}


class VerificationContracts(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        # Synthetic reports below must not pollute the real CI job summary.
        os.environ.pop("GITHUB_STEP_SUMMARY", None)

    def test_browser_startup_fails_immediately_if_chrome_exits(self):
        from unittest.mock import Mock
        process = Mock(returncode=7)
        process.poll.return_value = 7
        with patch.object(browser_harness.urllib.request, "urlopen") as request:
            with self.assertRaisesRegex(RuntimeError, "exit 7"):
                browser_harness._wait_json("http://127.0.0.1:1/json/list", timeout=30, process=process)
            request.assert_not_called()

    def test_windows_seed_is_shared_without_sharing_browser_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profiles = [root / "A", root / "B"]
            for profile in profiles:
                profile.mkdir()
            calls = []
            cache = {"os_password_blank": False, "os_password_last_changed": "13409412646932424"}

            def bootstrap(_browser, seed_profile):
                calls.append(seed_profile)
                seed_profile.mkdir(parents=True)
                (seed_profile / "Local State").write_text(
                    json.dumps({"password_manager": cache}), encoding="utf-8")
                time.sleep(0.1)
                return cache

            with patch.object(browser_harness, "HOST_STATE_ROOT", root / "host"), \
                 patch.object(browser_harness, "_is_windows", return_value=True), \
                 patch.object(browser_harness, "_windows_password_check_state", return_value=cache), \
                 patch.object(browser_harness, "_bootstrap_host_state", side_effect=bootstrap):
                threads = [threading.Thread(target=browser_harness._seed_windows_profile,
                                            args=("chrome.exe", profile)) for profile in profiles]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=5)
                self.assertTrue(all(not thread.is_alive() for thread in threads))
                self.assertEqual(len(calls), 1)
                self.assertNotEqual(profiles[0], profiles[1])
                for profile in profiles:
                    self.assertEqual(json.loads((profile / "Local State").read_text(encoding="utf-8")),
                                     {"password_manager": cache})
                    self.assertFalse((profile / "Default").exists())
                (profiles[0] / "Default" / "Local Storage").mkdir(parents=True)
                (profiles[0] / "Default" / "IndexedDB").mkdir()
                self.assertFalse((profiles[1] / "Default").exists())
                shutil.rmtree(profiles[0])
                self.assertTrue((root / "host" / browser_harness._seed_key("chrome.exe") /
                                 "profile" / "Local State").exists())

    def test_windows_seed_failure_blocks_repeated_browser_bootstrap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = root / "session"
            profile.mkdir()
            with patch.object(browser_harness, "HOST_STATE_ROOT", root / "host"), \
                 patch.object(browser_harness, "_is_windows", return_value=True), \
                 patch.object(browser_harness, "_bootstrap_host_state", side_effect=RuntimeError("seed failed")) as bootstrap:
                for _ in range(2):
                    with self.assertRaisesRegex(RuntimeError, "browser launch stopped"):
                        browser_harness._seed_windows_profile("chrome.exe", profile)
                self.assertEqual(bootstrap.call_count, 1)
                self.assertFalse((profile / "Local State").exists())

    def test_windows_seed_bootstraps_once_across_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "worker.py"
            script.write_text("""
import json, os, pathlib, sys, time
from unittest.mock import patch
sys.path.insert(0, os.environ['NETUNIM_TESTS_DIR'])
import browser_harness as h
root = pathlib.Path(os.environ['NETUNIM_TEST_ROOT'])
cache = {'os_password_blank': False, 'os_password_last_changed': '13409412646932424'}
def bootstrap(browser, profile):
    profile.mkdir(parents=True)
    with (root / 'bootstrap-count').open('a') as count:
        count.write('1\\n')
    time.sleep(0.3)
    (profile / 'Local State').write_text(json.dumps({'password_manager': cache}))
    return cache
with patch.object(h, 'HOST_STATE_ROOT', root / 'host'), \\
     patch.object(h, '_is_windows', return_value=True), \\
     patch.object(h, '_windows_password_check_state', return_value=cache), \\
     patch.object(h, '_bootstrap_host_state', side_effect=bootstrap):
    h._seed_windows_profile('chrome.exe', root / os.environ['NETUNIM_TEST_PROFILE'])
""", encoding="utf-8")
            for name in ("A", "B"):
                (root / name).mkdir()
            environment = dict(os.environ, NETUNIM_TESTS_DIR=str(ROOT / "tests"),
                               NETUNIM_TEST_ROOT=str(root))
            children = [subprocess.Popen([sys.executable, str(script)],
                        env=dict(environment, NETUNIM_TEST_PROFILE=name),
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                        for name in ("A", "B")]
            for child in children:
                _out, error = child.communicate(timeout=10)
                self.assertEqual(child.returncode, 0, error)
            self.assertEqual((root / "bootstrap-count").read_text().splitlines(), ["1"])
            self.assertTrue(all((root / name / "Local State").exists() for name in ("A", "B")))

    def test_non_windows_profile_does_not_use_host_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)
            with patch.object(browser_harness, "_is_windows", return_value=False), \
                 patch.object(browser_harness, "_bootstrap_host_state") as bootstrap:
                browser_harness._seed_windows_profile("chromium", profile)
                bootstrap.assert_not_called()
                self.assertFalse((profile / "Local State").exists())

    def test_matrix_is_a_complete_disjoint_partition_of_the_full_local_gate(self):
        validate_plan()
        matrix = ci_matrix()["include"]
        selected = [suite for row in matrix for suite in GROUPS[row["group"]]]
        self.assertCountEqual(selected, CORE_SUITES + RUNTIME_SUITES)
        self.assertEqual(len(selected), len(set(selected)))
        self.assertTrue(next(row for row in matrix if row["group"] == "browser-database")["postgres"])
        # Nested audits remain exercised by their original parent suites.
        self.assertIn("runtime_morning.py", selected)
        self.assertIn("supabase_candidate.py", selected)

    def test_every_javascript_test_is_discovered_including_previous_orphans(self):
        discovered = test_files()
        self.assertEqual(len(discovered), len(list((ROOT / "tests").glob("*.test.mjs"))))
        for name in ("orders_scroll_race", "orders_note_reminders", "calendar_local_cloud_auth", "calendar_local_controller", "morning_edge"):
            self.assertIn(f"tests/{name}.test.mjs", discovered)

    def test_ci_dependency_installs_do_not_restore_cross_run_package_caches(self):
        workflow = (ROOT / '.github/workflows/verify.yml').read_text(encoding='utf8')
        self.assertIn('package-manager-cache: false', workflow)
        self.assertNotIn('cache: npm', workflow)
        self.assertNotIn('cache: pip', workflow)
        self.assertIn('npm ci --cache "$RUNNER_TEMP/netunim-npm-cache"', workflow)
        self.assertIn('python -m pip install --no-cache-dir -r tests/requirements-ci.txt', workflow)

    def test_child_failure_is_preserved_and_keep_going_runs_the_rest(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "bad.py").write_text("raise SystemExit(7)\n", encoding="utf8")
            (directory / "good.py").write_text("print('completed')\n", encoding="utf8")
            with patch.object(run_all, "TESTS", directory), redirect_stdout(io.StringIO()):
                rc = run_all.run_suites(["bad.py", "good.py"], keep_going=True, report_dir=directory / "report")
            self.assertEqual(rc, 7)
            rows = json.loads((directory / "report/results.json").read_text())["suites"]
            self.assertEqual([row["status"] for row in rows], ["failed", "passed"])
            self.assertIn("completed", (directory / "report/good.py.log").read_text())
            self.assertEqual(run_all.ET.parse(directory / "report/junit.xml").getroot().get("failures"), "1")

    def test_fail_fast_does_not_report_unexecuted_suites_as_passed(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "bad.py").write_text("raise SystemExit(9)\n")
            with patch.object(run_all, "TESTS", directory), redirect_stdout(io.StringIO()):
                rc = run_all.run_suites(["bad.py", "must-not-run.py"], report_dir=directory / "report")
            self.assertEqual(rc, 9)
            rows = json.loads((directory / "report/results.json").read_text())["suites"]
            self.assertEqual(rows[1]["status"], "not-run")

    def test_timeout_is_failure_with_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "slow.py").write_text("import time; time.sleep(30)\n")
            with patch.object(run_all, "TESTS", directory), redirect_stdout(io.StringIO()):
                rc = run_all.run_suites(["slow.py"], report_dir=directory / "report", timeout=0.1)
            self.assertEqual(rc, 124)
            self.assertIn("exceeded", (directory / "report/slow.py.log").read_text())


class GithubGateContracts(unittest.TestCase):
    def test_origin_parsing(self):
        for remote in ("https://github.com/owner/repo.git", "git@github.com:owner/repo.git", "ssh://git@github.com/owner/repo"):
            self.assertEqual(gate.repository_slug(remote), "owner/repo")
        for remote in ("https://token@github.com/owner/repo", "https://example.com/owner/repo", "https://github.com/owner/repo/extra"):
            with self.assertRaises(RuntimeError):
                gate.repository_slug(remote)

    def test_only_exact_push_commit_counts_and_latest_failure_cannot_use_old_green(self):
        green = successful_fixture()
        self.assertEqual(gate.successful_run([green], "abc123", "owner/repo"), green)
        for changes in ({"head_sha": "different"}, {"event": "pull_request"}, {"repository": {"full_name": "other/repo"}},
                        {"status": "in_progress"}, {"conclusion": "failure"}, {"conclusion": "cancelled"},
                        {"path": ".github/workflows/partial.yml"}):
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                gate.successful_run([{**green, **changes}], "abc123", "owner/repo")
        with self.assertRaises(RuntimeError):
            gate.successful_run([green, {**green, "id": 11, "run_number": 5, "conclusion": "failure"}], "abc123", "owner/repo")

    def test_partial_skipped_or_duplicate_jobs_never_authorize_upload(self):
        names = ["Plan verification", "Windows deployment contracts", gate.GATE_JOB, *[f"Verify / {name}" for name in GROUPS]]
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in names]
        gate.validate_jobs(jobs)
        for broken in (jobs[:-1], jobs + jobs[:1], [{**jobs[0], "conclusion": "skipped"}, *jobs[1:]],
                       [{**jobs[0], "status": "in_progress"}, *jobs[1:]]):
            with self.assertRaises(RuntimeError):
                gate.validate_jobs(broken)

    def test_api_failure_cannot_authorize_upload(self):
        with patch.object(gate, "clean_head", return_value="abc123"), patch.object(gate, "command", return_value="https://github.com/owner/repo"), \
                patch.object(gate, "api", side_effect=RuntimeError("network unavailable")):
            with self.assertRaisesRegex(RuntimeError, "network unavailable"):
                gate.verify()

    def test_successful_end_to_end_api_contract_and_rerun_race(self):
        run = successful_fixture()
        names = ["Plan verification", "Windows deployment contracts", gate.GATE_JOB, *[f"Verify / {name}" for name in GROUPS]]
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in names]
        responses = [{"workflow_runs": [run]}, {"total_count": len(jobs), "jobs": jobs}, run]
        for last, allowed in ((run, True), ({**run, "run_attempt": 2, "status": "queued"}, False)):
            with patch.object(gate, "clean_head", return_value="abc123"), patch.object(gate, "command", return_value="https://github.com/owner/repo"), \
                    patch.object(gate, "api", side_effect=[*responses[:2], last]), redirect_stdout(io.StringIO()):
                if allowed:
                    self.assertEqual(gate.verify(), "abc123")
                else:
                    with self.assertRaises(RuntimeError):
                        gate.verify()

    def test_real_git_checkout_rejects_edits_and_ignored_public_uploads(self):
        with tempfile.TemporaryDirectory(prefix="netunim ci spaces ") as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True,
                                      env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1"})
            git("init")
            (root / ".gitignore").write_text("*.log\n.work/\n")
            site = root / gate.PUBLIC_ROOTS[0]
            site.mkdir(parents=True)
            (site / "index.html").write_text("fixture")
            git("add", ".")
            git("-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture")
            sha = gate.clean_head(root)
            self.assertEqual(len(sha), 40)
            (root / ".work").mkdir()
            (root / ".work/report.log").write_text("ignored local test output")
            self.assertEqual(gate.clean_head(root), sha)
            (site / "private.log").write_text("must not upload")
            with self.assertRaisesRegex(RuntimeError, "Ignored files"):
                gate.clean_head(root)
            (site / "private.log").unlink()
            (site / "index.html").write_text("changed after CI")
            with self.assertRaisesRegex(RuntimeError, "Uncommitted"):
                gate.clean_head(root)
            git("add", ".")
            with self.assertRaisesRegex(RuntimeError, "Uncommitted"):
                gate.clean_head(root)


if __name__ == "__main__":
    unittest.main(verbosity=2)
