"""Read-only HTTPS byte/header audit of an immutable, explicitly selected Pages URL."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from build_validation import require

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 25*1024*1024


def preview_origin(app, url):
    parsed = urllib.parse.urlsplit(url)
    require(app in ('orders', 'kupa') and parsed.scheme == 'https' and parsed.port in (None, 443), 'Expected HTTPS Pages deployment URL')
    require(re.fullmatch(r'[a-f0-9]{8,32}\.bargig-'+app+r'\.pages\.dev', parsed.hostname or ''), 'Expected immutable deployment URL for the selected project')
    require(not parsed.username and not parsed.password and parsed.path in ('', '/') and not parsed.query and not parsed.fragment, 'Select a deployment root without credentials, query or fragment')
    return 'https://'+parsed.hostname


def fetch(url, origin):
    class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, target):
            require(urllib.parse.urlsplit(target).netloc == urllib.parse.urlsplit(origin).netloc and target.startswith(origin+'/'), 'Deployment redirected outside its audited origin')
            return super().redirect_request(request, fp, code, msg, headers, target)
    opener = urllib.request.build_opener(SameOriginRedirect())
    with opener.open(urllib.request.Request(url, headers={'User-Agent': 'netunim-preview-audit/1', 'Accept-Encoding': 'identity'}), timeout=30) as response:
        body = response.read(LIMIT+1)
        require(len(body) <= LIMIT, 'Preview response exceeds file-size limit')
        return {'url': response.geturl(), 'status': response.status,
                'headers': {key.lower(): value for key, value in response.headers.items()}, 'body': body}


def check_response(name, row, digest, release):
    require(row['status'] == 200, 'Non-success response: '+name)
    require(hashlib.sha256(row['body']).hexdigest() == digest, 'Published byte mismatch: '+name)
    headers = row['headers']
    require(headers.get('x-netunim-release') == release, 'Preview release mismatch: '+name)
    policy = {value.strip().lower() for value in headers.get('cache-control', '').split(',')}
    if name.startswith('assets/build/'):
        require({'immutable', 'max-age=31536000'} <= policy and not {'no-cache', 'no-store'} & policy, 'Conflicting immutable policy: '+name)
    else:
        require('no-cache' in policy and 'immutable' not in policy, 'Mutable resource cache policy: '+name)
    content_type = headers.get('content-type', '').split(';')[0].lower()
    suffix = Path(name).suffix
    accepted = {'.js': {'text/javascript', 'application/javascript'}, '.mjs': {'text/javascript', 'application/javascript'},
                '.html': {'text/html'}, '.css': {'text/css'}, '.wasm': {'application/wasm'},
                '.png': {'image/png'}, '.svg': {'image/svg+xml'}, '.ttf': {'font/ttf', 'application/x-font-ttf', 'application/octet-stream'}}
    if suffix in accepted:
        require(content_type in accepted[suffix], 'Incorrect Content-Type for '+name+': '+content_type)
    csp = headers.get('content-security-policy', '')
    require(re.search(r"(?:^|;)\s*script-src 'self'\s*(?:;|$)", csp) and "'unsafe-eval'" not in csp and
            re.search(r"(?:^|;)\s*worker-src 'self'(?: blob:)?\s*(?:;|$)", csp), 'Missing/unsafe preview CSP: '+name)
    require(headers.get('x-frame-options', '').upper() == 'DENY', 'Missing framing protection: '+name)
    return {'path': name, 'sha256': digest, 'bytes': len(row['body']), 'contentType': content_type, 'cacheControl': headers['cache-control']}


def audit(app, url, manifest, loader=fetch):
    origin = preview_origin(app, url)
    require(manifest['app'] == app, 'Manifest application mismatch')
    release = manifest['release']
    names = sorted(set(manifest['files'])-{'_headers'})
    def inspect(name):
        row = loader(origin+'/'+urllib.parse.quote(name, safe='/'), origin)
        result = check_response(name, row, manifest['files'][name], release)
        if name.endswith('.html'):
            expected = '/' if name == 'index.html' else '/'+name[:-5]
            require(urllib.parse.urlsplit(row['url']).path == expected, 'Unexpected canonical HTML redirect: '+name)
        return result
    with ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(inspect, names))
    # Pages may serve the SPA index for unknown paths. It must not publish source
    # JavaScript or private source maps under their old names.
    for path in ('assets/js/main.js', 'assets/app.js', 'assets/build/private.js.map'):
        try:
            row = loader(origin+'/'+path, origin)
        except urllib.error.HTTPError as error:
            require(error.code == 404, 'Unexpected source probe failure')
            continue
        require('javascript' not in row['headers'].get('content-type', '') and
                hashlib.sha256(row['body']).hexdigest() == manifest['files']['index.html'], 'Source/private asset exposed: '+path)
    return {'app': app, 'origin': origin, 'commit': manifest['commit'], 'release': release, 'files': checked,
            'staticIntegrityPassed': True, 'businessOrOAuthAcceptance': 'not performed by the static audit'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=('orders', 'kupa'))
    parser.add_argument('url')
    args = parser.parse_args()
    manifest = json.loads((ROOT/'.work/production'/args.app/'manifest.json').read_text(encoding='utf-8'))
    report = audit(args.app, args.url, manifest)
    output = ROOT/'.work/pages-preview'/args.app/'http-audit.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('PASS immutable preview bytes, headers, MIME types and canonical redirects:', output)


if __name__ == '__main__':
    main()
