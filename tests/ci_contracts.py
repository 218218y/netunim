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

from verification_plan import CORE_SUITES, RUNTIME_SUITES, REPAIR_SUITES, GROUPS, CI_SHARDS, CI_BUNDLES, ci_groups, ci_matrix, validate_plan
import run_all
import browser_harness
import node_models
from node_models import test_files
from ci_timing import balanced_partition, estimates, timing_weights

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import github_verification as gate
import offline_deps
from update_ci_timings import collect_timings


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

    def test_browser_startup_allows_cold_devtools_response_to_finish(self):
        from unittest.mock import Mock
        process = Mock(returncode=None)
        process.poll.return_value = None
        response = io.BytesIO(b'[]')
        with patch.object(browser_harness.urllib.request, "urlopen", return_value=response) as request:
            self.assertEqual(browser_harness._wait_json("http://127.0.0.1:1/json/list", timeout=30, process=process), [])
        # Keep the total 30s deadline, but do not repeatedly abort a cold /json/list
        # response at 0.5s. The browser-sync failure log showed DevTools listening
        # while every individual request still timed out.
        self.assertGreater(request.call_args.kwargs["timeout"], 0.5)
        self.assertLessEqual(request.call_args.kwargs["timeout"], 5.0)

    def test_browser_shutdown_prefers_graceful_cdp_close(self):
        from unittest.mock import Mock
        process = Mock(returncode=None)
        process.poll.return_value = None
        process.wait.return_value = 0
        graceful = Mock()
        browser_harness._stop_browser_process(process, graceful)
        graceful.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=5)
        process.terminate.assert_not_called()
        process.kill.assert_not_called()

    def test_browser_shutdown_waits_after_forced_kill(self):
        from unittest.mock import Mock
        process = Mock(returncode=None)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("chrome", 3), 0]
        graceful = Mock(side_effect=RuntimeError("cdp unavailable"))
        browser_harness._stop_browser_process(process, graceful)
        graceful.assert_called_once_with()
        process.terminate.assert_called_once_with()
        process.kill.assert_called_once_with()
        self.assertEqual(process.wait.call_count, 2)
        self.assertEqual(process.wait.call_args_list[-1].kwargs["timeout"], 5)

    def test_browser_profile_cleanup_retries_transient_lock_and_never_hides_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "profile"
            root.mkdir()
            (root / "lock").write_text("x")
            real_rmtree = shutil.rmtree
            attempts = 0

            def transient(path, *, onexc):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise PermissionError("profile still closing")
                real_rmtree(path, onexc=onexc)

            with patch.object(browser_harness.shutil, "rmtree", side_effect=transient):
                browser_harness._remove_tree_verified(root, timeout=1)
            self.assertEqual(attempts, 2)
            self.assertFalse(root.exists())

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
        groups = ci_groups()
        self.assertCountEqual([row["group"] for row in matrix], groups)
        selected = [suite for row in matrix for suite in groups[row["group"]]]
        self.assertCountEqual(selected, CORE_SUITES + RUNTIME_SUITES)
        self.assertEqual(len(selected), len(set(selected)))
        for row in matrix:
            self.assertEqual(row["browser"], any(suite in RUNTIME_SUITES for suite in groups[row["group"]]))
            self.assertEqual(row["postgres"], any(suite in GROUPS["database"] + GROUPS["browser-database"] for suite in groups[row["group"]]))
        # Nested audits remain exercised by their original parent suites.
        self.assertIn("runtime_morning.py", selected)
        self.assertIn("supabase_candidate.py", selected)

    def test_repair_selection_excludes_external_services_but_does_not_change_the_full_inventory(self):
        self.assertEqual(REPAIR_SUITES, GROUPS['contracts'] + GROUPS['models'])
        self.assertTrue(set(REPAIR_SUITES).isdisjoint(GROUPS['database'] + RUNTIME_SUITES))
        self.assertEqual(set(REPAIR_SUITES + GROUPS['database'] + RUNTIME_SUITES), set(CORE_SUITES + RUNTIME_SUITES))
        self.assertNotIn('repair-only', ci_groups())

    def test_repair_dispatch_is_partial_and_core_and_full_prerequisites_remain_strict(self):
        cases = [(['--repair-only'], REPAIR_SUITES, False, False, 'repair-only'),
                 (['--core-only'], CORE_SUITES, False, True, 'core-only'),
                 ([], CORE_SUITES + RUNTIME_SUITES, True, True, 'full')]
        for arguments, selected, browser, postgres, label in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory, \
                 patch.object(run_all, 'preflight', return_value=0) as preflight, \
                 patch.object(run_all, 'run_suites', return_value=7) as run, redirect_stdout(io.StringIO()) as output:
                self.assertEqual(run_all.main([*arguments, '--report-dir', directory]), 7)
                preflight.assert_called_once_with(require_browser=browser, require_postgres=postgres)
                self.assertEqual(run.call_args.args[0], selected)
                self.assertEqual(run.call_args.kwargs['label'], label)
                self.assertEqual('PARTIAL verification' in output.getvalue(), label != 'full')

    def test_repair_preflight_does_not_probe_database_or_browser_prerequisites(self):
        with patch.object(run_all.shutil, 'which', side_effect=lambda name: '/node' if name == 'node' else None) as which, \
             patch.object(run_all.Path, 'is_file', return_value=True), \
             patch.object(run_all.importlib.util, 'find_spec') as find_spec:
            self.assertEqual(run_all.preflight(require_browser=False, require_postgres=False), 0)
            which.assert_called_once_with('node')
            find_spec.assert_not_called()

    def test_chat_repair_fallback_is_explicit_and_never_hides_a_probe_or_suite_failure(self):
        cases = [(0, True, False), (0, False, True), (3, True, True), (3, False, True), (2, True, None), (4, False, None)]
        for probe_rc, postgres, repair in cases:
            with self.subTest(probe=probe_rc, postgres=postgres), \
                 patch.object(offline_deps, 'browser_probe', return_value=probe_rc), \
                 patch.object(offline_deps, 'offline_env', return_value={}), \
                 patch.object(offline_deps.shutil, 'which', return_value='/postgres' if postgres else None), \
                 patch.object(offline_deps.subprocess, 'run', return_value=subprocess.CompletedProcess([], 9)) as run, \
                 redirect_stdout(io.StringIO()) as output:
                result = offline_deps.chat_test()
                if repair is None:
                    self.assertEqual(result, probe_rc)
                    run.assert_not_called()
                else:
                    self.assertEqual(result, 9)
                    self.assertEqual('--repair-only' in run.call_args.args[0], repair)
                    self.assertEqual('PARTIAL' in output.getvalue(), repair)

    def test_new_suite_is_included_without_a_second_shard_inventory(self):
        added = "new-runtime-suite.py"
        with patch.dict(GROUPS, {"browser-lifecycle": [*GROUPS["browser-lifecycle"], added]}), \
             patch("verification_plan.Path.is_file", return_value=True):
            groups = ci_groups()
        self.assertEqual(sum(suites.count(added) for suites in groups.values()), 1)

    def test_short_groups_share_one_machine_with_all_required_dependencies(self):
        groups = ci_groups()
        self.assertCountEqual(groups["contracts-database"], GROUPS["contracts"] + GROUPS["database"] + GROUPS["browser-database"])
        self.assertTrue(all(name not in groups for name in ("contracts", "database", "browser-database")))
        row = next(row for row in ci_matrix()["include"] if row["group"] == "contracts-database")
        self.assertTrue(row["browser"])
        self.assertTrue(row["postgres"])
        with tempfile.TemporaryDirectory() as directory, patch.object(run_all, "preflight", return_value=0) as preflight, \
             patch.object(run_all, "run_suites", return_value=0), redirect_stdout(io.StringIO()):
            self.assertEqual(run_all.main(["--group", "contracts-database", "--report-dir", directory]), 0)
            preflight.assert_called_once_with(require_browser=True, require_postgres=True)

    def test_invalid_bundles_cannot_drop_or_duplicate_verification(self):
        for changes in ({"contracts-database": ()}, {"contracts-database": ("unknown",)},
                        {"contracts-database": ("contracts", "contracts")}, {"contracts-database": ("models",)},
                        {"contracts": ("database",)}, {"extra": ("database",)}):
            with self.subTest(changes=changes), patch.dict(CI_BUNDLES, changes), self.assertRaises(ValueError):
                ci_matrix()

    def test_invalid_shard_configuration_cannot_produce_a_partial_matrix(self):
        for changes in ({"unknown": 2}, {"browser-ui": 0}, {"browser-ui": 100}, {"browser-ui": True}):
            with self.subTest(changes=changes), patch.dict(CI_SHARDS, changes), self.assertRaises(ValueError):
                ci_matrix()
        with patch.dict(GROUPS, {"browser-lifecycle-1": ["runtime_smoke.py"]}), \
             patch("verification_plan.validate_plan"), self.assertRaisesRegex(ValueError, "Duplicate CI group"):
            ci_matrix()

    def test_cli_selects_a_shard_and_preserves_the_original_local_group(self):
        for group in ("browser-lifecycle", "browser-lifecycle-4", "browser-sync-2", "browser-ui", "models", "models-2",
                      "contracts-database", "contracts", "database", "browser-database"):
            expected = {**GROUPS, **ci_groups()}[group]
            with self.subTest(group=group), tempfile.TemporaryDirectory() as tmp, \
                 patch.object(run_all, "preflight", return_value=0), \
                 patch.object(run_all, "run_suites", return_value=0) as runner, \
                 redirect_stdout(io.StringIO()):
                self.assertEqual(run_all.main(["--group", group, "--keep-going", "--report-dir", tmp]), 0)
                self.assertEqual(runner.call_args.args[0], expected)
                self.assertEqual(runner.call_args.kwargs["jobs"], 1)
                self.assertTrue(runner.call_args.kwargs["keep_going"])

    def test_every_javascript_test_is_discovered_including_previous_orphans(self):
        discovered = test_files()
        self.assertEqual(len(discovered), len(list((ROOT / "tests").glob("*.test.mjs"))))
        for name in ("orders_scroll_race", "orders_note_reminders", "calendar_local_cloud_auth", "calendar_local_controller", "morning_edge"):
            self.assertIn(f"tests/{name}.test.mjs", discovered)

    def test_timing_partition_is_balanced_deterministic_and_not_a_test_filter(self):
        weights = dict(zip("abcdef", (9, 8, 7, 6, 5, 4)))
        parts = balanced_partition(list(weights), 3, weights)
        self.assertEqual([sum(weights[name] for name in part) for part in parts], [13, 13, 13])
        self.assertEqual(parts, balanced_partition(list(reversed(weights)), 3, weights))
        self.assertCountEqual([name for part in parts for name in part], weights)
        self.assertEqual(estimates(["a", "b", "new"], weights)["new"], 8.5)
        self.assertIn("new", sum(balanced_partition(["a", "b", "new"], 2, weights), []))
        self.assertEqual(estimates(["new"], {})["new"], 1)
        costs = {str(index): 1 for index in range(10)}
        parts = balanced_partition(list(costs), 2, costs, initial_loads=[4, 0])
        self.assertEqual([len(parts[0]) + 4, len(parts[1])], [7, 7])
        parts = balanced_partition(list(costs), 2, costs, initial_loads=[1000, 0])
        self.assertTrue(all(parts))
        self.assertCountEqual(sum(parts, []), costs)
        for overhead in ([0], [True, 0], [-1, 0], [float("nan"), 0]):
            with self.subTest(overhead=overhead), self.assertRaises(ValueError):
                balanced_partition(list(costs), 2, costs, initial_loads=overhead)
        for count in (0, 7, True):
            with self.subTest(count=count), self.assertRaises(ValueError):
                balanced_partition(list(weights), count, weights)

    def test_invalid_costs_fail_planning_instead_of_silently_changing_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "timings.json"
            for value in (0, -1, True, "4", float("nan"), float("inf")):
                path.write_text(json.dumps({"version": 1, "suite_seconds": {"a": value}}))
                with self.subTest(value=value), self.assertRaises(ValueError):
                    timing_weights("suite_seconds", path)

    def test_node_partitions_cover_every_file_once_and_include_new_files(self):
        selected = [*test_files(shard=1), *test_files(shard=2)]
        self.assertCountEqual(selected, test_files())
        self.assertEqual(len(selected), len(set(selected)))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tests").mkdir()
            for name in ("a", "b", "new"):
                (root / f"tests/{name}.test.mjs").touch()
            with patch.object(node_models, "ROOT", root), patch.object(node_models, "timing_weights", return_value={"tests/a.test.mjs": 20}):
                self.assertCountEqual([*test_files(shard=1), *test_files(shard=2)], test_files())
                self.assertIn("tests/new.test.mjs", [*test_files(shard=1), *test_files(shard=2)])
        for shard in (0, 3, True):
            with self.subTest(shard=shard), self.assertRaises(ValueError):
                test_files(shard=shard)

    def test_real_node_reporter_preserves_failures_and_times_plain_assertion_files(self):
        with tempfile.TemporaryDirectory(prefix="node timing contracts ") as directory:
            root = Path(directory)
            good, bad, broken_import = root / "good.test.mjs", root / "bad.test.mjs", root / "import.test.mjs"
            good.write_text("import assert from 'node:assert/strict'; assert.equal(1,1);\n")
            bad.write_text("import test from 'node:test'; test('fails',()=>{throw new Error('expected fixture failure')});\n")
            broken_import.write_text("import './not-installed.mjs';\n")
            # This native invocation covers spaces and Windows file: reporter URLs.
            real_call = subprocess.call
            with (root / "console.log").open("w", encoding="utf-8") as log, patch.object(node_models.subprocess, "call") as call:
                call.side_effect = lambda command, **kwargs: real_call(command, stdout=log, stderr=subprocess.STDOUT, **kwargs)
                self.assertNotEqual(node_models.run_files([str(good), str(bad), str(broken_import)], root / "reports"), 0)
            rows = [json.loads(line) for line in (root / "reports/node-files.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows), 3)
            self.assertEqual({Path(row["file"]).name: row["status"] for row in rows}, {good.name: "passed", bad.name: "failed", broken_import.name: "failed"})
            self.assertTrue(all(row["seconds"] > 0 for row in rows))
            self.assertIn("expected fixture failure", (root / "console.log").read_text(encoding="utf-8"))

    def test_timing_refresh_uses_successful_samples_and_medians_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, seconds in enumerate((10, 14, 90)):
                report = root / str(index)
                report.mkdir()
                (report / "results.json").write_text(json.dumps({"suites": [{"suite": "a.py", "seconds": seconds, "status": "passed"}, {"suite": "bad.py", "seconds": 0, "status": "not-run"}]}))
            (root / "node-files.jsonl").write_text(json.dumps({"file": "tests/a.test.mjs", "seconds": 4, "status": "passed"}) + "\n")
            data = collect_timings([root, root / "0"], ["fixture"])
            self.assertEqual(data["suite_seconds"], {"a.py": 14})
            self.assertEqual(data["node_seconds"], {"tests/a.test.mjs": 4})

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
        names = ["Plan verification", "Windows deployment contracts", gate.GATE_JOB, *[f"Verify / {name}" for name in ci_groups()]]
        jobs = [{"name": name, "status": "completed", "conclusion": "success"} for name in names]
        gate.validate_jobs(jobs)
        for index, job in enumerate(jobs):
            for broken in (jobs[:index] + jobs[index + 1:], jobs + [job],
                           *[jobs[:index] + [{**job, "conclusion": conclusion}] + jobs[index + 1:]
                             for conclusion in ("failure", "skipped", "cancelled")],
                           jobs[:index] + [{**job, "status": "in_progress"}] + jobs[index + 1:]):
                with self.subTest(job=job["name"]), self.assertRaises(RuntimeError):
                    gate.validate_jobs(broken)
        # A green run with only the old eight groups is no longer a full gate.
        old_names = ["Plan verification", "Windows deployment contracts", gate.GATE_JOB, *[f"Verify / {name}" for name in GROUPS]]
        with self.assertRaises(RuntimeError):
            gate.validate_jobs([{"name": name, "status": "completed", "conclusion": "success"} for name in old_names])

    def test_api_failure_cannot_authorize_upload(self):
        with patch.object(gate, "clean_head", return_value="abc123"), patch.object(gate, "command", return_value="https://github.com/owner/repo"), \
                patch.object(gate, "api", side_effect=RuntimeError("network unavailable")):
            with self.assertRaisesRegex(RuntimeError, "network unavailable"):
                gate.verify()

    def test_successful_end_to_end_api_contract_and_rerun_race(self):
        run = successful_fixture()
        names = ["Plan verification", "Windows deployment contracts", gate.GATE_JOB, *[f"Verify / {name}" for name in ci_groups()]]
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
