"""Cross-platform release hashes and read-only/idempotent asset generation."""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {'.html', '.css', '.js', '.webmanifest'}


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
        command = [sys.executable, str(self.root / 'tools/sync-assets.py')]
        result = subprocess.run(command + (['--check'] if check else []), capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

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
        self.run_sync(check=True, expected=1)
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
