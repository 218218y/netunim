"""Exercise local scheduling and process ownership without application services."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import stat
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import local_scheduler as scheduler
import run_all
import suite_process
from suite_process import SuiteProcess
from verification_plan import CORE_SUITES, RUNTIME_SUITES


class RunnerContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="runner contracts ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ)
        self.env.start()
        self.addCleanup(self.env.stop)
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        os.environ.pop("NETUNIM_VERIFY_JOBS", None)

    def script(self, name, source):
        path = self.root / name
        path.write_text(source, encoding="utf8")
        return path

    def run_suites(self, names, **kwargs):
        with patch.object(run_all, "TESTS", self.root), redirect_stdout(io.StringIO()):
            rc = run_all.run_suites(names, report_dir=self.root / "report", verbose=False, **kwargs)
        report = json.loads((self.root / "report/results.json").read_text())
        return rc, report

    def test_two_real_children_must_meet_before_either_can_finish(self):
        # This cannot pass under a sequential executor, irrespective of machine speed.
        for name, other in (("a", "b"), ("b", "a")):
            self.script(f"{name}.py", f"""from pathlib import Path
import time
root = Path(__file__).parent
(root / '{name}.ready').touch()
deadline = time.monotonic() + 10
while not (root / '{other}.ready').exists():
    assert time.monotonic() < deadline, 'peer was never scheduled'
    time.sleep(.01)
