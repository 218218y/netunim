"""Execute real BAT control flow in disposable copies with all uploads stubbed."""
import os
import hashlib
import http.client
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import zipfile
from run_all import run_suites

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Actual cmd.exe coverage runs in the required Windows CI job")
class WindowsDeploymentContracts(unittest.TestCase):
    def test_windows_native_bank_vault_and_provider_stub_acceptance(self):
        # Each staged native fixture owns an ephemeral port/LOCALAPPDATA and
        # supplies inert provider modules. No installed service is contacted.
        suites = ['bank_bridge_runtime', 'bank_provider_native', 'credit_adapter_native',
                  'bank_shutdown_native', 'bank_artifact_shutdown_native', 'bank_image_shutdown_native']
        result = subprocess.run(['node', '--test', '--test-concurrency=2',
                                 *['tests/'+name+'.test.mjs' for name in suites]], cwd=ROOT,
                                capture_output=True, text=True, encoding='utf8', errors='replace', timeout=180)
        print(result.stdout, flush=True)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)

    def test_windows_real_browser_recovery_and_pwa_acceptance(self):
        suites = ['runtime_browser_isolation.py', 'runtime_backup_browser_resources.py',
                  'runtime_restore_server_recovery.py', 'runtime_pwa.py', 'runtime_release_compatibility.py']
        result = run_suites(suites, keep_going=True, report_dir=ROOT/'.work/ci/windows-acceptance',
                            label='windows-isolated-acceptance', jobs=1, browser_jobs=1)
        self.assertEqual(result, 0, 'see .work/ci/windows-acceptance for native browser evidence')

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
                                encoding="utf8", errors="replace", timeout=90)
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

    def install_real_upload_tail(self):
        source = (ROOT/'tools/deploy_site_core.bat').read_text(encoding='utf8')
        tail = source[source.index('call npx --yes'):]
        self.write('tools/deploy_site_core.bat', '@echo off\nsetlocal\n'
                   'if not "%NETUNIM_DEPLOY_VERIFIED%"=="1" exit /b 99\n'
                   'if /I "%~6"=="--preflight-only" exit /b 0\n'
                   'set "PROJECT_NAME=%~2"\nset "SITE_DIR=%~1\\site"\n'
                   'set "DEPLOY_WORK_DIR=%~dp0..\\isolated-upload"\nmkdir "%DEPLOY_WORK_DIR%" >nul 2>&1\n'+tail)
        self.write('tools/deployment-receipt.py', 'raise SystemExit(0)\n')
        (self.root/'isolated-upload').mkdir(exist_ok=True)
        self.write('tools/npx.cmd', '@echo off\necho upload:%PROJECT_NAME%>>"%CI_CALLS%"\n'
                   'if "%PROJECT_NAME%"=="%FAIL_UPLOAD_SITE%" exit /b 7\nexit /b 0\n')
        self.env['PATH'] = str(self.root/'tools')+os.pathsep+self.env['PATH']
        self.env['FAIL_UPLOAD_SITE'] = 'none'

    def test_all_entrypoints_complete_uploads_without_public_http_access(self):
        self.install_real_upload_tail()
        for name, gates, sites in (
            ('deploy_all.bat', ['local'], ['orders', 'kupa']),
            ('deploy_all_fast.bat', ['remote', 'public'], ['orders', 'kupa']),
            ('netunim-orders/deploy_site.bat', ['local'], ['orders']),
            ('netunim-orders/deploy_site_fast.bat', ['remote', 'public'], ['orders']),
            ('netunim-kupa/deploy_site.bat', ['local'], ['kupa']),
            ('netunim-kupa/deploy_site_fast.bat', ['remote', 'public'], ['kupa']),
        ):
            with self.subTest(name=name):
                result, calls = self.run_bat(name, '')
                self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
                self.assertEqual(calls, gates+[f'upload:bargig-{site}' for site in sites])
                for site in sites:
                    self.assertIn(f'https://{site}.bargig-furniture.com/', result.stdout)
                for absent in {'orders', 'kupa'}-set(sites):
                    self.assertNotIn(f'https://{absent}.bargig-furniture.com/', result.stdout)
                self.assertNotIn('.pages.dev', result.stdout)
                self.assertNotIn('Public HTTP verification', result.stdout)

    def test_paired_upload_failures_still_stop_and_propagate_wrangler_exit(self):
        self.install_real_upload_tail()
        for name, gates in [('deploy_all.bat', ['local']), ('deploy_all_fast.bat', ['remote', 'public'])]:
            for failed, uploaded in [('orders', ['orders']), ('kupa', ['orders', 'kupa'])]:
                with self.subTest(name=name, failed=failed):
                    self.env['FAIL_UPLOAD_SITE'] = 'bargig-'+failed
                    result, calls = self.run_bat(name, '')
                    self.assertEqual(result.returncode, 7, result.stdout+result.stderr)
                    self.assertEqual(calls, gates+[f'upload:bargig-{site}' for site in uploaded])
                    self.assertIn('Deployment failed. Wrangler exit code: 7', result.stdout)
                    self.assertEqual(result.stdout.count('Deployment completed successfully.'), len(uploaded)-1)

    def test_upload_and_receipt_use_the_selected_retained_release(self):
        release = 'orders-app-shell-build-' + 'a'*24
        source = (ROOT/'tools/deploy_site_core.bat').read_text(encoding='utf8')
        block = source[source.index('rem Bind the upload'):]
        self.write('tools/frozen-upload.bat', '@echo off\nsetlocal\n'
                   'set "BUILD_APP=orders"\nset "PROJECT_NAME=bargig-orders"\n'
                   'set "DEPLOY_WORK_DIR=%~dp0..\\isolated-upload"\n'
                   'mkdir "%DEPLOY_WORK_DIR%" >nul 2>&1\n' + block)
        self.write('tools/deployment-receipt.py',
                   "import os,sys\nfrom pathlib import Path\n"
                   f"release={release!r}\n"
                   "if sys.argv[1]=='prepare':Path(sys.argv[3]).write_text(release,encoding='ascii')\n"
                   "else:\n assert sys.argv[-1]==release\n with Path(os.environ['CI_CALLS']).open('a') as log:log.write('record:'+sys.argv[-1]+'\\n')\n")
        self.write('tools/npx.cmd', '@echo off\necho upload:%SITE_DIR%>>"%CI_CALLS%"\nexit /b 0\n')
        self.env['PATH'] = str(self.root/'tools')+os.pathsep+self.env['PATH']
        result, calls = self.run_bat('tools/frozen-upload.bat', '')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(Path(calls[0].removeprefix('upload:')).resolve(), (self.root/'.work/releases/orders'/release/'site').resolve())
        self.assertEqual(calls[1], 'record:'+release)

    def test_real_engine_database_gate_runs_before_preflight_success_and_stops_both_sites(self):
        shutil.copyfile(ROOT/'tools/deploy_site_core.bat', self.root/'tools/deploy_site_core.bat')
        shutil.copyfile(ROOT/'tools/wrangler-version.txt', self.root/'tools/wrangler-version.txt')
        shutil.copyfile(ROOT/'tools/pdfjs-runtime.py', self.root/'tools/pdfjs-runtime.py')
        shutil.copyfile(ROOT/'tools/pdfjs-runtime-lock.json', self.root/'tools/pdfjs-runtime-lock.json')
        shutil.copyfile(ROOT/'tools/document-viewers-runtime.py', self.root/'tools/document-viewers-runtime.py')
        shutil.copyfile(ROOT/'tools/public_js_guard.py', self.root/'tools/public_js_guard.py')
        shutil.copyfile(ROOT/'tools/public_asset_names.py', self.root/'tools/public_asset_names.py')
        config = self.root/'shared/document-search/domains/documents/pdfjs-runtime-config.js'
        config.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/'shared/document-search/domains/documents/pdfjs-runtime-config.js', config)
        shutil.copytree(ROOT/'netunim-orders/document-bridge/pdfjs', self.root/'netunim-orders/document-bridge/pdfjs')
        for app in ('orders', 'kupa'):
            shutil.copytree(ROOT/f'netunim-{app}/site', self.root/f'netunim-{app}/site')
        # Actual production payloads have their own native browser and integrity
        # gates. Here tiny build/output stubs expose the BAT's ordering and target
        # selection without repeating compilation in every source failure case.
        self.write('tools/production-build.mjs', "import fs from 'node:fs';import path from 'node:path';const app=process.argv[2];fs.appendFileSync(process.env.CI_CALLS,'build:'+app+'\\n');process.exit(Number(process.env.BUILD_EXIT||0));\n")
        self.write('tools/verify-build.py', "import os,sys\nfrom pathlib import Path\nwith Path(os.environ['CI_CALLS']).open('a') as f:f.write('output:'+sys.argv[1]+'\\n')\nraise SystemExit(int(os.environ.get('OUTPUT_EXIT','0')))\n")
        self.write('tools/supabase_deploy_gate.py', "import os\nfrom pathlib import Path\nwith Path(os.environ['CI_CALLS']).open('a') as f: f.write('database\\n')\nraise SystemExit(int(os.environ['DATABASE_EXIT']))\n")
        self.env['DATABASE_EXIT'] = '2'
        result, calls = self.run_bat('deploy_all_fast.bat')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ['remote', 'public', 'build:orders', 'output:orders', 'database'], result.stdout + result.stderr)
        self.assertIn('No site was uploaded', result.stdout)
        self.env['DATABASE_EXIT'] = '0'
        result, calls = self.run_bat('deploy_all_fast.bat')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ['remote', 'public', 'build:orders', 'output:orders', 'database', 'build:kupa', 'output:kupa', 'database'], result.stdout + result.stderr)
        self.assertNotIn('Deploying the verified static site', result.stdout)

        for failure, expected in [('BUILD_EXIT', ['build:orders']), ('OUTPUT_EXIT', ['build:orders', 'output:orders'])]:
            self.env[failure] = '2'
            result, calls = self.run_bat('deploy_all_fast.bat')
            self.assertNotEqual(result.returncode, 0, result.stdout+result.stderr)
            self.assertEqual(calls, ['remote', 'public', *expected])
            self.env[failure] = '0'

        vendor = self.root/'netunim-orders/site/assets/vendor/document-viewers/jszip/jszip.min.js'
        original_vendor = vendor.read_bytes()
        vendor.write_bytes(original_vendor + b'\n// tampered\n')
        result, calls = self.run_bat('deploy_all_fast.bat')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ['remote', 'public'])
        self.assertIn('runtime integrity verification failed', result.stdout)
        vendor.write_bytes(original_vendor)

        unsafe = self.root/'netunim-orders/site/assets/js/nested/unsafe.js'
        unsafe.parent.mkdir(parents=True, exist_ok=True)
        for source in ("eval('1')", "new Function('return 1')"):
            unsafe.write_text(source, encoding='utf8')
            result, _ = self.run_bat('deploy_all_fast.bat')
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('dynamic code', result.stdout)


