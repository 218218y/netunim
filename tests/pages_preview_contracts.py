"""Public preview audits reject cross-project URLs, altered bytes and unsafe headers."""
import hashlib
import io
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from pages_preview_audit import check_response, preview_origin
from pages_legacy_audit import normalized
from pages_preview_browser import PreviewSession
from acceptance_safety import browser_preflight
import prebundle_fixture


class PreviewContracts(unittest.TestCase):
    def test_historical_rollback_restores_original_vendors_without_current_source(self):
        with tempfile.TemporaryDirectory() as root:
            # This root deliberately has no current netunim-*/site/vendor tree.
            fixture = Path(root)/'tests/fixtures/prebundle'
            fixture.mkdir(parents=True)
            for name in ('source.zip', 'vendors.zip', 'manifest.json'):
                (fixture/name).write_bytes((ROOT/'tests/fixtures/prebundle'/name).read_bytes())
            with patch.object(prebundle_fixture, 'ROOT', Path(root)):
                for app in ('orders', 'kupa'):
                    destination = Path(root)/app
                    metadata = prebundle_fixture.restore_prebundle(app, destination)
                    self.assertEqual(metadata['sourceCommit'], '4d8e17d34974799ad3666204d349ed198a2fa4cb')
                    manifest = (destination/'assets/vendor/pdfjs/_runtime-manifest.txt').read_text()
                    self.assertIn('version=6.4.299\n', manifest)
                    self.assertIn('build=d0991a0d5\n', manifest)
                    self.assertIn('pdfjsVersion = 6.4.299', (destination/'assets/vendor/pdfjs/build/pdf.mjs').read_text())
            (fixture/'vendors.zip').write_bytes(b'corrupted')
            with patch.object(prebundle_fixture, 'ROOT', Path(root)), self.assertRaisesRegex(ValueError, 'archive integrity'):
                prebundle_fixture.restore_prebundle('orders', Path(root)/'corrupted')

    def test_historical_vendor_restore_rejects_altered_missing_extra_and_unsafe_files(self):
        original = b'original runtime'
        digest = hashlib.sha256(original).hexdigest()
        for name, entries in (
            ('runtime.mjs', {'runtime.mjs': b'altered'}),
            ('runtime.mjs', {}),
            ('runtime.mjs', {'runtime.mjs': original, 'unexpected.mjs': original}),
            ('../escape.mjs', {'../escape.mjs': original}),
        ):
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as root:
                destination = Path(root)
                manifest = destination/'assets/vendor/pdfjs/_runtime-manifest.txt'
                manifest.parent.mkdir(parents=True)
                content = f'{digest}  {name}\n'.encode()
                manifest.write_bytes(content)
                tree = hashlib.sha256(content).hexdigest()+'/'
                payload = io.BytesIO()
                with zipfile.ZipFile(payload, 'w') as archive:
                    archive.writestr(tree+'_runtime-manifest.txt', content)
                    for relative, data in entries.items():
                        archive.writestr(tree+relative, data)
                with self.assertRaises(ValueError):
                    prebundle_fixture.restore_vendors(destination, payload.getvalue())
                self.assertEqual(list(manifest.parent.iterdir()), [manifest])

    def test_only_the_selected_immutable_https_project_can_be_audited(self):
        self.assertEqual(preview_origin('orders', 'https://abcd1234.bargig-orders.pages.dev/'), 'https://abcd1234.bargig-orders.pages.dev')
        for url in ('http://abcd1234.bargig-orders.pages.dev', 'https://abcd1234.bargig-kupa.pages.dev',
                    'https://abcd1234.bargig-orders.pages.dev.attacker.test', 'https://user@abcd1234.bargig-orders.pages.dev',
                    'https://abcd1234.bargig-orders.pages.dev/?token=private', 'https://127.0.0.1/'):
            with self.assertRaises(ValueError):
                preview_origin('orders', url)

    def test_actual_bytes_release_mime_csp_and_cache_policy_are_required(self):
        content = b'export const verified=true;'
        digest = hashlib.sha256(content).hexdigest()
        headers = {'x-netunim-release': 'release', 'cache-control': 'public, max-age=31536000, immutable',
                   'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': "script-src 'self'; worker-src 'self';", 'x-frame-options': 'DENY'}
        row = {'status': 200, 'body': content, 'headers': headers}
        check_response('assets/build/app-HASH.js', row, digest, 'release', headers['content-security-policy'])
        for key, value in [('x-netunim-release', 'future'), ('cache-control', headers['cache-control']+', no-cache'),
                           ('content-type', 'text/html'), ('content-security-policy', "script-src 'self' 'unsafe-eval';")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_response('assets/build/app-HASH.js', {**row, 'headers': {**headers, key: value}}, digest, 'release', headers['content-security-policy'])
        with self.assertRaises(ValueError):
            check_response('assets/build/app-HASH.js', {**row, 'body': b'corrupted'}, digest, 'release', headers['content-security-policy'])
        reviewed = "script-src 'self' https://static.cloudflareinsights.com; worker-src 'self' blob:;"
        check_response('assets/build/app-HASH.js', {**row, 'headers': {**headers, 'content-security-policy': reviewed}}, digest, 'release', reviewed)
        with self.assertRaises(ValueError):
            check_response('assets/build/app-HASH.js', row, digest, 'release', reviewed)

    def test_remote_browser_requires_complete_audited_bytes_and_does_not_loosen_local_preflight(self):
        with tempfile.TemporaryDirectory(prefix='netunim-preview-contract-') as root, tempfile.TemporaryDirectory(prefix='netunim-preview-profile-') as profile:
            session = object.__new__(PreviewSession)
            session.tmp, session.profile, session.downloads = Path(root), Path(profile), Path(root)/'downloads'
            session.app, session.httpd, session.supabase = 'orders', None, None
            session.url = 'https://abcd1234.bargig-orders.pages.dev/'
            session.manifest = {'release': 'release', 'commit': 'commit', 'files': {'index.html': 'sha', '_headers': 'headers'}}
            session.audit = {'origin': session.url, 'app': 'orders', 'release': 'release', 'commit': 'commit',
                             'staticIntegrityPassed': True, 'files': [{'path': 'index.html', 'sha256': 'sha'}]}
            self.assertEqual(session._network_preflight(), 'abcd1234.bargig-orders.pages.dev:443')
            session.audit['files'] = []
            with self.assertRaises(ValueError):
                session._network_preflight()
            session.service_worker, session.origin_owner = True, None
            with self.assertRaises((RuntimeError, FileNotFoundError)):
                browser_preflight(session)

    def test_historical_normalization_preserves_binary_bytes(self):
        self.assertEqual(normalized('app.js', b'a\r\nb\r'), b'a\nb\n')
        self.assertEqual(normalized('font.ttf', b'a\r\nb\r'), b'a\r\nb\r')

    def test_public_workflow_artifacts_exclude_diagnostic_source_maps(self):
        for name in ('verify.yml', 'verify-pages-preview.yml'):
            source = (ROOT/'.github/workflows'/name).read_text(encoding='utf-8')
            self.assertIn('!.work/production/**/*.map', source)
        source = (ROOT/'.github/workflows/verify-pages-preview.yml').read_text(encoding='utf-8')
        self.assertIn('python tools/github_verification.py', source)
        self.assertNotIn('CLOUDFLARE_API_TOKEN', source)


if __name__ == '__main__':
    unittest.main()
