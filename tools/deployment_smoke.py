"""Read-only post-upload proof of a release's critical public assets."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

CRITICAL_PATHS = (
    'index.html', 'service-worker.js', 'assets/app.js', 'assets/app.css',
    'assets/js/main.js', 'assets/js/lifecycle.js', 'supabase/config.js',
    'assets/js/shared/storage-startup-protocol.js',
    'assets/js/shared/storage-journal-idb.js',
    'assets/js/shared/indexed-db-connection.js',
    'assets/js/shared/spreadsheet-remote.js',
)


def normalized(data: bytes) -> bytes:
    return data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')


def verify_site(site: Path, url: str, opener=urllib.request.urlopen) -> dict:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Expected a public site base URL without credentials, query or fragment')
    base = url.rstrip('/') + '/'
    match = re.search(rb"const CACHE='([^']+)'", (site/'service-worker.js').read_bytes())
    if not match:
        raise ValueError('Local worker has no release identity')
    release = match[1].decode('ascii')
    rows = []
    for relative in CRITICAL_PATHS:
        expected = normalized((site/relative).read_bytes())
        request = urllib.request.Request(urllib.parse.urljoin(base, relative), headers={'Cache-Control': 'no-cache'})
        with opener(request, timeout=15) as response:
            if urllib.parse.urlsplit(response.geturl()).netloc != parsed.netloc:
                raise ValueError(f'{relative}: unexpected redirect origin')
            actual = normalized(response.read(25*1024*1024+1))
            if response.status != 200 or actual != expected:
                raise ValueError(f'{relative}: public bytes do not match the verified release')
            if response.headers.get('X-Netunim-Release') != release:
                raise ValueError(f'{relative}: missing or mismatched release response header')
            content_type = response.headers.get_content_type()
            if relative.endswith('.js') and content_type not in ('text/javascript', 'application/javascript'):
                raise ValueError(f'{relative}: incorrect JavaScript MIME type')
            if response.headers.get('X-Content-Type-Options') != 'nosniff':
                raise ValueError(f'{relative}: missing nosniff security header')
        rows.append({'path': relative, 'sha256': hashlib.sha256(expected).hexdigest()})
    return {'ok': True, 'url': base, 'release': release, 'criticalAssets': rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-dir', type=Path, required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        report = verify_site(args.site_dir, args.url)
    except (OSError, ValueError) as error:
        report = {'ok': False, 'url': args.url, 'error': str(error)}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report['ok'] else 2


if __name__ == '__main__':
    sys.exit(main())
