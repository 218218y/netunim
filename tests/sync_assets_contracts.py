"""Cross-platform release hashes and read-only/idempotent asset generation."""
from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {'.html', '.css', '.js', '.webmanifest'}


def load_sync_module():
    """Load the generator once per test process; tests retarget only its ROOT."""
    spec = importlib.util.spec_from_file_location('netunim_sync_assets_contract', ROOT / 'tools/sync-assets.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('could not load tools/sync-assets.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SYNC_MODULE = load_sync_module()


class SyncAssetContracts(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='netunim-assets-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        for relative in ('shared', 'netunim-kupa/site', 'netunim-orders/site'):
            shutil.copytree(ROOT / relative, self.root / relative)
        (self.root / 'tools').mkdir()
        shutil.copyfile(ROOT / 'tools/sync-assets.py', self.root / 'tools/sync-assets.py')
        self.run_sync()

    def run_sync(self, check=False, expected=0):
        """Exercise generator logic in-process; CLI wiring is covered separately."""
        previous_root = SYNC_MODULE.ROOT
        output = io.StringIO()
        try:
            SYNC_MODULE.ROOT = self.root
            with redirect_stdout(output):
                clean = SYNC_MODULE.sync(check=check)
        finally:
            SYNC_MODULE.ROOT = previous_root
        returncode = 1 if check and not clean else 0
        self.assertEqual(returncode, expected, output.getvalue())

    def run_sync_cli(self, check=False, expected=0):
        command = [sys.executable, str(self.root / 'tools/sync-assets.py')]
        result = subprocess.run(command + (['--check'] if check else []), cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.root.rglob('*') if p.is_file()}

    def hashes(self):
        return [re.search(r"const CACHE='([^']+)'", (self.root / f'netunim-{app}/site/service-worker.js').read_text()).group(1)
                for app in ('kupa', 'orders')]

    def line_endings(self, newline):
        for path in self.root.rglob('*'):
            if path.suffix in TEXT_SUFFIXES or path.name == '_headers':
                data = path.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')
                path.write_bytes(data.replace(b'\n', newline))

    def test_cli_exit_codes_and_check_mode_are_preserved(self):
        """Keep a small subprocess contract without paying that startup cost for every matrix case."""
        self.run_sync_cli(check=True)
        path = self.root / 'netunim-kupa/site/assets/app.js'
        path.write_bytes(path.read_bytes() + b'\ncli contract change\n')
        before = self.snapshot()
        self.run_sync_cli(check=True, expected=1)
        self.assertEqual(self.snapshot(), before, '--check CLI wrote files')
        self.run_sync_cli()
        self.run_sync_cli(check=True)

    def test_line_endings_do_not_change_hash_or_check_result(self):
        self.line_endings(b'\n')
        self.run_sync()
        expected = self.hashes()
        for newline in (b'\r\n', b'\r', b'\n'):
            with self.subTest(newline=newline):
                self.line_endings(newline)
                before = self.snapshot()
                self.run_sync(check=True)
                self.assertEqual(self.snapshot(), before, '--check wrote files')
                self.run_sync()
                self.assertEqual(self.hashes(), expected)
                self.assertEqual(self.snapshot(), before, 'clean generation rewrote files')

    def test_content_changes_require_regeneration_and_check_never_writes(self):
        for relative in ('assets/app.js', 'assets/app.css', 'index.html', 'manifest.webmanifest', '_headers'):
            with self.subTest(asset=relative):
                previous = self.hashes()
                path = self.root / 'netunim-kupa/site' / relative
                path.write_bytes(path.read_bytes() + b'\ncontent change\n')
                before = self.snapshot()
                self.run_sync(check=True, expected=1)
                self.assertEqual(self.snapshot(), before)
                self.run_sync()
                self.assertNotEqual(self.hashes()[0], previous[0])
                self.assertEqual(self.hashes()[1], previous[1])
                self.run_sync(check=True)

    def test_binary_newlines_remain_significant_and_bytes_are_preserved(self):
        for name in ('favicon.ico', 'favicon-16x16.png'):
            with self.subTest(binary=name):
                path = self.root / 'netunim-kupa/site' / name
                original = path.read_bytes()
                path.write_bytes(original + b'\r\n')
                self.run_sync()
                previous = self.hashes()
                path.write_bytes(original + b'\n')
                self.run_sync(check=True, expected=1)
                self.run_sync()
                self.assertNotEqual(self.hashes()[0], previous[0])
                self.assertEqual(path.read_bytes(), original + b'\n')

    def test_shared_drift_is_detected_and_repaired_for_both_sites(self):
        source = self.root / 'shared/html.js'
        source.write_bytes(source.read_bytes() + b'\n// shared change\n')
        self.run_sync(check=True, expected=1)
        self.run_sync()
        for app in ('kupa', 'orders'):
            self.assertEqual((self.root / f'netunim-{app}/site/assets/js/shared/html.js').read_bytes(), source.read_bytes())
        self.run_sync(check=True)

    def test_removed_shared_source_removes_obsolete_public_copies(self):
        source = self.root / 'shared/html.js'
        copies = [self.root / f'netunim-{app}/site/assets/js/shared/html.js' for app in ('kupa', 'orders')]
        source.unlink()
        self.run_sync(check=True, expected=1)
        self.run_sync()
        self.assertTrue(all(not path.exists() for path in copies))
        self.run_sync(check=True)

    def test_asset_order_uses_case_sensitive_posix_paths_on_every_os(self):
        assets = self.root / 'netunim-kupa/site/assets'
        for name in ('z.js', 'A.js', 'a-helper.js', 'Z-helper.js'):
            (assets / name).write_bytes(b'// test asset\n')
        self.run_sync()
        source = (assets.parent / 'service-worker.js').read_text()
        paths = re.findall(r"'\./assets/[^']+\.js'", source)
        self.assertEqual(paths, sorted(paths))

    def test_missing_cache_declaration_fails_without_writes(self):
        worker = self.root / 'netunim-kupa/site/service-worker.js'
        worker.write_text(worker.read_text().replace('const CACHE=', 'const RENAMED_CACHE='))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'CACHE declaration'):
            self.run_sync(check=True, expected=1)
        self.assertEqual(self.snapshot(), before)


class StagedAssetContracts(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='netunim-staged-assets-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        for relative in ('shared', 'netunim-kupa/site', 'netunim-orders/site'):
            shutil.copytree(ROOT / relative, self.root / relative)
        (self.root / 'tools/git-hooks').mkdir(parents=True)
        for relative in ('sync-assets.py', 'install-git-hooks.py', 'git-hooks/pre-commit'):
            shutil.copyfile(ROOT / 'tools' / relative, self.root / 'tools' / relative)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Asset Test')
        self.git('config', 'user.email', 'asset-test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'core.autocrlf', 'false')
        self.git('add', '.')
        self.git('-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture')

    def git(self, *args, input=None):
        result = subprocess.run(
            ['git', *args], cwd=self.root, input=input, capture_output=True, check=True
        )
        return result.stdout

    def run_tool(self, *args):
        return subprocess.run(
            [sys.executable, 'tools/sync-assets.py', *args],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=True,
        )

    def index_bytes(self, relative):
        return self.git('show', f':{relative}')

    def test_staged_sync_uses_index_snapshot_and_preserves_unstaged_content(self):
        asset = 'netunim-kupa/site/assets/app.js'
        worker = 'netunim-kupa/site/service-worker.js'
        original = (self.root / asset).read_bytes()
        staged = original + b'\n// staged asset change\n'
        unstaged = staged + b'// deliberately unstaged asset change\n'
        (self.root / asset).write_bytes(staged)
        self.git('add', '--', asset)
        (self.root / asset).write_bytes(unstaged)

        result = self.run_tool('--staged')
        self.assertIn('STAGED kupa: refreshed service-worker shell and cache key', result.stdout)
        self.assertEqual(self.index_bytes(asset), staged)
        self.assertEqual((self.root / asset).read_bytes(), unstaged)
        self.assertNotEqual(self.index_bytes(worker), (self.root / worker).read_bytes())
        self.assertEqual(self.run_tool('--staged').stdout, '')
        self.run_tool('--check')

    def test_installed_hook_fixes_and_commits_generated_outputs(self):
        install = subprocess.run(
            [sys.executable, 'tools/install-git-hooks.py'], cwd=self.root,
            capture_output=True, text=True, check=True,
        )
        self.assertIn('INSTALLED:', install.stdout)
        subprocess.run(
            [sys.executable, 'tools/install-git-hooks.py', '--check'], cwd=self.root,
            capture_output=True, text=True, check=True,
        )
        source = 'shared/html.js'
        updated = (self.root / source).read_bytes() + b'\n// hook integration change\n'
        (self.root / source).write_bytes(updated)
        self.git('add', '--', source)
        commit = subprocess.run(
            ['git', 'commit', '-m', 'exercise managed hook'], cwd=self.root,
            capture_output=True, text=True, check=True,
        )
        self.assertIn('STAGED kupa: synchronized shared source: html.js', commit.stdout + commit.stderr)
        for app in ('kupa', 'orders'):
            copy = f'netunim-{app}/site/assets/js/shared/html.js'
            self.assertEqual(self.git('show', f'HEAD:{copy}'), updated)
        self.assertEqual(self.git('status', '--porcelain'), b'')


if __name__ == '__main__':
    unittest.main(verbosity=2)
