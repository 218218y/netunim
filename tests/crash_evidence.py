"""Diagnostic evidence for owned synthetic profiles; never a repair mechanism."""
import hashlib
import json
from pathlib import Path
import zipfile

from acceptance_safety import contained,temporary_root


def classify_failure(error):
    text='\n'.join([str(error),*getattr(error,'__notes__',[])])
    if 'checksum mismatch' in text and ('LevelDB' in text or 'leveldb' in text):
        return 'native-leveldb-corruption'
    if any(code in text for code in ('storage_checksum_mismatch','storage_operation_',
                                      'storage_boundary_','storage_checkpoint_')):
        return 'application-record-validation'
    if 'page did not finish loading' in text or 'DevTools' in text:
        return 'browser-startup-or-load'
    if 'fixture_database_disappeared' in text or 'profile_canary_lost' in text:
        return 'missing-persistence-unclassified'
    return 'unclassified'


def capture_stopped_indexeddb(session, directory):
    """Called only after the harness has joined the owned process tree.

    Read/copy original bytes before Chromium can recover/delete a broken store.
    No browser profiles outside this BrowserSession scratch root are accepted.
    """
    root=temporary_root(session.tmp,'netunim-')
    profile=temporary_root(session.profile,f'netunim-{session.label}-chrome-')
    destination=Path(directory).resolve()
    if destination==root or destination.is_relative_to(root) or destination==profile or destination.is_relative_to(profile):
        raise RuntimeError('evidence destination must survive scratch cleanup')
    source=profile/'Default/IndexedDB'
    destination.mkdir(parents=True,exist_ok=False)
    rows=[]
    with zipfile.ZipFile(destination/'stopped-indexeddb.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_symlink():
                raise RuntimeError('indexeddb evidence cannot follow symlinks')
            contained(profile,file)
            if not file.is_file():
                continue
            data=file.read_bytes()
            name=file.relative_to(profile).as_posix()
            archive.writestr(name,data)
            rows.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    manifest={'syntheticOnly':True,'capturedWhileStopped':True,'files':rows,
              'archiveSha256':hashlib.sha256((destination/'stopped-indexeddb.zip').read_bytes()).hexdigest()}
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    return manifest


def snapshot_digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
