"""Fail-closed package, selection, environment and evidence contracts."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
import test_lab as lab
import test_lab_package as package


class TestLabContracts(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows Known Folder API')
    def test_fresh_windows_child_resolves_only_owned_known_folders(self):
        probe = """import ctypes,os
from pathlib import Path
for csidl in (0x001c,0x001a):
 value=ctypes.create_unicode_buffer(260)
 rc=ctypes.windll.shell32.SHGetFolderPathW(None,csidl,None,0,value)
 assert rc==0, ('known_folder_failed',rc)
 assert Path(value.value).is_relative_to(Path(os.environ['USERPROFILE']))
 assert Path(value.value).is_dir()
"""
        with lab.environment():
            result = subprocess.run([sys.executable, '-c', probe], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)

    def test_scenarios_use_only_checked_in_fixtures(self):
        for suites in lab.SCENARIOS.values():
            self.assertTrue(suites)
            for suite in suites:
                self.assertEqual(Path(suite).name, suite)
                self.assertTrue((ROOT/'tests'/suite).is_file())
        self.assertNotIn('production_supabase_ui.py', sum(lab.SCENARIOS.values(), []))

    def test_environment_omits_inherited_credentials_and_restores_host(self):
        with patch.dict(os.environ, {'GOOGLE_CLIENT_SECRET': 'sentinel', 'SUPABASE_ACCESS_TOKEN': 'sentinel',
                                     'PGHOST': 'production.invalid', 'HTTP_PROXY': 'private.invalid'}):
            original = dict(os.environ)
            with lab.environment() as scratch:
                for name in ('GOOGLE_CLIENT_SECRET', 'SUPABASE_ACCESS_TOKEN', 'PGHOST', 'HTTP_PROXY'):
                    self.assertNotIn(name, os.environ)
                self.assertTrue(Path(os.environ['LOCALAPPDATA']).is_relative_to(scratch))
                self.assertTrue(scratch.exists())
            self.assertFalse(scratch.exists())
            self.assertEqual(dict(os.environ), original)

    def test_blocked_and_unselected_checks_never_become_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with patch.object(lab, 'report_directory', return_value=path), patch.object(lab, 'git', return_value='test-sha'), \
                    patch.object(lab, 'blocked_reason', return_value='missing isolated services'), \
                    patch.object(lab, 'run_suites') as run, redirect_stdout(io.StringIO()):
                self.assertEqual(lab.run(['network-and-lost-ack']), 1)
            run.assert_not_called()
            report = json.loads((path/'report.json').read_text())
            self.assertEqual(next(r for r in report['scenarios'] if r['scenario']=='network-and-lost-ack')['status'], 'BLOCKED')
            self.assertTrue(all(r['status']=='NOT RUN' for r in report['scenarios'] if r['scenario']!='network-and-lost-ack'))
            self.assertFalse(report['physical_acceptance'])

    def test_failure_remains_unresolved_and_ordinary_pass_remains_automatic(self):
        for rc in (0, 1):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                with patch.object(lab, 'report_directory', return_value=path), patch.object(lab, 'git', return_value='test-sha'), \
                        patch.object(lab, 'blocked_reason', return_value=''), \
                        patch.object(lab, 'run_suites', return_value=rc), redirect_stdout(io.StringIO()):
                    self.assertEqual(lab.run(['bridge']), rc)
                row = next(r for r in json.loads((path/'report.json').read_text())['scenarios'] if r['scenario']=='bridge')
                self.assertEqual(row['status'], 'PASS' if rc==0 else 'UNRESOLVED')
                self.assertEqual(row['evidence_class'], 'automatic')

    def test_host_cannot_claim_guest_evidence(self):
        with self.assertRaises(RuntimeError):
            lab.evidence_class(True)

    def test_offline_package_rejects_modified_and_extra_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'source').mkdir()
            file = root/'source/source.txt'
            file.write_text('reviewed')
            manifest = {'format': 1, 'files': package.hashes(root)}
            (root/'package-manifest.json').write_text(json.dumps(manifest))
            package.verify(root)
            file.write_text('changed')
            with self.assertRaises(RuntimeError):
                package.verify(root)
            file.write_text('reviewed')
            (root/'extra.txt').write_text('unreviewed')
            with self.assertRaises(RuntimeError):
                package.verify(root)

    def test_archive_traversal_and_windows_paths_are_rejected(self):
        for name in ('../escape', '/absolute', 'C:/host', 'source\\..\\escape'):
            with tempfile.TemporaryDirectory() as directory:
                archive = Path(directory)/'source.zip'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    zipped.writestr(name, 'unsafe')
                with self.assertRaises(RuntimeError):
                    package.extract_snapshot(archive, Path(directory)/'out')

    def test_sandbox_maps_only_snapshot_and_owned_evidence(self):
        xml = ET.fromstring(package.sandbox_config(Path('staged snapshot'), Path('owned evidence')))
        self.assertEqual(xml.findtext('Networking'), 'Disable')
        folders = xml.findall('MappedFolders/MappedFolder')
        self.assertEqual([f.findtext('ReadOnly') for f in folders], ['true', 'false'])
        self.assertEqual([f.findtext('HostFolder') for f in folders], ['staged snapshot', 'owned evidence'])
        for name in ('ClipboardRedirection', 'AudioInput', 'VideoInput', 'PrinterRedirection'):
            self.assertEqual(xml.findtext(name), 'Disable')


if __name__ == '__main__':
    unittest.main()