@unittest.skipUnless(os.name == "nt", "Actual cmd.exe coverage runs in the required Windows CI job")
class WindowsBankInstallerRollbackContracts(unittest.TestCase):
    def test_startup_failure_cannot_swap_a_runtime_without_confirmed_shutdown(self):
        source = (ROOT/'netunim-kupa/bank-bridge/install_bank_bridge.bat').read_text(encoding='utf8')
        start = source.index('if errorlevel 1 (', source.index('start "" wscript.exe "%AUTOSTART%"'))
        end = source.index('\nif exist "%APPROOT%\\bridge-token.txt"', start)
        block = source[start:end].replace('start "" wscript.exe "%AUTOSTART%"', 'echo restarted>>"%CI_CALLS%"')
        for stop_exit in (1, 0):
            with self.subTest(stop_exit=stop_exit), tempfile.TemporaryDirectory(prefix='bank rollback spaces ') as scratch:
                base = Path(scratch)
                for name in ('app', 'app-rollback', 'app-failed'):
                    (base/name).mkdir()
                    (base/name/'marker.txt').write_text(name)
                (base/'app/server.mjs').write_text("import fs from 'node:fs';fs.appendFileSync(process.env.CI_CALLS,'stop\\n');process.exit(Number(process.env.STOP_EXIT));")
                script = base/'verify.bat'
                script.write_text('@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n'
                                  'node -e "process.exit(1)"\n'+block, newline='\r\n')
                log = base/'calls.txt'
                env = {**os.environ, 'APPROOT': str(base), 'APPDIR': str(base/'app'), 'APPBACKUP': str(base/'app-rollback'),
                       'APPFAILED': str(base/'app-failed'), 'AUTOSTART': 'unused', 'CI_CALLS': str(log), 'STOP_EXIT': str(stop_exit)}
                result = subprocess.run(['cmd.exe','/d','/c','call',str(script)], cwd=base, env=env,
                                        input='\n'*4, capture_output=True, encoding='utf8', errors='replace', timeout=10)
                self.assertEqual(result.returncode, 1, result.stdout+result.stderr)
                if stop_exit:
                    for name in ('app','app-rollback','app-failed'):
                        self.assertEqual((base/name/'marker.txt').read_text(), name)
                    self.assertEqual(log.read_text().splitlines(), ['stop'])
                else:
                    self.assertEqual((base/'app/marker.txt').read_text(), 'app-rollback')
                    self.assertEqual((base/'app-failed/marker.txt').read_text(), 'app')
                    self.assertEqual(log.read_text().splitlines(), ['stop','restarted'])


