"""Retain exact per-application payloads and credential-free upload receipts."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import time
from build_release import inventory, release_id
from build_validation import require

ROOT = Path(__file__).resolve().parents[1]


def snapshot(app, release=None):
    if release is None:
        manifest = json.loads((ROOT/'.work/production'/app/'manifest.json').read_text(encoding='utf-8'))
        release = manifest['release']
    require(re.fullmatch(re.escape(app) + r'-app-shell-build-[a-f0-9]{24}', release), 'Invalid release identifier')
    target = ROOT/'.work/releases'/app/release
    require(target.resolve().is_relative_to(ROOT.resolve()), 'Release directory escapes workspace')
    return target


def verify(app, release):
    root = snapshot(app, release)
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    require(manifest['app'] == app and manifest['release'] == release, 'Build validation failed')
    require(inventory(root/'site') == manifest['files'], 'Retained payload was modified')
    require(release_id(root/'site', app) == release, 'Retained release mismatch')
    return root


def prepare(app):
    require(not (ROOT/'.work/build-locks'/app).exists(), 'Build is in progress or requires recovery')
    manifest_path = ROOT/'.work/production'/app/'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(inventory(ROOT/'dist'/app) == manifest['files'], 'Build changed before snapshot')
    target = snapshot(app, manifest['release'])
    if not target.exists():
        # Stage next to the retained payload; a failed copy never looks complete.
        stage = target.with_name(target.name + '.preparing')
        if stage.exists():
            require(inventory(stage/'site') == manifest['files'], 'Previous incomplete snapshot requires inspection')
            require((stage/'manifest.json').read_bytes() == manifest_path.read_bytes(), 'Staged manifest requires inspection')
        else:
            stage.mkdir(parents=True)
            shutil.copytree(ROOT/'dist'/app, stage/'site')
            shutil.copyfile(manifest_path, stage/'manifest.json')
        # Windows indexers can briefly retain a directory handle after copy2.
        # Retry only the atomic publish operation, never relax byte verification
        # or delete an existing retained release to force publication.
        deadline = time.monotonic()+3
        while True:
            try:
                stage.rename(target)
                break
            except PermissionError as error:
                if os.name != 'nt' or error.winerror not in (5, 32) or time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
    verify(app, manifest['release'])
    print('PASS retained independently verifiable rollback payload:', target)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'record', 'verify'))
    parser.add_argument('app', choices=('orders', 'kupa'))
    parser.add_argument('arguments', nargs='*')
    args = parser.parse_args()
    if args.action == 'verify':
        require(len(args.arguments) == 1, 'Expected release identifier')
        print(verify(args.app, args.arguments[0])/'site')
        return
    if args.action == 'prepare':
        require(len(args.arguments) <= 1, 'Expected optional per-upload release selection file')
        manifest = prepare(args.app)
        if args.arguments:
            Path(args.arguments[0]).write_bytes((manifest['release']+'\n').encode('ascii'))
    elif args.action == 'record':
        require(len(args.arguments) == 3, 'Expected exit code, Wrangler log and selected release')
        retained = verify(args.app, args.arguments[2])
        manifest = json.loads((retained/'manifest.json').read_text(encoding='utf-8'))
        code, log = int(args.arguments[0]), Path(args.arguments[1]).read_text(encoding='utf-8', errors='replace')
        urls = sorted(set(re.findall(r'https://[a-zA-Z0-9.-]+\.pages\.dev\b', log)))
        receipt = {key: manifest[key] for key in ('app', 'commit', 'release')}
        receipt.update({'project': 'bargig-'+args.app, 'recordedAt': datetime.now(timezone.utc).isoformat(),
                        'exitCode': code, 'deploymentUrls': urls})
        directory = ROOT/'.work/deployments'/args.app
        directory.mkdir(parents=True, exist_ok=True)
        name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json'
        (directory/name).write_bytes((json.dumps(receipt, indent=2)+'\n').encode())
        print('Upload receipt:', directory/name)


if __name__ == '__main__':
    main()
