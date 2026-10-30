"""Read-only verification of the historical immutable Production deployments.

Provider commit metadata alone is insufficient. Compare actual published bytes
against the retained historical fixture, normalizing only documented text newline
differences introduced by Windows source checkouts. No application is executed.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import zipfile
from pages_preview_audit import ROOT, fetch, preview_origin
from build_validation import require

DEPLOYMENTS = {'orders': '5c873855', 'kupa': '6a43e10a'}
TEXT = {'.js', '.mjs', '.css', '.html', '.webmanifest', '.txt'}


def normalized(name, body):
    return body.replace(b'\r\n', b'\n').replace(b'\r', b'\n') if Path(name).suffix in TEXT else body


def audit_legacy(app):
    directory = ROOT/'tests/fixtures/prebundle'
    manifest = json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    archive = directory/'source.zip'
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSha256'], 'Historical archive mismatch')
    origin = preview_origin(app, 'https://'+DEPLOYMENTS[app]+'.bargig-'+app+'.pages.dev')
    prefix = 'netunim-'+app+'/site/'
    with zipfile.ZipFile(archive) as bundle:
        retained = {name[len(prefix):]: bundle.read(name) for name in manifest['files'] if name.startswith(prefix) and name != prefix+'_headers'}
    require(all(hashlib.sha256(body).hexdigest() == manifest['files'][prefix+name] for name, body in retained.items()), 'Historical file integrity mismatch')
    def inspect(item):
        name, expected = item
        row = fetch(origin+'/'+name, origin)
        require(row['headers'].get('x-netunim-release') == manifest['releases'][app], 'Historical live release differs: '+name)
        require(normalized(name, row['body']) == normalized(name, expected), 'Historical live bytes differ: '+name)
        return name
    with ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(inspect, sorted(retained.items())))
    report = {'app': app, 'origin': origin, 'sourceCommit': manifest['sourceCommit'], 'release': manifest['releases'][app],
              'verifiedHistoricalFiles': checked, 'deployedIdentityVerified': True,
              'normalization': 'CRLF/CR to LF for source text only; binary bytes are exact',
              'vendorTree': 'historical pinned runtime manifests; restored fixture verifies every reused vendor byte'}
    output = ROOT/'.work/pages-preview'/app/'historical-identity.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('PASS actual historical deployment identity:', app, len(checked), 'files')


if __name__ == '__main__':
    for application in ('orders', 'kupa'):
        audit_legacy(application)
