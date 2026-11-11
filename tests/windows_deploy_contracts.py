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
import sys
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

    def test_fast_upload_keeps_hebrew_paths_and_utf8_wrangler_output_readable(self):
        self.install_real_upload_tail()
        # Reproduce a Hebrew Windows locale inherited by captured Python output.
        # The public fast entrypoint must normalise child encodings itself.
        self.env['PYTHONUTF8'] = '0'
        self.env['PYTHONIOENCODING'] = 'cp1255'
        python_message = 'Verified path: C:\\Users\\יעקב\\אתרים\n'
        wrangler_message = 'Cloudflare: שלום — הועלה בהצלחה ☁\n'
        self.write('tools/github_verification.py',
                   'import os\nfrom pathlib import Path\n'
                   'with Path(os.environ["CI_CALLS"]).open("a") as log:log.write("remote\\n")\n'
                   f'print({python_message!r},end="")\n')
        codepoints = ','.join(str(ord(char)) for char in wrangler_message)
        self.write('tools/npx.cmd', '@echo off\n'
                   f'node -e "process.stdout.write(String.fromCodePoint({codepoints}))"\n'
                   'echo upload:%PROJECT_NAME%>>"%CI_CALLS%"\nexit /b 0\n')
        result, calls = self.run_bat('deploy_all_fast.bat', '')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn(python_message, result.stdout)
        self.assertEqual(result.stdout.count(wrangler_message), 2)
        self.assertNotIn('\ufffd', result.stdout)
        self.assertEqual(calls, ['remote', 'public', 'upload:bargig-orders', 'upload:bargig-kupa'])

    def test_actual_log_display_preserves_unicode_in_an_owned_oem_console(self):
        result = subprocess.run([sys.executable, str(ROOT/'tests/fixtures/deploy-console-unicode.py'),
                                 str(self.root), str(ROOT/'tools/deploy_site_core.bat')],
                                capture_output=True, encoding='utf8', errors='replace', timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn('PASS real deployment display', result.stdout)

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
    def test_real_setup_with_private_node_restores_the_previous_runtime_and_helpers(self):
        import ctypes
        from ctypes import wintypes
        from contextlib import contextmanager

        bridge = ROOT / 'netunim-kupa/bank-bridge'
        archive = ROOT / 'netunim-orders/document-bridge/node-v24.22.2-win-x64.zip'
        with tempfile.TemporaryDirectory(prefix='bank setup spaces ') as directory:
            base = Path(directory)
            source = base / 'source'
            source.mkdir()
            local = base / 'local'
            appdata = base / 'roaming'
            root = local / 'NetunimKupaBankBridge'
            active = root / 'app'
            backup = root / 'app-rollback'
            startup = appdata / 'Microsoft/Windows/Start Menu/Programs/Startup/NetunimKupaBankBridge.vbs'
            helper = root / 'rollback_bank_bridge.bat'
            system = Path(os.environ['SystemRoot'])
            env = {**os.environ, 'LOCALAPPDATA': str(local), 'APPDATA': str(appdata),
                   'USERPROFILE': str(base), 'PSModulePath': str(system / 'System32/WindowsPowerShell/v1.0/Modules'),
                   'PATH': os.pathsep.join(map(str, (
                       system / 'System32', system, system / 'System32/WindowsPowerShell/v1.0')))}
            self.assertIsNone(shutil.which('node.exe', path=env['PATH']))
            self.assertIsNone(shutil.which('npm.cmd', path=env['PATH']))
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]

            files = (bridge / 'runtime-files.txt').read_text().splitlines()
            for file in [*files, 'runtime-files.txt', 'setup-bank-bridge.mjs', 'setup_bank_bridge.ps1',
                         'install_node_runtime.ps1', 'install_bank_bridge.bat', 'rollback_bank_bridge.bat',
                         'launch_hidden.vbs']:
                shutil.copyfile(bridge / file, source / file)
            shutil.copyfile(archive, source / archive.name)
            # Provider downloads and live browser checks are outside this fixture.
            # Exercise the real Node provisioning, npm ci, setup, HTTP and drain.
            manifest = {'name': 'bank-setup-fixture', 'version': '1.0.0'}
            (source / 'package.json').write_text(json.dumps(manifest))
            (source / 'package-lock.json').write_text(json.dumps({
                **manifest, 'lockfileVersion': 3, 'packages': {'': manifest}}))
            (source / 'provision-camoufox.mjs').write_text('')
            server = (source / 'server.mjs').read_text(encoding='utf8').replace(
                'const PORT=8765;', f'const PORT={port};').replace(
                "if(args.has('--doctor')){", "if(args.has('--doctor'))process.exit(0);\nif(args.has('--doctor')){")
            (source / 'server.mjs').write_text(server, encoding='utf8')
            active.mkdir(parents=True)
            for name in files:
                shutil.copyfile(source / name, active / name)
            (active / 'server.mjs').write_text(server.replace('BRIDGE_VERSION=81;', 'BRIDGE_VERSION=80;'), encoding='utf8')
            (active / 'installation-id.txt').write_text('7' * 32)
            backup.mkdir()
            (backup / 'prior.txt').write_text('previous backup')
            startup.parent.mkdir(parents=True)
            startup.write_text('old launcher')
            helper.write_text('old helper')

            def run_bat(script, expected):
                output = base / 'setup-output.txt'
                with output.open('wb') as stream:
                    result = subprocess.run([str(system / 'System32/cmd.exe'), '/d', '/c', 'call', str(script)],
                                            env=env, cwd=base, stdin=subprocess.DEVNULL, stdout=stream,
                                            stderr=subprocess.STDOUT, timeout=100)
                details = output.read_text(encoding='utf8', errors='replace')
                self.assertEqual(result.returncode, expected, details)
                return details

            def request(target, token=None, body=None, origin=None):
                with_connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                headers = {}
                if token:
                    headers['Authorization'] = 'Bearer ' + token
                if origin:
                    headers['Origin'] = origin
                if body is not None:
                    headers['Content-Type'] = 'application/json'
                try:
                    with_connection.request('GET' if body is None else 'POST', target,
                                            None if body is None else json.dumps(body), headers)
                    response = with_connection.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    with_connection.close()

            def health(version):
                status, result = request('/health')
                self.assertEqual((status, result['version'], result['pairingProtocol']), (200, version, 1))
                self.assertEqual(result['installationId'], (active / 'installation-id.txt').read_text())
                return result

            @contextmanager
            def deny_delete(target, flags=0):
                kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                              wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
                kernel.CreateFileW.restype = wintypes.HANDLE
                kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                handle = kernel.CreateFileW(str(target), 0x80000000, 3, None, 3, flags, None)
                if handle == ctypes.c_void_p(-1).value:
                    raise ctypes.WinError(ctypes.get_last_error())
                try:
                    yield
                finally:
                    kernel.CloseHandle(handle)

            node = shutil.which('node.exe')
            self.assertIsNotNone(node)
            old = subprocess.Popen([node, 'server.mjs'], cwd=active, env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
            install = source / 'install_bank_bridge.bat'
            try:
                for attempt in range(60):
                    try:
                        health(80)
                        break
                    except OSError:
                        if attempt == 59:
                            raise
                        time.sleep(.1)
                # Missing source helpers must abort before shutting down v80.
                for name in ('launch_hidden.vbs', 'rollback_bank_bridge.bat'):
                    target = source / name
                    original = target.read_bytes()
                    target.unlink()
                    run_bat(install, 1)
                    target.write_bytes(original)
                    health(80)
                    self.assertIsNone(old.poll())

                # These are actual Windows rename failures after graceful stop.
                for target, flags in [(startup, 0), (helper, 0), (active, 0x02000000)]:
                    with deny_delete(target, flags):
                        result = run_bat(install, 1)
                        self.assertIn('restored and verified', result)
                    health(80)
                    self.assertEqual(startup.read_text(), 'old launcher')
                    self.assertEqual(helper.read_text(), 'old helper')
                    self.assertEqual((backup / 'prior.txt').read_text(), 'previous backup')

                # The candidate can pass doctor and fail at actual startup.
                bad_start = "if(process.argv.length===2)process.exit(91);\n"
                (source / 'server.mjs').write_text(bad_start + server, encoding='utf8')
                self.assertIn('restored and verified', run_bat(install, 1))
                health(80)
                self.assertEqual(startup.read_text(), 'old launcher')
                self.assertEqual(helper.read_text(), 'old helper')
                (source / 'server.mjs').write_text(server, encoding='utf8')

                # An unrelated listener must survive and block replacement.
                subprocess.run([node, 'server.mjs', '--stop-existing'], cwd=active, env=env,
                               check=True, capture_output=True, timeout=10)
                with socket.socket() as foreign:
                    foreign.bind(('127.0.0.1', port))
                    foreign.listen()
                    run_bat(install, 1)
                    self.assertEqual((active / 'installation-id.txt').read_text(), '7' * 32)
                    self.assertEqual(startup.read_text(), 'old launcher')

                run_bat(install, 0)
                installed = health(81)
                origins = ['https://kupa.bargig-furniture.com', 'https://orders.bargig-furniture.com']
                admin = (root / 'pairing-v1/admin-token.txt').read_text().strip()
                keys = []
                self.assertEqual(request('/pairing/admin', admin, {'action': 'begin'})[0], 200)
                for origin in origins:
                    status, issued = request('/pairing/admin', admin, {
                        'action': 'issue', 'origin': origin, 'permissions': ['bank.read']})
                    self.assertEqual(status, 200, issued)
                    status, grant = request('/pairing/exchange', body={'code': issued['code']}, origin=origin)
                    self.assertEqual(status, 200, grant)
                    keys.append(grant['token'])
                self.assertEqual(request('/pairing/admin', admin, {'action': 'finish'})[0], 200)
                registry = (root / 'pairing-v1/registry.json').read_bytes()
                for version in (80, 81):
                    run_bat(helper, 0)
                    health(version)
                    self.assertEqual((root / 'pairing-v1/registry.json').read_bytes(), registry)
                    for origin, key in zip(origins, keys):
                        self.assertEqual(request('/status', key, origin=origin)[0], 200)
                self.assertEqual(health(81)['installationId'], installed['installationId'])
            finally:
                subprocess.run([node, 'server.mjs', '--stop-existing'], cwd=active, env=env,
                               capture_output=True, timeout=10)
                if old.poll() is None:
                    old.kill()  # Only the owned synthetic test process.
                old.wait(timeout=10)


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
    def test_failed_activation_preserves_recovery_until_shutdown_is_confirmed(self):
        source = (ROOT/'netunim-orders/document-bridge/install_document_bridge.bat').read_text(encoding='utf8')
        start = source.index('\n:activate_error\n')
        end = source.index('\n:move_dir_with_retry\n', start)
        block = source[start:end].replace('start "" wscript.exe "%AUTOSTART%"', 'echo restarted>>"%CI_CALLS%"')
        for stop_exit in (1, 0):
            with self.subTest(stop_exit=stop_exit), tempfile.TemporaryDirectory(prefix='document rollback spaces ') as scratch:
                base = Path(scratch)
                runtime = base/'new runtime'
                runtime.mkdir()
                (runtime/'server.mjs').write_text("import fs from 'node:fs';fs.appendFileSync(process.env.CI_CALLS,'stop\\n');process.exit(Number(process.env.STOP_EXIT));")
                script = base/'verify.bat'
                script.write_text('@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n'+block+
                                  '\n:restore_state\necho restored>>"%CI_CALLS%"\nexit /b 0\n', newline='\r\n')
                log = base/'calls.txt'
                node = shutil.which('node.exe')
                self.assertIsNotNone(node)
                env = {**os.environ, 'APPROOT': str(base), 'RUNTIME': str(runtime), 'NODE_EXE': node,
                       'CI_CALLS': str(log), 'STOP_EXIT': str(stop_exit)}
                result = subprocess.run(['cmd.exe','/d','/c','call',str(script)], cwd=base, env=env,
                                        input='\n'*4, capture_output=True, encoding='utf8', errors='replace', timeout=10)
                self.assertEqual(result.returncode, 1, result.stdout+result.stderr)
                self.assertEqual(runtime.exists(), bool(stop_exit))
                self.assertEqual(log.read_text().splitlines(), ['stop'] if stop_exit else ['stop','restored','restarted'])

    def test_native_preview_resolves_actual_browser_viewport(self):
        compiler = Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        with tempfile.TemporaryDirectory(prefix='netunim-viewport-') as directory:
            binary = Path(directory)/'viewport-tests.exe'
            result = subprocess.run([str(compiler), '/nologo', '/target:exe', '/main:NetunimPreview.ViewportGeometryTests',
                '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
                '/out:'+str(binary), str(ROOT/'netunim-orders/document-bridge/native_preview_host.cs'),
                str(ROOT/'tests/fixtures/native_preview_viewport.cs')],capture_output=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode,0,(result.stdout+result.stderr).decode('utf8',errors='replace'))
            result = subprocess.run([str(binary)],capture_output=True,timeout=20,creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode,0,(result.stdout+result.stderr).decode('utf8',errors='replace'))

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
            marker = runtime / "installation-id.txt"
            marker.write_text("a" * 32, encoding="ascii")
            staged_lib = runtime / "lib.mjs"
            lib_source = staged_lib.read_text(encoding="utf8")
            self.assertEqual(lib_source.count("BRIDGE_PORT=8766;"), 1)
            staged_lib.write_text(lib_source.replace("BRIDGE_PORT=8766;", f"BRIDGE_PORT={test_port};"), encoding="utf8")
            private_name = "node-v24.22.2-win-x64-20261011-000000-1-1234abcd"
            private = app / private_name
            private.mkdir()
            with zipfile.ZipFile(source / "node-v24.22.2-win-x64.zip") as archive:
                binary = archive.read("node-v24.22.2-win-x64/node.exe")
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
                check_args = [str(executable), str(runtime / "server.mjs"), "--check-running"]
                startup = subprocess.run([*check_args, "--wait-for-startup"], env=env, cwd=app,
                                         stdin=subprocess.DEVNULL, capture_output=True, timeout=18,
                                         creationflags=subprocess.CREATE_NO_WINDOW)
                self.assertEqual(startup.returncode, 0, startup.stderr.decode("utf8", errors="replace"))
                status, health, _ = request("/health")
                self.assertEqual(status, 200)
                self.assertEqual(health["service"], "netunim-orders-document-bridge")
                self.assertEqual(health["version"], 48)
                self.assertEqual(health["pid"], process.pid)
                self.assertEqual(health["pairingProtocol"], 1)
                self.assertEqual(health["installationId"], "a" * 32)
                for expected, code in (("a" * 32, 0), ("b" * 32, 1)):
                    marker.write_text(expected, encoding="ascii")
                    check = subprocess.run(check_args, env=env, cwd=app, capture_output=True,
                                           timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                    self.assertEqual(check.returncode, code, check.stderr.decode("utf8", errors="replace"))
                    if code:
                        self.assertIn(b"An older instance may still be running", check.stderr)
                self.assertEqual(request("/health")[1]["installationId"], "a" * 32)
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