@unittest.skipUnless(os.name == "nt", "CurrentUser DPAPI vault coverage runs in the required Windows CI job")
class WindowsBankVaultContracts(unittest.TestCase):
    def test_native_configuration_vault_and_current_user_protection(self):
        # Both vault and staged-runtime fixtures invoke real CurrentUser DPAPI.
        # Serialise those files to avoid competing PowerShell cold starts on a
        # shared runner; retain endpoint deadlines and a bounded worker pool.
        groups = [
            ["bank_connection_vault", "bank_bridge_runtime"],
            ["bank_shutdown_native", "bank_provider_native", "credit_adapter_native",
             "bank_image_shutdown_native", "bank_local_cache", "bank_artifact_shutdown_native",
             "bank_artifact_publication", "bank_artifact_owner"],
        ]
        output = ""
        for concurrency, names in zip((1, 2), groups):
            result = subprocess.run(["node", "--test", f"--test-concurrency={concurrency}",
                                     *[str(ROOT / f"tests/{name}.test.mjs") for name in names]],
                                    cwd=ROOT, capture_output=True, timeout=90,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            batch = (result.stdout + result.stderr).decode("utf8", errors="replace")
            self.assertEqual(result.returncode, 0, batch)
            output += batch
        self.assertIn("Windows CurrentUser DPAPI round-trips", output)
        self.assertIn("staged Bank runtime starts", output)
        self.assertIn("native shutdown retains an accepted vault deletion", output)
        self.assertIn("actual replacement CLI refuses", output)
        self.assertIn("native Bank provider composition", output)
        self.assertIn("native staged Credit composition", output)
        self.assertIn("native shutdown retains an accepted image read", output)
        self.assertIn("native shutdown retains an accepted artifact read", output)
        self.assertIn("native shutdown retains an accepted diagnostic summary", output)
        self.assertIn("failed temporary metadata write leaves no unowned image bytes", output)
        self.assertNotIn("# SKIP", output)


@unittest.skipUnless(os.name == "nt", "Production Document Bridge startup runs in the required Windows CI job")
class WindowsDocumentBridgeRuntimeContracts(unittest.TestCase):
    def test_staged_runtime_uses_its_http_modules_and_preserves_private_file_gates(self):
        # Only the copied runtime's port changes. A working installation no
        # longer prevents this native test or participates in its shutdown.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            test_port = probe.getsockname()[1]
        source = ROOT / "netunim-orders/document-bridge"
        with tempfile.TemporaryDirectory(prefix="netunim bridge stage ") as directory:
            app = Path(directory)
            runtime = app / "app-staging-test"
            runtime.mkdir()
            installer = (source / "install_document_bridge.bat").read_text(encoding="utf8")
            staged = re.search(r"for %%F in \((server\.mjs[^)]+)\)", installer).group(1).split()
            for name in staged:
                shutil.copyfile(source / name, runtime / name)
            staged_lib = runtime / "lib.mjs"
            lib_source = staged_lib.read_text(encoding="utf8")
            self.assertEqual(lib_source.count("BRIDGE_PORT=8766;"), 1)
            staged_lib.write_text(lib_source.replace("BRIDGE_PORT=8766;", f"BRIDGE_PORT={test_port};"), encoding="utf8")
            private_name = "node-v24.21.0-win-x64-20261011-000000-1-1234abcd"
            private = app / private_name
            private.mkdir()
            with zipfile.ZipFile(source / "node-v24.21.0-win-x64.zip") as archive:
                binary = archive.read("node-v24.21.0-win-x64/node.exe")
            expected = re.search(r"BRIDGE_NODE_WIN_X64_SHA256='([a-f0-9]+)'", (source / "lib.mjs").read_text(encoding="utf8")).group(1)
            self.assertEqual(hashlib.sha256(binary).hexdigest(), expected)
            executable = private / "node.exe"
            executable.write_bytes(binary)
            (app / "node-runtime.txt").write_text(private_name, encoding="utf8")
            # Node rejects ES-only argv with exit 9, rather than Everything's
            # not-running exit 8. No real Everything lookup/start or file access.
            fake_es = app / "not-everything.exe"
            shutil.copyfile(executable, fake_es)
            env = {**os.environ, "NETUNIM_DOCUMENT_BRIDGE_HOME": str(app),
                   "NETUNIM_EVERYTHING_ES_PATH": str(fake_es)}
            init = subprocess.run([str(executable), str(runtime / "server.mjs"), "--init"],
                                  env=env, cwd=app, capture_output=True, timeout=15,
                                  creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(init.returncode, 0, init.stderr.decode("utf8", errors="replace"))
            token = (app / "bridge-token.txt").read_text().strip()
            process = subprocess.Popen([str(executable), str(runtime / "server.mjs")],
                                       env=env, cwd=app, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       creationflags=subprocess.CREATE_NO_WINDOW)

            def request(target, method="GET", body=None, headers=None):
                connection = http.client.HTTPConnection("127.0.0.1", test_port, timeout=3)
                try:
                    connection.request(method, target, body=body, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, json.loads(response.read()), dict(response.getheaders())
                finally:
                    connection.close()

            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        status, health, _ = request("/health")
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            self.fail("Staged Document Bridge did not start its listener")
                        # Readiness probing only, never a synchronization fence.
                        time.sleep(0.025)
                self.assertEqual(status, 200)
                self.assertEqual(health["service"], "netunim-orders-document-bridge")
                self.assertEqual(health["version"], 45)
                self.assertEqual(health["pid"], process.pid)
                status, data, _ = request("/health", headers={"Origin": "https://untrusted.example"})
                self.assertEqual((status, data["code"]), (403, "ORIGIN_NOT_ALLOWED"))
                for target in ("/documents/delete", "/documents/preview-file", "/shutdown"):
                    status, data, _ = request(target, "POST", '{}')
                    self.assertEqual((status, data["code"]), (401, "UNAUTHORIZED"))
                auth = {"Authorization": f"Bearer {token}", "Origin": "https://bargig-furniture.com"}
                status, data, headers = request("/documents/open", "POST", json.dumps({"id": "unknown-result", "path": str(app / "must-not-open")}), auth)
                self.assertEqual((status, data["code"]), (410, "RESULT_EXPIRED"))
                self.assertEqual(headers["Access-Control-Allow-Origin"], "https://bargig-furniture.com")
                self.assertEqual(headers["Cache-Control"], "no-store")
                status, data, _ = request("/shutdown", "POST", '{}', auth)
                self.assertEqual(status, 200)
                self.assertTrue(data["ok"])
                self.assertEqual(data["pid"], process.pid)
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, (stdout + stderr).decode("utf8", errors="replace"))
                self.assertEqual((app / "bridge-token.txt").read_text().strip(), token)
                self.assertTrue((app / "config.json").is_file())
                build = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                        "-File", str(source / "build_native_preview.ps1"),
                                        "-Source", str(source / "native_preview_host.cs"),
                                        "-Output", str(runtime / "NetunimPreviewHost.exe")],
                                       cwd=app, capture_output=True, timeout=30,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
                self.assertEqual(build.returncode, 0, (build.stdout + build.stderr).decode("utf8", errors="replace"))
                native = subprocess.run([str(executable), str(ROOT / "tests/fixtures/native_preview_windows_smoke.mjs"),
                                         str(runtime), str(app)], cwd=app, capture_output=True, timeout=30,
                                        creationflags=subprocess.CREATE_NO_WINDOW)
                self.assertEqual(native.returncode, 0, (native.stdout + native.stderr).decode("utf8", errors="replace"))
                self.assertIn(b"PASS native C# preview host", native.stdout)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
