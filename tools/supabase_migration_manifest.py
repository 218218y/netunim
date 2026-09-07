"""Generate/check reviewed local migration expectations, never server evidence."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def manifest():
    return [{'version': p.name.split('_', 1)[0], 'name': p.name.split('_', 1)[1][:-4],
             'sha256': hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()}
            for p in sorted((ROOT / 'supabase/migrations').glob('*.sql'))]


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