print('met peer')
""")
        rc, report = self.run_suites(["a.py", "b.py"], jobs=2)
        self.assertEqual(rc, 0)
        self.assertEqual([row["status"] for row in report["suites"]], ["passed", "passed"])
        for name in ("a", "b"):
            self.assertIn("met peer", (self.root / f"report/{name}.py.log").read_text())

    def test_actual_schedule_obeys_browser_database_and_exclusive_limits(self):
        names = ["module_contracts.py", "runtime_morning.py", "runtime_sync_postgres.py", "supabase_candidate.py",
                 "runtime_smoke.py", "runtime_events.py", "runtime_performance.py"]
        for name in names:
            self.script(name, "import time; time.sleep(.2)\n")
        rc, report = self.run_suites(names, jobs=4, browser_jobs=2)
        self.assertEqual(rc, 0)
        self.assertCountEqual([row["suite"] for row in report["suites"]], names)
        for row in report["suites"]:
            overlapping = [other["suite"] for other in report["suites"]
                           if other["started_seconds"] <= row["started_seconds"] < other["finished_seconds"]]
            self.assertLessEqual(len(overlapping), 4)
            self.assertLessEqual(sum(scheduler.resources(name).browser for name in overlapping), 2)
            self.assertLessEqual(sum(scheduler.resources(name).database for name in overlapping), 1)
            if any(scheduler.resources(name).exclusive for name in overlapping):
                self.assertEqual(len(overlapping), 1)

    def test_parallel_failure_drains_started_work_and_stops_new_work(self):
        self.script("bad.py", "raise SystemExit(7)\n")
        self.script("inflight.py", "import time; time.sleep(.4); print('finished inflight')\n")
        self.script("queued.py", "raise AssertionError('must not run')\n")
        rc, report = self.run_suites(["bad.py", "inflight.py", "queued.py"], jobs=2)
        self.assertEqual(rc, 7)
        self.assertEqual([row["status"] for row in report["suites"]], ["failed", "passed", "not-run"])
        self.assertFalse((self.root / "report/queued.py.log").exists())
        self.assertEqual(run_all.ET.parse(self.root / "report/junit.xml").getroot().get("skipped"), "1")

    def test_parallel_keep_going_and_launch_failure_are_reported(self):
        self.script("good.py", "print('good')\n")
        real_process = run_all.SuiteProcess
        def create(path, *args, **kwargs):
            if path.name == "bad.py":
                raise OSError("fixture start failure")
            return real_process(path, *args, **kwargs)
        with patch.object(run_all, "SuiteProcess", side_effect=create):
            rc, report = self.run_suites(["bad.py", "good.py"], jobs=2, keep_going=True)
        self.assertEqual(rc, 2)
        self.assertEqual([row["status"] for row in report["suites"]], ["failed", "passed"])

    def test_real_cleanup_error_cannot_turn_a_partial_gate_green(self):
        self.script("good.py", "print('assertions passed')\n")
        close = SuiteProcess.close
        def fail_cleanup(process):
            close(process)
            raise PermissionError("fixture non-readonly cleanup failure")
        with patch.object(SuiteProcess, "close", fail_cleanup):
            rc, report = self.run_suites(["good.py", "queued.py"])
        self.assertEqual(rc, 2)
        self.assertEqual([row["status"] for row in report["suites"]], ["failed", "not-run"])
        self.assertIn("cleanup failed", (self.root / "report/good.py.log").read_text())

    def test_interrupt_cleans_every_active_suite_and_preserves_partial_report(self):
        for name in ("a.py", "b.py", "queued.py"):
            self.script(name, "import time; time.sleep(60)\n")
        real_sleep = time.sleep
        def interrupt_coordinator(seconds):
            if seconds == .05:
                raise KeyboardInterrupt
            real_sleep(seconds)
        with patch.object(run_all.time, "sleep", side_effect=interrupt_coordinator):
            rc, report = self.run_suites(["a.py", "b.py", "queued.py"], jobs=2)
        self.assertEqual(rc, 130)
        self.assertEqual([row["status"] for row in report["suites"]], ["cancelled", "cancelled", "not-run"])
        self.assertEqual(run_all.ET.parse(self.root / "report/junit.xml").getroot().get("failures"), "2")

    def test_defaults_preserve_ci_serial_execution_and_bat_environment_override(self):
        for args, env, expected in (([], None, scheduler.default_jobs()), ([], "2", 2),
                                    (["--jobs", "1"], "4", 1), (["--group", "models"], "4", 1)):
            with self.subTest(args=args, env=env), patch.dict(os.environ, {"NETUNIM_VERIFY_JOBS": env or str(scheduler.default_jobs())}), \
                    patch.object(run_all, "preflight", return_value=0), patch.object(run_all, "run_suites", return_value=0) as run, \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(run_all.main([*args, "--report-dir", str(self.root / "report")]), 0)
                self.assertEqual(run.call_args.kwargs["jobs"], expected)
        for invalid in ("0", "-1", "invalid"):
            with patch.dict(os.environ, {"NETUNIM_VERIFY_JOBS": invalid}), patch.object(run_all, "preflight") as preflight:
                with patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit) as raised:
                    run_all.main([])
                self.assertEqual(raised.exception.code, 2)
                preflight.assert_not_called()

    def test_reordering_never_drops_or_duplicates_suites_and_serial_keeps_order(self):
        names = CORE_SUITES + RUNTIME_SUITES
        self.assertEqual(scheduler.schedule_order(names, 1), names)
        self.assertCountEqual(scheduler.schedule_order(names, 4), names)
        self.assertEqual(scheduler.schedule_order(names, 4)[-1], "runtime_performance.py")

    def tree_fixture(self, stem, leave_parent=False):
        marker = self.root / f"{stem}.port"
        grandchild = self.script(f"{stem}_child.py", f"""import json, os, socket, time, tempfile
from pathlib import Path
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
sock.listen()
Path(tempfile.gettempdir(), 'owned.tmp').write_text('disposable')
Path({str(marker.with_suffix('.owner'))!r}).write_text(json.dumps({{
    'pid': os.getpid(), 'pgid': os.getpgid(0) if os.name != 'nt' else None,
}}))
Path({str(marker)!r}).write_text(str(sock.getsockname()[1]))
time.sleep(60)
""")
        parent = self.script(f"{stem}.py", f"""import subprocess, sys, time
from pathlib import Path
subprocess.Popen([sys.executable, {str(grandchild)!r}])
deadline = time.monotonic() + 10
while not Path({str(marker)!r}).exists():
    assert time.monotonic() < deadline
    time.sleep(.01)
