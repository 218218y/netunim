"""Reproducibly retain the reviewed last repository snapshot before bundling.

This is historical repository evidence, not a claim about a live deployment.
Pinned vendors are retained once per manifest digest, independently of the
current application runtimes. All bytes come from the historical Git commit.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '4d8e17d34974799ad3666204d349ed198a2fa4cb'
target = ROOT/'tests/fixtures/prebundle'
target.mkdir(parents=True, exist_ok=True)
raw = subprocess.check_output(['git', 'archive', '--format=tar', COMMIT, 'netunim-orders/site', 'netunim-kupa/site'], cwd=ROOT)
files = {}
vendor_files = {}
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for member in archive.getmembers():
        if not member.isfile():
            continue
        content = archive.extractfile(member).read()
        if '/assets/vendor/' in member.name:
            vendor_files[member.name] = content
            if not member.name.endswith('/_runtime-manifest.txt'):
                continue
        files[member.name] = content


def packed(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return buffer.getvalue()


retained = {}
for name, manifest in files.items():
    if not name.endswith('/_runtime-manifest.txt'):
        continue
    tree = hashlib.sha256(manifest).hexdigest()
    prefix = name.rsplit('/', 1)[0]+'/'
    entries = re.findall(r'^([a-f0-9]{64})  (.+)$', manifest.decode(), re.M)
    expected = {prefix+relative for _, relative in entries} | {name}
    assert {path for path in vendor_files if path.startswith(prefix)} == expected, name
    for digest, relative in entries:
        assert hashlib.sha256(vendor_files[prefix+relative]).hexdigest() == digest, relative
    for path in expected:
        key = tree+'/'+path[len(prefix):]
        content = vendor_files[path]
        assert key not in retained or retained[key] == content, key
        retained[key] = content
vendors = packed(retained)
(target/'vendors.zip').write_bytes(vendors)
payload = packed(files)
(target/'source.zip').write_bytes(payload)
metadata = {'schema': 1, 'sourceCommit': COMMIT, 'deployedIdentityVerified': False,
            'archiveSha256': hashlib.sha256(payload).hexdigest(),
            'vendorArchiveSha256': hashlib.sha256(vendors).hexdigest(),
            'releases': {app: re.search(rb"const CACHE='([^']+)'", files[f'netunim-{app}/site/service-worker.js'])[1].decode() for app in ('orders', 'kupa')},
            'files': {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())}}
(target/'manifest.json').write_bytes((json.dumps(metadata, indent=2)+'\n').encode())
print('Captured', len(files), 'historical public files in', len(payload), 'bytes;', COMMIT)
print('Retained', len(retained), 'deduplicated vendor files in', len(vendors), 'bytes')
