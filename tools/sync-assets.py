"""Refresh deterministic public app-shell lists. No bundling or runtime build.

Run after adding/removing assets; --check is used by the verification gate.
"""
from pathlib import Path
import argparse
import re
import hashlib

ROOT = Path(__file__).resolve().parents[1]
TEXT_ASSET_SUFFIXES = {'.html', '.css', '.js', '.webmanifest'}


def asset_hash_bytes(path):
    """Ignore checkout newline conventions, not real content or binary bytes."""
    data = path.read_bytes()
    if path.suffix.lower() in TEXT_ASSET_SUFFIXES or path.name == '_headers':
        return data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    return data


def sync(check=False):
    clean = True
    for label in ('kupa', 'orders'):
        site = ROOT / f'netunim-{label}/site'
        shared = site / 'assets/js/shared'
        for source_file in sorted((ROOT/'shared').glob('*.js')):
            target = shared / source_file.name
            expected = source_file.read_bytes()
            if not target.is_file() or target.read_bytes() != expected:
                clean = False
                if check:
                    print(f'FAIL {label}: shared source differs: {source_file.name}')
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(expected)
        worker = site / 'service-worker.js'
        source = worker.read_text(encoding='utf-8')
        shell = ['./', './index.html', './assets/app.css']
        assets = sorted((site/'assets').rglob('*.js'), key=lambda p: p.relative_to(site).as_posix())
        shell += ['./'+p.relative_to(site).as_posix() for p in assets]
        shell += ['./manifest.webmanifest', './supabase/config.js', './favicon.ico', './favicon-16x16.png', './favicon-32x32.png', './apple-touch-icon.png', './android-chrome-192x192.png', './android-chrome-512x512.png']
        updated, count = re.subn(r'(const\s+SHELL\s*=\s*)\[[\s\S]*?\]', lambda m: m[1]+'[\n'+',\n'.join('  '+repr(p) for p in shell)+'\n]', source)
        if count != 1:
            raise ValueError(f'{label}: missing SHELL declaration')
        digest=hashlib.sha256()
        for item in shell[1:]+['./_headers']:
            digest.update(item.encode('utf-8'))
            digest.update(asset_hash_bytes(site/item[2:]))
        updated, count = re.subn(r"const CACHE='[^']+';",f"const CACHE='{label}-app-shell-esm-{digest.hexdigest()[:12]}';",updated)
        if count != 1:
            raise ValueError(f'{label}: expected exactly one CACHE declaration')
        if updated != source:
            clean = False
            if check:
                print(f'FAIL {label}: run python tools/sync-assets.py to refresh the shell')
            else:
                worker.write_text(updated, encoding='utf-8', newline='\n')
    return clean


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    raise SystemExit(1 if not sync(args.check) and args.check else 0)