print('grandchild ready', flush=True)
{'time.sleep(60)' if not leave_parent else ''}
""")
        return parent, marker

    def wait_port(self, marker):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if marker.exists() and marker.read_text():
                return int(marker.read_text())
            time.sleep(.01)
        self.fail("grandchild never opened its server")

    def can_connect(self, port):
        with socket.socket() as sock:
            sock.settimeout(.2)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def test_cleanup_owns_descendants_and_temp_files_without_touching_sibling(self):
        processes = []
        try:
            for stem in ("owned", "sibling"):
                parent, marker = self.tree_fixture(stem)
                process = SuiteProcess(parent, self.root / f"{stem}.log", cwd=self.root)
                processes.append(process)
                self.wait_port(marker)
            owned, sibling = processes
            self.assertTrue((owned.scratch / "owned.tmp").is_file())
            owned.close()
            owned.close()  # Cleanup is idempotent.
            self.assertFalse(owned.scratch.exists())
            self.assertFalse(self.can_connect(int((self.root / "owned.port").read_text())))
            self.assertIsNone(sibling.poll())
            self.assertTrue(self.can_connect(int((self.root / "sibling.port").read_text())))
        finally:
            for process in processes:
                process.close()

    def test_timeout_and_normal_exit_both_clean_remaining_descendants(self):
        for normal in (False, True):
            with self.subTest(normal=normal):
                parent, marker = self.tree_fixture("exit" if normal else "timeout", leave_parent=normal)
                rc, report = self.run_suites([parent.name], timeout=3)
                self.assertEqual(rc, 0 if normal else 124)
                self.assertIn("grandchild ready", (self.root / f"report/{parent.name}.log").read_text())
                self.assertFalse(self.can_connect(int(marker.read_text())))
                self.assertEqual(report["suites"][0]["status"], "passed" if normal else "failed")

    @unittest.skipIf(os.name == "nt", "POSIX process-group termination")
    def test_normal_exit_releases_descendant_sockets_in_200_real_process_trees(self):
        # Wait for the parent, not the descendant. Every listener is confirmed
        # live before close; probe immediately afterwards without a grace sleep.
        leaked = []
        for iteration in range(200):
            parent, marker = self.tree_fixture(f"stress-{iteration}", leave_parent=True)
            process = SuiteProcess(parent, self.root / f"stress-{iteration}.log", cwd=self.root)
            try:
                port = self.wait_port(marker)
                owner = json.loads(marker.with_suffix(".owner").read_text())
                self.assertEqual(owner["pgid"], process.proc.pid)
                self.assertTrue(self.can_connect(port))
                self.assertEqual(process.proc.wait(timeout=10), 0)
                process.close()
                if self.can_connect(port):
                    leaked.append({"iteration": iteration, "port": port, **owner})
                self.assertFalse(process.scratch.exists())
            finally:
                process.close()
        self.assertEqual(leaked, [], f"Listeners still reachable after cleanup: {leaked}")

    @unittest.skipUnless(os.name == "nt", "Windows read-only directory attributes")
    def test_readonly_copied_site_is_removed_without_changing_source(self):
        source = self.root / "source" / "supabase"
        source.mkdir(parents=True)
        config = source / "config.js"
        config.write_text("fixture")
        config.chmod(stat.S_IREAD)
        source.chmod(stat.S_IREAD)
        try:
            path = self.script("readonly.py", f"""import shutil, tempfile
