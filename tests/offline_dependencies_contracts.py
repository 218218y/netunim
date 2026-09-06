from __future__ import annotations

import importlib.util
import io
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def ok(condition, message: str):
    if condition:
        print('PASS', message)
    else:
        print('FAIL', message)
        errors.append(message)


def _visible_launcher_name(name: str) -> str:
    # Directionality/format characters can be preserved, stripped, or serialized by
    # archive/upload tooling as literal #Uxxxx markers. They are not part of the
    # semantic launcher name, so normalize only markers that decode to Unicode Cf.
    def strip_serialized_format(match: re.Match[str]) -> str:
        try:
            char = chr(int(match.group(1), 16))
        except (TypeError, ValueError, OverflowError):
            return match.group(0)
        return '' if unicodedata.category(char) == 'Cf' else match.group(0)

    normalized = re.sub(r'#U([0-9A-Fa-f]{4,6})', strip_serialized_format, name)
    return ''.join(ch for ch in normalized if unicodedata.category(ch) != 'Cf').casefold()


def _read_launcher(expected_visible_name: str) -> str:
    expected = expected_visible_name.casefold()
    matches = [path for path in ROOT.glob('*.bat') if _visible_launcher_name(path.name) == expected]
    ok(len(matches) == 1, f'windows local launchers: exactly one {expected_visible_name} launcher is discoverable')
    if len(matches) != 1:
        return ''
    return matches[0].read_text(encoding='utf-8')


