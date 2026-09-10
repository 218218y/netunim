"""Execute real BAT control flow in disposable copies with all uploads stubbed."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Actual cmd.exe coverage runs in the required Windows CI job")
class WindowsDeploymentContracts(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="netunim deploy spaces ")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        for name in ("tools", "tests", "netunim-orders", "netunim-kupa"):
            (self.root / name).mkdir()
        for name in ("deploy_all.bat", "deploy_all_fast.bat", "tools/deploy_fast_core.bat",
                     "netunim-orders/deploy_site.bat", "netunim-orders/deploy_site_fast.bat",
                     "netunim-kupa/deploy_site.bat", "netunim-kupa/deploy_site_fast.bat"):
            shutil.copyfile(ROOT / name, self.root / name)
        self.log = self.root / "calls.txt"
        self.env = {**os.environ, "CI_CALLS": str(self.log), "LOCAL_EXIT": "0", "REMOTE_EXIT": "0", "PUBLIC_EXIT": "0",
                    "FAIL_SITE": "none", "NETUNIM_DEPLOY_VERIFIED": ""}
        self.write("verify.bat", '@echo off\necho local>>"%CI_CALLS%"\nexit /b %LOCAL_EXIT%\n')
        self.write("tools/deploy_site_core.bat", '@echo off\nif not "%NETUNIM_DEPLOY_VERIFIED%"=="1" exit /b 99\necho %~2:%~6>>"%CI_CALLS%"\nif "%~2"=="%FAIL_SITE%" exit /b 17\nexit /b 0\n')
        for path, label, code in (("tools/github_verification.py", "remote", "REMOTE_EXIT"), ("tests/deploy_preflight.py", "public", "PUBLIC_EXIT")):
            self.write(path, f"import os\nfrom pathlib import Path\nwith Path(os.environ['CI_CALLS']).open('a') as f: f.write('{label}\\n')\nraise SystemExit(int(os.environ['{code}']))\n")

    def write(self, name, text):
        (self.root / name).write_text(text, encoding="utf8", newline="\r\n" if name.endswith(".bat") else None)

    def run_bat(self, name, mode="--preflight-only"):
        self.log.unlink(missing_ok=True)
        result = subprocess.run(["cmd.exe", "/d", "/c", "call", str(self.root / name), mode],
                                cwd=self.root.parent, env=self.env, input="\n" * 8, capture_output=True,
                                encoding="utf8", errors="replace", timeout=30)
        calls = self.log.read_text().splitlines() if self.log.exists() else []
        return result, calls

    def test_normal_entrypoints_still_verify_once_and_propagate_failure(self):
        for name, sites in (("deploy_all.bat", ["orders", "kupa"]), ("netunim-orders/deploy_site.bat", ["orders"]), ("netunim-kupa/deploy_site.bat", ["kupa"])):
            with self.subTest(name=name):
                result, calls = self.run_bat(name)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(calls, ["local", *[f"bargig-{site}:--preflight-only" for site in sites]])
                self.env["LOCAL_EXIT"] = "8"
                result, calls = self.run_bat(name)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, ["local"])
                self.env["LOCAL_EXIT"] = "0"

    def test_fast_entrypoints_use_remote_gate_and_only_selected_sites(self):
        for name, sites in (("deploy_all_fast.bat", ["orders", "kupa"]), ("netunim-orders/deploy_site_fast.bat", ["orders"]), ("netunim-kupa/deploy_site_fast.bat", ["kupa"])):
            with self.subTest(name=name):
                result, calls = self.run_bat(name)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(calls, ["remote", "public", *[f"bargig-{site}:--preflight-only" for site in sites]])

    def test_fast_upload_preflights_both_sites_before_uploading_either(self):
        result, calls = self.run_bat("deploy_all_fast.bat", "")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ["remote", "public", "bargig-orders:--preflight-only", "bargig-kupa:--preflight-only", "bargig-orders:", "bargig-kupa:"])
        self.env["FAIL_SITE"] = "bargig-kupa"
        result, calls = self.run_bat("deploy_all_fast.bat", "")
        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
        self.assertFalse(any(call.endswith(":") for call in calls))

    def test_fast_failures_stop_before_site_engine(self):
        for code, expected in (("REMOTE_EXIT", ["remote"]), ("PUBLIC_EXIT", ["remote", "public"])):
            self.env[code] = "6"
            result, calls = self.run_bat("deploy_all_fast.bat")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, expected)
            self.env[code] = "0"

    def test_invalid_option_fails_before_any_gate_or_upload(self):
        result, calls = self.run_bat("deploy_all_fast.bat", "--unknown")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])

    def test_real_internal_engine_rejects_direct_unverified_invocation(self):
        shutil.copyfile(ROOT / "tools/deploy_site_core.bat", self.root / "tools/deploy_site_core.bat")
        result, calls = self.run_bat("tools/deploy_site_core.bat", "")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