from pathlib import Path
root = Path(tempfile.gettempdir())
shutil.copytree({str(source.parent)!r}, root / 'site')
assert (root / 'site/supabase').stat().st_file_attributes & 1
print(root, flush=True)
""")
            rc, report = self.run_suites([path.name])
            self.assertEqual(rc, 0)
            self.assertEqual(report["suites"][0]["status"], "passed")
            scratch = Path((self.root / "report/readonly.py.log").read_text().strip())
            self.assertFalse(scratch.exists())
            self.assertTrue(source.stat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY)
            self.assertTrue(config.stat().st_file_attributes & stat.FILE_ATTRIBUTE_READONLY)
            self.assertEqual(config.read_text(), "fixture")
        finally:
            source.chmod(stat.S_IWRITE)
            config.chmod(stat.S_IWRITE)


class PosixCleanupContracts(unittest.TestCase):
    def setUp(self):
        # Exercise the POSIX decision contract on Windows too, without signals
        # to real processes. Windows Job ownership retains its own real tests.
        kill_signal = patch.object(suite_process.signal, "SIGKILL", 9, create=True)
        kill_signal.start()
        self.addCleanup(kill_signal.stop)

    def test_observation_filters_owned_live_members_and_tolerates_exit_races(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for pid, state, group in ((11, "S", 10), (12, "Z", 10), (13, "X", 10), (14, "S", 20)):
                entry = root / str(pid)
                entry.mkdir()
                (entry / "stat").write_text(f"{pid} (name with ) parentheses) {state} 1 {group} 10 0\n")
            (root / "15").mkdir()  # Exited before its stat could be read.
            (root / "self").mkdir()
            self.assertEqual(suite_process.live_posix_group(10, proc_root=root), [11])

    def test_other_posix_hosts_use_group_and_state_without_command_lines(self):
        with patch.object(suite_process.sys, "platform", "darwin"), \
                patch.object(suite_process.subprocess, "run", return_value=Mock(stdout="11 10 S\n12 10 Z\n13 20 S\n")) as ps:
            self.assertEqual(suite_process.live_posix_group(10), [11])
        self.assertEqual(ps.call_args.args[0], ["ps", "-axo", "pid=,pgid=,stat="])
        self.assertTrue(ps.call_args.kwargs["check"])

    def test_group_wait_observes_new_members_and_returns_only_when_all_are_done(self):
        with patch.object(suite_process.os, "killpg", create=True) as kill, \
                patch.object(suite_process, "live_posix_group", side_effect=[[11], [12], []]), \
                patch.object(suite_process.time, "sleep"):
            suite_process.terminate_posix_group(10)
        self.assertEqual(kill.call_count, 3)
        self.assertTrue(all(call.args == (10, suite_process.signal.SIGKILL) for call in kill.call_args_list))

    def test_finished_group_requires_no_wait(self):
        with patch.object(suite_process.os, "killpg", create=True, side_effect=ProcessLookupError), \
                patch.object(suite_process, "live_posix_group") as observe:
            suite_process.terminate_posix_group(10)
        observe.assert_not_called()

    def test_timeout_and_observation_errors_are_not_reported_as_cleanup_success(self):
        with patch.object(suite_process.os, "killpg", create=True), \
                patch.object(suite_process, "live_posix_group", return_value=[11]):
            with self.assertRaisesRegex(TimeoutError, "group 10 did not terminate"):
                suite_process.terminate_posix_group(10, timeout=0)
        with patch.object(suite_process.os, "killpg", create=True), \
                patch.object(suite_process, "live_posix_group", side_effect=PermissionError("observation denied")):
            with self.assertRaisesRegex(PermissionError, "observation denied"):
                suite_process.terminate_posix_group(10)
        with patch.object(suite_process.os, "killpg", create=True) as kill:
            with self.assertRaises(ValueError):
                suite_process.terminate_posix_group(0)
        kill.assert_not_called()

    def test_cleanup_timeout_keeps_the_gate_failed_and_scratch_for_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            process = object.__new__(SuiteProcess)
            process.closed, process.job, process.log = False, None, None
            process.scratch = Path(directory) / "scratch"
            process.scratch.mkdir()
            process.proc = Mock(pid=10, stdin=None)
            process.proc.poll.return_value = 0
            with patch.object(suite_process.os, "name", "posix"), \
                    patch.object(suite_process, "terminate_posix_group", side_effect=TimeoutError("group still live")):
                with self.assertRaisesRegex(TimeoutError, "group still live"):
                    process.close()
            process.proc.wait.assert_called_once_with(timeout=10)
            self.assertFalse(process.closed)
            self.assertTrue(process.scratch.is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
