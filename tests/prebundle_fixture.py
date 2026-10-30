"""Restore exact historical source, never replace it with current source code."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import zipfile
from browser_harness import ROOT


def restore_prebundle(app, destination):
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
    vendor = ROOT/f'netunim-{app}/site/assets/vendor'
    for manifest in (destination/'assets/vendor').rglob('_runtime-manifest.txt'):
        relative = manifest.relative_to(destination/'assets/vendor')
        assert manifest.read_bytes() == (vendor/relative).read_bytes(), 'Historical vendor changed; retain its original pinned tree'
        for digest, name in re.findall(r'^([a-f0-9]{64})  (.+)$', manifest.read_text(encoding='utf-8'), re.M):
            source = vendor/relative.parent/name
            assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, source
        shutil.copytree(vendor/relative.parent, manifest.parent, dirs_exist_ok=True)
    return metadata
