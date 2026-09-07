"""Supabase release and live postflight gates.

--release-gate is intentionally offline: it proves the repository database contract
still matches the last authenticated Production deployment receipt, so a static site
deploy cannot outrun an unapplied migration. Live mode remains read-only and checks
actual catalogs whenever a connector capture or PostgreSQL connection is available.
"""
import argparse
import difflib
import json
import os
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from supabase_migration_manifest import manifest as local_manifest

ROOT = Path(__file__).resolve().parents[1]
APPLICATION_SECTIONS = ('schemas', 'tables', 'columns', 'constraints', 'indexes',
                        'sequences', 'functions', 'policies', 'triggers', 'event_triggers', 'types', 'default_privileges')


def build_fingerprint():
    """Bind an authenticated connector capture to this exact release, not a later build."""
    paths = [ROOT / 'supabase/postflight-target.json', ROOT / 'supabase/schema_inventory.sql',
             ROOT / 'supabase/retention-jobs.json', Path(__file__).resolve(),
             ROOT / 'tools/supabase_migration_manifest.py', ROOT / 'tools/supabase_capture_query.py']
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


def file_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release_gate(target, receipt_path=None):
    """Prove no repository DB contract change is pending since Production verification.

    This gate deliberately does not pretend to be a live drift check. It binds the
    current migration SQL, reviewed schema snapshot and retention contract to the
    last authenticated Production postflight receipt. Any database-contract edit
    therefore requires a new live postflight/receipt before a static upload.
    """
    receipt_path = receipt_path or ROOT / 'supabase' / target['deployment_receipt']
    try:
        receipt = json.loads(receipt_path.read_text(encoding='utf8'))
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f'FAIL: Production deployment receipt is missing or invalid: {exc}') from exc

    errors = []
    if receipt.get('project_id') != target.get('project_id'):
        errors.append('receipt targets a different Supabase project')
    if receipt.get('production_postflight') != 'PASS':
        errors.append('receipt does not record a successful Production postflight')

    source_rel = receipt.get('source_audit')
    source_hash = receipt.get('source_audit_sha256')
    if not source_rel or not source_hash:
        errors.append('receipt is missing its authenticated source-audit binding')
    else:
        source_path = ROOT / 'supabase' / source_rel
        if not source_path.is_file():
            errors.append(f'source audit is missing: {source_rel}')
        elif file_sha256(source_path) != source_hash:
            errors.append('source audit changed since the Production receipt was recorded')
        else:
            audit = json.loads(source_path.read_text(encoding='utf8'))
            if audit.get('project_id') != target.get('project_id'):
                errors.append('source audit targets a different Supabase project')
            if audit.get('production_postflight') != 'PASS':
                errors.append('source audit does not contain a successful Production postflight')
            if audit.get('schema_drift') != []:
                errors.append('source audit contains unexplained Production schema drift')

    schema_rel = receipt.get('schema_snapshot')
    if schema_rel != target.get('schema_snapshot'):
        errors.append('reviewed schema snapshot changed since the Production receipt')
    elif schema_rel:
        schema_path = ROOT / 'supabase' / schema_rel
        if not schema_path.is_file():
            errors.append(f'reviewed schema snapshot is missing: {schema_rel}')
        elif file_sha256(schema_path) != receipt.get('schema_snapshot_sha256'):
            errors.append('reviewed schema snapshot bytes changed since the Production receipt')

    reviewed_manifest = json.loads((ROOT / 'supabase' / target['manifest_snapshot']).read_text(encoding='utf8'))
    if canonical(receipt.get('migration_manifest', [])) != canonical(reviewed_manifest):
        errors.append('migration versions or SQL hashes changed since the Production receipt')

    expected_jobs = json.loads((ROOT / 'supabase/retention-jobs.json').read_text(encoding='utf8'))
    if canonical(receipt.get('retention_jobs', [])) != canonical(expected_jobs):
        errors.append('retention job contract changed since the Production receipt')

    expected_ops = {'pg_cron': True, 'database': 'postgres', 'timezone': 'GMT',
                    'server_port': 5432, 'launch_active_jobs': 'on', 'full_visibility': True}
    if canonical(receipt.get('operations', {})) != canonical(expected_ops):
        errors.append('Production operational contract in the receipt is incomplete or unexpected')

    if errors:
        raise SystemExit('FAIL: repository database contract differs from the last authenticated Production receipt; '
                         'run a live Supabase postflight and record a new receipt before site deployment.\n- ' +
                         '\n- '.join(errors))
    print('PASS: repository database contract matches the last authenticated Production receipt; no database release is pending.')
    print('INFO: this offline release gate does not claim to detect out-of-band live drift.')


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


