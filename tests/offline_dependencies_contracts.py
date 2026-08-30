from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def ok(condition, message: str):
    if condition:
        print('PASS', message)
    else:
        print('FAIL', message)
        errors.append(message)


package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
config = json.loads((ROOT / 'tools/offline-deps.json').read_text(encoding='utf-8'))
lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
source = (ROOT / 'tools/offline_deps.py').read_text(encoding='utf-8')
readme = (ROOT / 'vendor/offline/README.md').read_text(encoding='utf-8')
requirements = (ROOT / 'tests/requirements.txt').read_text(encoding='utf-8')
run_all = (ROOT / 'tests/run_all.py').read_text(encoding='utf-8')
browser_harness = (ROOT / 'tests/browser_harness.py').read_text(encoding='utf-8')
browser_probe = (ROOT / 'tests/offline_environment_probe.py').read_text(encoding='utf-8')
orders_launcher = (ROOT / '.01run orders.bat').read_text(encoding='utf-8')
kupa_launcher = (ROOT / '.02#U200f#U200frun kupa.bat').read_text(encoding='utf-8')

scripts = package.get('scripts', {})
expected_scripts = {
    'offline:download': 'python tools/offline_deps.py download',
    'offline:check': 'python tools/offline_deps.py check',
    'offline:doctor': 'python tools/offline_deps.py doctor',
    'offline:install': 'python tools/offline_deps.py install',
    'offline:update': 'python tools/offline_deps.py update',
    'offline:clean': 'python tools/offline_deps.py clean',
    'test:offline': 'python tools/offline_deps.py test',
    'test:chat': 'python tools/offline_deps.py chat-test',
    'lint:offline': 'python tools/offline_deps.py lint',
}
for name, command in expected_scripts.items():
    ok(scripts.get(name) == command, f'offline deps: package script {name} is stable and discoverable')

ok(config.get('profile') == 'chat-linux-x64-glibc', 'offline deps: profile is explicitly scoped to the ChatGPT Linux environment')
ok(config.get('platform') == {'system': 'Linux', 'machine': 'x86_64', 'libc': 'glibc'}, 'offline deps: native platform fails closed instead of pretending to be cross-platform')
node = config.get('node', {})
ok(node.get('version') == '24.18.0' and node.get('file') == 'node-v24.18.0-linux-x64.tar.xz', 'offline deps: repository-pinned Linux Node runtime is explicit')
ok(len(node.get('sha256', '')) == 64 and node.get('url', '').startswith('https://nodejs.org/dist/'), 'offline deps: Node archive has an HTTPS source and pinned SHA256')

py = config.get('python', [])
ok(len(py) == 1 and py[0].get('project') == 'websocket-client', 'offline deps: only the browser harness Python dependency is vendored')
ok(py and py[0].get('specifier') == '>=1.8,<2' and 'websocket-client>=1.8,<2' in requirements.replace(' ', ''), 'offline deps: Python offline policy matches tests/requirements.txt')

spec = importlib.util.spec_from_file_location('netunim_offline_deps', ROOT / 'tools/offline_deps.py')
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)
targets = module.npm_targets(lock)
lock_paths = {item['lockPath'] for item in targets}
expected_roots = {f'node_modules/{name}' for name in package.get('devDependencies', {})}
ok(expected_roots <= lock_paths, 'offline deps: every declared npm development dependency is in the lock-derived offline closure')
ok(all(item['url'].startswith('https://registry.npmjs.org/') and item['integrity'].startswith('sha') for item in targets), 'offline deps: npm archives are sourced from lockfile URLs with integrity metadata')
ok(len(targets) < 100, f'offline deps: focused npm closure stays small ({len(targets)} archives; no Vite/React/TypeScript toolchain copied)')

