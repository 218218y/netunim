"""Public preview audits reject cross-project URLs, altered bytes and unsafe headers."""
import hashlib
from pathlib import Path
import sys
import unittest
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from pages_preview_audit import check_response, preview_origin
from pages_legacy_audit import normalized
from pages_preview_browser import PreviewSession
from acceptance_safety import browser_preflight


class PreviewContracts(unittest.TestCase):
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
        check_response('assets/build/app-HASH.js', row, digest, 'release')
        for key, value in [('x-netunim-release', 'future'), ('cache-control', headers['cache-control']+', no-cache'),
                           ('content-type', 'text/html'), ('content-security-policy', "script-src 'self' 'unsafe-eval';")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_response('assets/build/app-HASH.js', {**row, 'headers': {**headers, key: value}}, digest, 'release')
        with self.assertRaises(ValueError):
            check_response('assets/build/app-HASH.js', {**row, 'body': b'corrupted'}, digest, 'release')

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
