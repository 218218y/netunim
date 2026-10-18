"""Public release smoke rejects stale bytes and headers without external traffic."""
import email.message
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deployment_smoke', ROOT/'tools/deployment_smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class Response:
    status = 200

    def __init__(self, body, url, release='orders-app-shell-esm-test'):
        self.body, self.url = body, url
        self.headers = email.message.Message()
        self.headers['X-Netunim-Release'] = release
        self.headers['X-Content-Type-Options'] = 'nosniff'
        self.headers['Content-Type'] = 'application/javascript'

    def geturl(self): return self.url
    def read(self, limit): return self.body[:limit]
    def __enter__(self): return self
    def __exit__(self, *args): pass


class DeploymentSmokeContracts(unittest.TestCase):
    def test_exact_critical_release_passes_with_normalized_windows_newlines(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            for relative in smoke.CRITICAL_PATHS:
                path = site/relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"const CACHE='orders-app-shell-esm-test';\r\n")
            def fetch(request, timeout):
                self.assertEqual(timeout, 15)
                return Response(b"const CACHE='orders-app-shell-esm-test';\n", request.full_url)
            report = smoke.verify_site(site, 'https://public.test/', fetch)
            self.assertTrue(report['ok'])
            self.assertEqual(len(report['criticalAssets']), len(smoke.CRITICAL_PATHS))
            for failure in ['bytes', 'header', 'mime', 'security', 'redirect', 'http']:
                with self.subTest(failure=failure):
                    def bad(request, timeout):
                        response = fetch(request, timeout)
                        if failure == 'bytes': response.body = b'stale deployment'
                        if failure == 'header': response.headers.replace_header('X-Netunim-Release', 'other')
                        if failure == 'mime': response.headers.replace_header('Content-Type', 'text/html')
                        if failure == 'security': del response.headers['X-Content-Type-Options']
                        if failure == 'redirect': response.url = 'https://login.test/'
                        if failure == 'http': response.status = 503
                        return response
                    with self.assertRaises(ValueError):
                        smoke.verify_site(site, 'https://public.test/', bad)


if __name__ == '__main__': unittest.main()
