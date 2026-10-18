"""Public filename hygiene covers worktrees, Git snapshots and actual deploy guard."""
from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from public_asset_names import asset_name_issue, site_name_violations
from public_js_guard import main as deploy_guard

spec = importlib.util.spec_from_file_location('asset_names_sync', ROOT / 'tools/sync-assets.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class PublicAssetNamesContracts(unittest.TestCase):
    def test_backup_copy_and_alternate_worker_names_are_rejected(self):
        for name in ('service-worker (2).js', 'service-worker-old.js', 'Service-Worker.js',
                     'assets/app - Copy.js', 'assets/app - Copy (2).js', 'assets/app - עותק.js',
                     'assets/app(2).JS', 'assets/app.js.bak', 'assets/app.old.js',
                     'assets/index.html~', 'assets/.#app.js', 'assets/#draft#',
                     'assets/vendor/library/runtime.js.orig'):
            with self.subTest(name=name):
                self.assertIsNotNone(asset_name_issue(name))

    def test_versioned_legacy_and_real_copy_utilities_are_retained(self):
        for name in ('service-worker.js', 'assets/js/legacy-reader.js', 'assets/js/schema-v1.js',
                     'assets/js/copy.js', 'assets/icons/copy-icon.png', 'assets/vendor/runtime.min.js',
                     'assets/vendor/runtime.js.map', 'assets/js/service-worker-client.js', '_headers'):
            with self.subTest(name=name):
                self.assertIsNone(asset_name_issue(name))

    def test_untracked_public_root_copy_is_checked_outside_worker_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / 'netunim-orders/site'
            site.mkdir(parents=True)
            (site / 'service-worker (2).js').write_text('// stale worker', encoding='utf-8')
            snapshot = sync.WorktreeSnapshot(root)
            self.assertNotIn('netunim-orders/site/service-worker (2).js', snapshot.files)
            with self.assertRaisesRegex(ValueError, 'unapproved public asset'):
                sync.plan_sync(snapshot)

    def test_proposed_git_tree_rejects_backup_before_reading_or_rewriting_any_asset(self):
        snapshot = types.SimpleNamespace(files={'netunim-kupa/site/assets/app.js.bak'})
        with self.assertRaisesRegex(ValueError, 'unapproved public asset'):
            sync.plan_sync(snapshot)

    def test_real_deployment_guard_rejects_a_clean_duplicate_script(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            target = site / 'service-worker (2).js'
            target.write_text('// no dynamic code or secret', encoding='utf-8')
            self.assertEqual(site_name_violations(site), [('service-worker (2).js', 'unapproved duplicate copy')])
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(deploy_guard([str(site)]), 1)
            self.assertIn('unapproved public asset', output.getvalue())
            self.assertTrue(target.is_file(), 'a read-only guard must not delete a possible compatibility consumer')


if __name__ == '__main__':
    unittest.main(verbosity=2)