ok('tempfile.mkdtemp(prefix=".offline-stage-"' in source and 'os.replace(stage, VENDOR)' in source, 'offline deps: vendor refresh is staged before atomic replacement')
ok('shutil.rmtree(backup, ignore_errors=True)' in source and 'refresh_vendor()' in source, 'offline deps: superseded archives are removed only after a complete refresh')
ok('original_lock = LOCK_PATH.read_bytes()' in source and 'LOCK_PATH.write_bytes(original_lock)' in source, 'offline deps: failed online update rolls back dependency metadata')
ok('npm", "update", "--package-lock-only"' in source or '"update", "--package-lock-only"' in source, 'offline deps: update refreshes the lockfile without lifecycle-script installation')
ok('Chrome/Chromium itself is **not** vendored' in readme and 'policy can make' in readme, 'offline deps: system browser boundary and host-policy limitation are documented explicitly')
ok('Wrangler is also excluded' in readme, 'offline deps: deployment-only Wrangler is excluded from the verification vendor')
ok('OFFLINE_NODE_MODULES = INSTALL_ROOT / "node_modules"' in source and 'NODE_MODULES = ROOT / "node_modules"' not in source, 'offline deps: generated npm packages live only under .offline and never occupy normal node_modules')
ok('env["NETUNIM_OFFLINE_NODE_MODULES"] = offline_modules' in source and 'env["NODE_PATH"]' in source, 'offline deps: test processes resolve vendored CommonJS tools without mutating the normal npm workspace')
ok('shutil.rmtree(INSTALL_ROOT, ignore_errors=True)' in source and 'shutil.rmtree(NODE_MODULES' not in source, 'offline deps: clean/update can remove only .offline generated state')
ok('npm install' not in source and 'npm ci' not in source, 'offline deps: offline installer never resolves packages from npm')
ok('NETUNIM_BROWSER' in browser_harness, 'offline deps: browser harness supports an explicit unmanaged test-browser override')
ok('ERR_BLOCKED_BY_ADMINISTRATOR' in browser_probe and 'BROWSER_RUNTIME_UNAVAILABLE' in browser_probe, 'offline deps: environment doctor distinguishes host browser policy from application test failures')
ok('CORE_SUITES' in run_all and 'RUNTIME_SUITES' in run_all and '--core-only' in run_all, 'offline deps: chat repair mode can run deterministic core suites without weakening the full gate')
ok('chat_test()' in source and '"--core-only"' in source and 'probe_rc == 3' in source, 'offline deps: chat test falls back only for an explicitly unavailable browser runtime')
ok('args.command == "test"' in source and 'run_all.py")])' in source, 'offline deps: strict offline test still runs the complete verification gate')
ok('setlocal' in orders_launcher.lower() and 'setlocal' in kupa_launcher.lower(), 'windows local launchers: temporary environment changes are scoped to the launcher process')
ok('NO_UPDATE_CHECK=1' in orders_launcher and 'NO_UPDATE_CHECK=1' in kupa_launcher, 'windows local launchers: serve network update checks cannot delay normal startup')
ok('%~dp0netunim-orders\\site' in orders_launcher and '%~dp0netunim-kupa\\site' in kupa_launcher, 'windows local launchers: site roots are anchored to the BAT location rather than the caller working directory')
ok('pushd "%SITE_DIR%"' in orders_launcher and 'pushd "%SITE_DIR%"' in kupa_launcher, 'windows local launchers: drive-aware directory changes fail closed before serve starts')
ok('offline_deps.py' not in orders_launcher and 'offline_deps.py' not in kupa_launcher, 'windows local launchers: normal serving never enters the ChatGPT offline toolchain')

help_result = subprocess.run([sys.executable, str(ROOT / 'tools/offline_deps.py'), '--help'], cwd=ROOT, capture_output=True, text=True)
ok(help_result.returncode == 0 and all(word in help_result.stdout for word in ('download', 'doctor', 'install', 'test', 'chat-test', 'update')), 'offline deps: maintenance CLI is runnable with the system Python only')

if errors:
    print(f'\n{len(errors)} offline dependency contract(s) failed')
    raise SystemExit(1)
print('\nALL OFFLINE DEPENDENCY CONTRACTS PASSED')
