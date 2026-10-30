"""Reproducibly retain the reviewed last repository snapshot before bundling.

This is historical repository evidence, not a claim about a live deployment.
Pinned vendors are represented by their original integrity manifests and reused
only when the fixture restorer proves that every pinned byte is unchanged.
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
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for member in archive.getmembers():
        if not member.isfile() or '/assets/vendor/' in member.name and not member.name.endswith('/_runtime-manifest.txt'):
            continue
        files[member.name] = archive.extractfile(member).read()
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, content in sorted(files.items()):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, content)
payload = buffer.getvalue()
(target/'source.zip').write_bytes(payload)
metadata = {'schema': 1, 'sourceCommit': COMMIT, 'deployedIdentityVerified': False,
            'archiveSha256': hashlib.sha256(payload).hexdigest(),
            'releases': {app: re.search(rb"const CACHE='([^']+)'", files[f'netunim-{app}/site/service-worker.js'])[1].decode() for app in ('orders', 'kupa')},
            'files': {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())}}
(target/'manifest.json').write_bytes((json.dumps(metadata, indent=2)+'\n').encode())
print('Captured', len(files), 'historical public files in', len(payload), 'bytes;', COMMIT)
