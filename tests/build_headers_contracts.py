"""Effective Cloudflare cache rules, including duplicate-header merge semantics."""
import fnmatch
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from build_headers import production_headers


def effective(source, pathname):
    result = {}
    matched = False
    for line in source.splitlines():
        if not line or line.startswith('#'):
            continue
        if not line[0].isspace():
            matched = fnmatch.fnmatchcase(pathname, line)
        elif matched:
            key, value = line.strip().split(': ', 1)
            result[key] = result[key]+', '+value if key in result else value
    return result


class BuildHeadersContracts(unittest.TestCase):
    def test_mutable_and_immutable_resources_never_inherit_conflicting_cache_rules(self):
        names = ['index.html', 'reset-local.html', 'service-worker.js', 'supabase/config.js',
                 'favicon.ico', 'assets/build/app-HASH.js', 'assets/build/index-HASH.css',
                 'assets/js/domains/documents/spreadsheet-preview-worker.js',
                 'assets/vendor/pdfjs/build/pdf.mjs', '_headers']
        for app in ('orders', 'kupa'):
            source = (ROOT/f'netunim-{app}/site/_headers').read_text(encoding='utf-8')
            built = production_headers(source, names, 'fixture-release')
            for name in ['/', '/index', '/reset-local'] + ['/'+name for name in names if name != '_headers']:
                headers = effective(built, name)
                policy = 'public, max-age=31536000, immutable' if name.startswith('/assets/build/') else 'no-cache'
                self.assertEqual(headers['Cache-Control'], policy, (app, name, headers))
                self.assertEqual(headers['X-Netunim-Release'], 'fixture-release')
                self.assertEqual(headers['Content-Security-Policy'], effective(source, '/')['Content-Security-Policy'])
                self.assertEqual(headers['X-Frame-Options'], 'DENY')

    def test_unreviewed_source_rule_or_header_count_fails_closed(self):
        source = (ROOT/'netunim-orders/site/_headers').read_text(encoding='utf-8')
        for altered, names in [(source+'\n/assets/*\n  Cache-Control: no-store\n', []),
                                (source, [f'icons/icon-{index}.png' for index in range(100)])]:
            with self.assertRaises(ValueError):
                production_headers(altered, names)


if __name__ == '__main__':
    unittest.main()
