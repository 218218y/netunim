"""Retain exact per-application payloads and credential-free upload receipts."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
from build_release import inventory, release_id

ROOT = Path(__file__).resolve().parents[1]


def snapshot(app, release=None):
    if release is None:
        manifest = json.loads((ROOT/'.work/production'/app/'manifest.json').read_text(encoding='utf-8'))
        release = manifest['release']
    assert re.fullmatch(re.escape(app) + r'-app-shell-build-[a-f0-9]{24}', release), 'Invalid release identifier'
    return ROOT/'.work/releases'/app/release


def verify(app, release):
    root = snapshot(app, release)
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['app'] == app and manifest['release'] == release
    assert inventory(root/'site') == manifest['files'], 'Retained payload was modified'
    assert release_id(root/'site', app) == release, 'Retained release mismatch'
    return root


def prepare(app):
    manifest_path = ROOT/'.work/production'/app/'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert inventory(ROOT/'dist'/app) == manifest['files'], 'Build changed before snapshot'
    target = snapshot(app, manifest['release'])
    if not target.exists():
        # Stage next to the retained payload; a failed copy never looks complete.
        stage = target.with_name(target.name + '.preparing')
        assert not stage.exists(), 'Previous incomplete snapshot requires inspection'
        stage.mkdir(parents=True)
        shutil.copytree(ROOT/'dist'/app, stage/'site')
        shutil.copyfile(manifest_path, stage/'manifest.json')
        stage.rename(target)
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
        assert len(args.arguments) == 1, 'Expected release identifier'
        print(verify(args.app, args.arguments[0])/'site')
        return
    manifest = prepare(args.app)
    if args.action == 'record':
        assert len(args.arguments) == 2, 'Expected exit code and Wrangler log'
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
