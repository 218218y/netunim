"""Read-only deploy gate: compare live application catalogs with the reviewed schema.

Use PostgreSQL's normal environment/service/passfile configuration; no credentials
in arguments or output. --actual accepts a fresh connector inventory for review.
Live mode forces a read-only transaction and fails on missing access or drift.
"""
import argparse
import difflib
import json
import os
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
APPLICATION_SECTIONS = ('schemas', 'tables', 'columns', 'constraints', 'indexes',
                        'sequences', 'functions', 'policies', 'triggers', 'event_triggers', 'types', 'default_privileges')


def build_fingerprint():
    """Bind an authenticated connector capture to this exact release, not a later build."""
    paths = [ROOT / 'supabase/postflight-target.json', ROOT / 'supabase/schema_inventory.sql']
    paths += sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    target = json.loads(paths[0].read_text(encoding='utf8'))
    paths += [ROOT / 'supabase' / target['schema_snapshot'], ROOT / 'supabase' / target['migration_snapshot']]
    paths.append(ROOT / 'supabase' / target['manifest_snapshot'])
    for app in ('orders', 'kupa'):
        paths += sorted(p for p in (ROOT / f'netunim-{app}/site').rglob('*') if p.is_file())
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.relative_to(ROOT).as_posix().encode('utf8'))
        digest.update(b'\0')
        digest.update(path.read_bytes())
        digest.update(b'\0')
    return digest.hexdigest()


def connector_capture(path, target):
    """A read-only connected Supabase job can supply evidence instead of DB credentials.

    This is an operator/CI handoff, not a cryptographic attestation. The capture must
    come from the authorized live connector; offline --actual comparisons cannot
    manufacture it. Freshness, project, build, full schema and ledger are all checked.
    """
    capture = json.loads(path.read_text(encoding='utf8'))
    if capture['project_id'] != target['project_id']:
        raise SystemExit('FAIL: connector capture targets a different Supabase project')
    stamp = datetime.fromisoformat(capture['captured_at'].replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - stamp).total_seconds()
    if age < -30 or age > 300:
        raise SystemExit('FAIL: connector capture expired; fetch live catalogs again before deployment')
    if capture['build_fingerprint'] != build_fingerprint():
        raise SystemExit('FAIL: release changed since the connector capture; fetch live catalogs again')
    return capture['inventory'], capture['migrations'], capture['manifest']


def migration_manifest_sql():
    return "select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'sha256',encode(sha256(convert_to(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n'),'UTF8')),'hex')) order by version),'[]') from supabase_migrations.schema_migrations;"


def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return sorted((canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
    if isinstance(value, str):
        return value.replace('\r\n', '\n')
    return value


def application_schema(inv):
    # pg17 expresses NOT NULL in pg_attribute; pg18 also exposes pg_constraint
    # rows. The complete column not_null contract is checked on both versions.
    out = {key: inv[key] or [] for key in APPLICATION_SECTIONS}
    out['constraints'] = [c for c in out['constraints'] if c['type'] != 'n']
    # ACL order is not semantic; privilege sets and grantors ARE compared.
    def acls(v):
        if isinstance(v, dict):
            return {k: sorted(x.strip('{}').split(',')) if k == 'acl' and x is not None else acls(x) for k, x in v.items()}
        if isinstance(v, list):
            return [acls(x) for x in v]
        return v
    return canonical(acls(out))


def drift(expected, actual):
    a = json.dumps(application_schema(expected), ensure_ascii=False, indent=2, sort_keys=True).splitlines()
    b = json.dumps(application_schema(actual), ensure_ascii=False, indent=2, sort_keys=True).splitlines()
    return list(difflib.unified_diff(a, b, fromfile='reviewed schema', tofile='actual schema', lineterm=''))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
    parser.add_argument('--expected', type=Path, default=ROOT / 'supabase' / target['schema_snapshot'])
    parser.add_argument('--actual', type=Path)
    parser.add_argument('--history', type=Path, help='connector migration inventory accompanying --actual')
    parser.add_argument('--manifest', type=Path, help='server SQL hashes accompanying --actual/--history')
    parser.add_argument('--capture', type=Path, default=os.environ.get('NETUNIM_SUPABASE_CAPTURE'),
                        help='fresh, release-bound capture from the authenticated Supabase connector/CI job')
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text(encoding='utf8'))
    if args.capture:
        if args.actual or args.history or args.manifest:
            parser.error('--capture cannot be combined with offline --actual/--history/--manifest')
        actual, history, manifest = connector_capture(args.capture, target)
    elif args.actual:
        actual = json.loads(args.actual.read_text(encoding='utf8'))
        history = json.loads(args.history.read_text(encoding='utf8'))['migrations'] if args.history else None
        manifest = json.loads(args.manifest.read_text(encoding='utf8')) if args.manifest else None
    else:
        query = (ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')
        query += "\nselect coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]') from supabase_migrations.schema_migrations;"
        query += '\n' + migration_manifest_sql()
        command = ['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1']
        result = subprocess.run(command, input='BEGIN READ ONLY;\n' + query + '\nROLLBACK;',
                                env={**os.environ, 'PGCLIENTENCODING': 'UTF8', 'PGCONNECT_TIMEOUT': '10'},
                                encoding='utf8', capture_output=True, timeout=60)
        if result.returncode:
            raise SystemExit('FAIL: cannot read live database catalogs; configure PGHOST/PGDATABASE/PGUSER and a passfile/service. No deploy allowed.')
        actual, history, manifest = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    differences = drift(expected, actual)
    if differences:
        print('\n'.join(differences))
        raise SystemExit('FAIL: unexplained application schema drift; no deploy allowed.')
    if history is not None:
        expected_history = json.loads((ROOT / 'supabase' / target['migration_snapshot']).read_text(encoding='utf8'))['migrations']
        if canonical(history) != canonical(expected_history):
            raise SystemExit('FAIL: migration history differs from the reviewed ledger; no deploy allowed.')
    if manifest is not None:
        expected_manifest = json.loads((ROOT / 'supabase' / target['manifest_snapshot']).read_text(encoding='utf8'))
        actual_manifest = [{k: row[k] for k in ('version', 'name', 'sha256')} for row in manifest]
        if canonical(actual_manifest) != canonical(expected_manifest):
            raise SystemExit('FAIL: recorded migration SQL differs from reviewed file hashes; no deploy allowed.')
    print('PASS: application tables/columns/constraints/indexes/functions/security/grants/policies/triggers match the reviewed schema.')
    if history is not None:
        print('PASS: migration history matches the reviewed ledger.')
    if manifest is not None:
        print('PASS: server migration SQL hashes match the canonical files.')


if __name__ == '__main__':
    main()
