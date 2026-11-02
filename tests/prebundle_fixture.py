"""Restore exact historical source, never replace it with current source code."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def restore_vendors(destination, payload):
    """Restore only the exact vendor trees declared by historical manifests."""
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate historical vendor archive entry')
        for manifest in (destination/'assets/vendor').rglob('_runtime-manifest.txt'):
            original = manifest.read_bytes()
            tree = hashlib.sha256(original).hexdigest()+'/'
            entries = re.findall(r'^([a-f0-9]{64})  (.+)$', original.decode('utf-8'), re.M)
            expected = {name for _, name in entries} | {'_runtime-manifest.txt'}
            if not entries or len(expected) != len(entries)+1:
                raise ValueError('Invalid historical vendor manifest')
            if {name[len(tree):] for name in names if name.startswith(tree)} != expected:
                raise ValueError('Historical vendor archive differs from manifest')
            if archive.read(tree+'_runtime-manifest.txt') != original:
                raise ValueError('Historical vendor manifest bytes changed')
            verified = {}
            for digest, name in entries:
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
                    raise ValueError('Unsafe historical vendor path')
                content = archive.read(tree+name)
                if hashlib.sha256(content).hexdigest() != digest:
                    raise ValueError('Historical vendor digest mismatch: '+name)
                verified[name] = content
            for name, content in verified.items():
                output = manifest.parent/name
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(content)


def restore_prebundle(app, destination):
    if app not in ('orders', 'kupa'):
        raise ValueError('Unknown historical application')
    metadata = json.loads((ROOT/'tests/fixtures/prebundle/manifest.json').read_text())
    payload = ROOT/'tests/fixtures/prebundle/source.zip'
    assert hashlib.sha256(payload.read_bytes()).hexdigest() == metadata['archiveSha256']
    prefix = f'netunim-{app}/site/'
    with zipfile.ZipFile(payload) as archive:
        assert set(archive.namelist()) == set(metadata['files'])
        for name in archive.namelist():
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name
            if not name.startswith(prefix):
                continue
            content = archive.read(name)
            assert hashlib.sha256(content).hexdigest() == metadata['files'][name], name
            output = destination/name[len(prefix):]
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(content)
    vendors = (ROOT/'tests/fixtures/prebundle/vendors.zip').read_bytes()
    if hashlib.sha256(vendors).hexdigest() != metadata['vendorArchiveSha256']:
        raise ValueError('Historical vendor archive integrity mismatch')
    restore_vendors(destination, vendors)
    return metadata