def operational_errors(inventory):
    """Check the entire visible catalog, including renamed/extra retention jobs."""
    ops = inventory.get('operations') or {}
    errors = []
    for key, value in [('pg_cron', True), ('full_visibility', True), ('database', 'postgres'),
                       ('timezone', 'GMT'), ('launch_active_jobs', 'on')]:
        if ops.get(key) != value:
            errors.append(f'{key}: expected {value!r}, got {ops.get(key)!r}')
    expected = json.loads((ROOT / 'supabase/retention-jobs.json').read_text(encoding='utf8'))
    names = {row['jobname'] for row in expected}
    jobs = ops.get('jobs')
    if not isinstance(jobs, list):
        return errors + ['missing full cron.job inventory']
    relevant = [j for j in jobs if j.get('jobname') in names
                or re.search(r'^netunim-.*retention', j.get('jobname') or '')
                or re.search(r'prune_(document_backups|sync_operation_ledgers)', j.get('command') or '', re.I)]
    if len(relevant) != 2:
        errors.append(f'expected exactly 2 retention jobs, found {len(relevant)}')
    for wanted in expected:
        rows = [j for j in relevant if j.get('jobname') == wanted['jobname']]
        if len(rows) != 1:
            errors.append(f"{wanted['jobname']}: expected exactly one job, found {len(rows)}")
            continue
        for key, value in {**wanted, 'nodeport': ops.get('server_port')}.items():
            if rows[0].get(key) != value or value is None:
                errors.append(f"{wanted['jobname']}: {key} differs from {value!r}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
    parser.add_argument('--expected', type=Path, default=ROOT / 'supabase' / target['schema_snapshot'])
    parser.add_argument('--actual', type=Path)
    parser.add_argument('--history', type=Path, help='connector migration inventory accompanying --actual')
    parser.add_argument('--manifest', type=Path, help='server SQL hashes accompanying --actual/--history')
    parser.add_argument('--capture', type=Path, default=os.environ.get('NETUNIM_SUPABASE_CAPTURE'),
                        help='fresh, release-bound capture from the authenticated Supabase connector/CI job')
    parser.add_argument('--release-gate', action='store_true',
                        help='offline static-deploy gate bound to the last authenticated Production receipt')
    parser.add_argument('--receipt', type=Path,
                        help='test/operator override for --release-gate receipt path')
    args = parser.parse_args()
    if args.receipt and not args.release_gate:
        parser.error('--receipt is only valid with --release-gate')
    reviewed_manifest = json.loads((ROOT / 'supabase' / target['manifest_snapshot']).read_text(encoding='utf8'))
    if local_manifest() != reviewed_manifest:
        raise SystemExit('FAIL: local migration files differ from reviewed SQL hashes; no deploy allowed.')
    if args.release_gate:
        if args.actual or args.history or args.manifest:
            parser.error('--release-gate cannot be combined with --actual/--history/--manifest')
        release_gate(target, args.receipt)
        return
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
        try:
            result = subprocess.run(command, input='BEGIN READ ONLY;\n' + query + '\nROLLBACK;',
                                    env={**os.environ, 'PGCLIENTENCODING': 'UTF8', 'PGCONNECT_TIMEOUT': '10'},
                                    encoding='utf8', capture_output=True, timeout=60)
        except FileNotFoundError as exc:
            raise SystemExit('FAIL: psql is not installed or not on PATH; live Supabase postflight cannot run.') from exc
        except subprocess.TimeoutExpired as exc:
            raise SystemExit('FAIL: live Supabase catalog read timed out; no deploy allowed.') from exc
        if result.returncode:
            raise SystemExit('FAIL: cannot read live database catalogs; configure PGHOST/PGDATABASE/PGUSER and a passfile/service. No deploy allowed.')
        actual, history, manifest = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    differences = drift(expected, actual)
    if differences:
        print('\n'.join(differences))
        raise SystemExit('FAIL: unexplained application schema drift; no deploy allowed.')
    errors = operational_errors(actual)
    if errors:
        raise SystemExit('FAIL: operational infrastructure drift; no deploy allowed.\n' + '\n'.join(errors))
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
    print('PASS: pg_cron and exactly two active retention jobs match names/schedules/commands/ownership/targets; scheduler enabled in GMT.')
    if history is not None:
        print('PASS: migration history matches the reviewed ledger.')
    if manifest is not None:
        print('PASS: server migration SQL hashes match the canonical files.')


if __name__ == '__main__':
    main()
