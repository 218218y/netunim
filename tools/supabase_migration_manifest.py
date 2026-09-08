"""Generate/check reviewed local migration expectations, never server evidence."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


MIGRATION_NAME = re.compile(r'^(\d{14})_([a-z0-9_]+)\.sql$')


def manifest():
    rows = []
    seen_versions = set()
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        match = MIGRATION_NAME.fullmatch(path.name)
        if not match:
            raise SystemExit('FAIL: invalid migration filename: ' + path.name)
        version, name = match.groups()
        if version in seen_versions:
            raise SystemExit('FAIL: duplicate migration version: ' + version)
        seen_versions.add(version)
        rows.append({
            'version': version,
            'name': name,
            'sha256': hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
        })
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    rows = manifest()
    targets = {'canonical-migrations.json': {'migrations': [{k: r[k] for k in ('version', 'name')} for r in rows]},
               'canonical-migration-manifest.json': rows}
    for filename, value in targets.items():
        path = ROOT / 'supabase' / filename
        if args.write:
            path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
        elif json.loads(path.read_text(encoding='utf8')) != value:
            raise SystemExit('FAIL: canonical migration expectations differ: ' + filename)
    print('PASS: canonical migration versions and SQL hashes match local files')