def _write_tar(path: Path, files: dict[str, tuple[bytes, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, 'w:gz') as archive:
        for name, (payload, mode) in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = mode
            archive.addfile(info, io.BytesIO(payload))


def _exercise_external_cache(module) -> None:
    """Use tiny local archives to verify cache behavior without unpacking real Node."""
    original_vendor = module.VENDOR
    original_manifest = module.MANIFEST_PATH
    original_legacy = module.LEGACY_INSTALL_ROOT
    original_check_platform = module.check_platform
    original_check_vendor = module.check_vendor
    previous_cache = os.environ.get(module.CACHE_DIR_ENV)

    with tempfile.TemporaryDirectory(prefix='netunim-offline-contract-') as scratch_text:
        scratch = Path(scratch_text)
        vendor = scratch / 'vendor'
        cache = scratch / 'cache'
        manifest_path = vendor / 'manifest.json'
        legacy = scratch / 'legacy-dot-offline'
        normal_modules = scratch / 'normal-node-modules'
        normal_modules.mkdir()
        sentinel = normal_modules / 'KEEP.txt'
        sentinel.write_text('normal npm workspace', encoding='utf-8')

        node_archive = vendor / 'node/node.tar.gz'
        npm_archive = vendor / 'npm/eslint.tgz'
        _write_tar(node_archive, {
            'node-v1.2.3-linux-x64/bin/node': (b'#!/bin/sh\necho v1.2.3\n', 0o755),
        })
        _write_tar(npm_archive, {
            'package/bin/eslint.js': (b'// tiny eslint contract\n', 0o644),
            'package/package.json': (b'{"name":"eslint"}\n', 0o644),
        })
        manifest = {
            'schema': 1,
            'profile': 'contract-linux-x64-glibc',
            'node': {'version': '1.2.3', 'file': 'node/node.tar.gz'},
            'npm': [{'lockPath': 'node_modules/eslint', 'file': 'npm/eslint.tgz'}],
            'python': [],
        }
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')

        try:
            module.VENDOR = vendor
            module.MANIFEST_PATH = manifest_path
            module.LEGACY_INSTALL_ROOT = legacy
            module.check_platform = lambda: None
            module.check_vendor = lambda quiet=False: manifest
            os.environ[module.CACHE_DIR_ENV] = str(cache)
            legacy.mkdir()
            (legacy / 'old-generated.txt').write_text('legacy generated state', encoding='utf-8')

            module.install()
            root = module.install_root(manifest)
            ok(not legacy.exists(), 'offline deps: successful external install removes the old in-repository generated tree')
            ok(root.is_dir() and root.is_relative_to(cache), 'offline deps: generated install is published under the external cache root')
            ok(not root.is_relative_to(ROOT), 'offline deps: generated install cannot become part of repository copies or patches')
            ok((root / 'node/bin/node').is_file() and (root / 'node_modules/eslint/bin/eslint.js').is_file(), 'offline deps: staged cache publish contains the required Node and npm tools')

            first_stamp_mtime = (root / 'stamp.json').stat().st_mtime_ns
            module.install()
            ok((root / 'stamp.json').stat().st_mtime_ns == first_stamp_mtime, 'offline deps: identical manifest reuses the existing content-addressed install')

            (root / 'node_modules/eslint/bin/eslint.js').unlink()
            module.install()
            ok((root / 'node_modules/eslint/bin/eslint.js').is_file(), 'offline deps: incomplete/corrupt cache entry is rebuilt transactionally')

            env = module.offline_env(manifest)
            ok(Path(env['NETUNIM_OFFLINE_NODE_MODULES']) == root / 'node_modules' and Path(env['NETUNIM_OFFLINE_INSTALL_ROOT']) == root, 'offline deps: child verification processes receive the external cache paths explicitly')

            legacy.mkdir()
            (legacy / 'old.txt').write_text('legacy generated state', encoding='utf-8')
            module.remove_generated_install()
            ok(not root.exists() and not legacy.exists(), 'offline deps: clean removes only current cached/legacy generated install state')
            ok(sentinel.read_text(encoding='utf-8') == 'normal npm workspace', 'offline deps: clean leaves the normal npm workspace untouched')

            os.environ[module.CACHE_DIR_ENV] = str(ROOT / '.forbidden-offline-cache')
            try:
                module.offline_cache_root()
            except module.OfflineDepsError:
                rejected = True
            else:
                rejected = False
            ok(rejected, 'offline deps: cache overrides inside the repository fail closed')
        finally:
            module.VENDOR = original_vendor
            module.MANIFEST_PATH = original_manifest
            module.LEGACY_INSTALL_ROOT = original_legacy
            module.check_platform = original_check_platform
            module.check_vendor = original_check_vendor
            if previous_cache is None:
                os.environ.pop(module.CACHE_DIR_ENV, None)
            else:
                os.environ[module.CACHE_DIR_ENV] = previous_cache


package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
config = json.loads((ROOT / 'tools/offline-deps.json').read_text(encoding='utf-8'))
lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
source = (ROOT / 'tools/offline_deps.py').read_text(encoding='utf-8')
readme = (ROOT / 'vendor/offline/README.md').read_text(encoding='utf-8')
requirements = (ROOT / 'tests/requirements.txt').read_text(encoding='utf-8')
run_all = (ROOT / 'tests/run_all.py').read_text(encoding='utf-8')
browser_harness = (ROOT / 'tests/browser_harness.py').read_text(encoding='utf-8')
browser_probe = (ROOT / 'tests/offline_environment_probe.py').read_text(encoding='utf-8')
orders_launcher = _read_launcher('.01run orders.bat')
kupa_launcher = _read_launcher('.02run kupa.bat')

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
ok('NETUNIM_OFFLINE_CACHE_DIR' in source and 'Path.home() / ".cache" / "netunim" / "offline"' in source and 'must be an absolute path' in source, 'offline deps: generated Linux tools default to a stable external cache and overrides are unambiguous')
ok('root in resolved.parents' in source and 'must point outside the repository' in source, 'offline deps: an override cannot silently put the heavy cache back inside the source tree')
ok('profile / stamp_value' in source and 'manifest_sha256()' in source, 'offline deps: cache identity is content-addressed by profile and manifest SHA256')
ok('def install_lock(' in source and 'import fcntl' in source and 'fcntl.LOCK_EX' in source, 'offline deps: concurrent installers serialize per manifest without stale directory locks')
ok('def publish_install(' in source and 'os.replace(stage, root)' in source and 'os.replace(backup, root)' in source, 'offline deps: a complete staged install is atomically published with rollback')
ok('LEGACY_INSTALL_ROOT = ROOT / ".offline"' in source and 'shutil.rmtree(LEGACY_INSTALL_ROOT' in source, 'offline deps: old in-repository generated state is cleaned as legacy only')
ok('env["NETUNIM_OFFLINE_NODE_MODULES"] = modules' in source and 'env["NETUNIM_OFFLINE_INSTALL_ROOT"] = str(root)' in source and 'env["NODE_PATH"]' in source, 'offline deps: test processes resolve vendored tools through explicit external-cache environment')
ok('shutil.rmtree(ROOT / "node_modules"' not in source and 'shutil.rmtree(NODE_MODULES' not in source, 'offline deps: clean/update cannot remove normal repository node_modules')
ok('npm install' not in source and 'npm ci' not in source, 'offline deps: offline installer never resolves packages from npm')
ok('content-addressed cache **outside the repository**' in readme and 'NETUNIM_OFFLINE_CACHE_DIR' in readme and 'per-hash file lock' in readme, 'offline deps: external cache, override and concurrency semantics are documented')
ok('NETUNIM_BROWSER' in browser_harness, 'offline deps: browser harness supports an explicit unmanaged test-browser override')
ok('ERR_BLOCKED_BY_ADMINISTRATOR' in browser_probe and 'BROWSER_RUNTIME_UNAVAILABLE' in browser_probe, 'offline deps: environment doctor distinguishes host browser policy from application test failures')
ok('CORE_SUITES' in run_all and 'RUNTIME_SUITES' in run_all and '--core-only' in run_all, 'offline deps: chat repair mode can run deterministic core suites without weakening the full gate')
ok('chat_test()' in source and '"--core-only"' in source and 'probe_rc == 3' in source, 'offline deps: chat test falls back only for an explicitly unavailable browser runtime')
ok('args.command == "test"' in source and 'run_all.py")])' in source, 'offline deps: strict offline test still runs the complete verification gate')
ok('setlocal' in orders_launcher.lower() and 'setlocal' in kupa_launcher.lower(), 'windows local launchers: temporary environment changes are scoped to the launcher process')
ok('NO_UPDATE_CHECK=1' in orders_launcher and 'NO_UPDATE_CHECK=1' in kupa_launcher, 'windows local launchers: serve network update checks cannot delay normal startup')
ok('%~dp0netunim-orders\\site' in orders_launcher and '%~dp0netunim-kupa\\site' in kupa_launcher, 'windows local launchers: site roots are anchored to the BAT location rather than the caller working directory')
ok('pushd "%SITE_DIR%"' in orders_launcher and 'pushd "%SITE_DIR%"' in kupa_launcher, 'windows local launchers: drive-aware directory changes fail closed before serve starts')
ok('call npx serve "%SITE_DIR%"' in orders_launcher and 'call npx serve "%SITE_DIR%"' in kupa_launcher, 'windows local launchers: serve receives the absolute site root explicitly and returns control to the BAT')
ok('offline_deps.py' not in orders_launcher and 'offline_deps.py' not in kupa_launcher, 'windows local launchers: normal serving never enters the ChatGPT offline toolchain')

if sys.platform.startswith('linux'):
    _exercise_external_cache(module)
else:
    ok(True, 'offline deps: Linux-only cache installation behavior is not invoked by Windows verification')

help_result = subprocess.run([sys.executable, str(ROOT / 'tools/offline_deps.py'), '--help'], cwd=ROOT, capture_output=True, text=True)
ok(help_result.returncode == 0 and all(word in help_result.stdout for word in ('download', 'doctor', 'install', 'test', 'chat-test', 'update')), 'offline deps: maintenance CLI is runnable with the system Python only')

if errors:
    print(f'\n{len(errors)} offline dependency contract(s) failed')
    raise SystemExit(1)
print('\nALL OFFLINE DEPENDENCY CONTRACTS PASSED')
