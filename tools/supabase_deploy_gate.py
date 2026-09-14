"""Verify deployed SQL and live catalogs before static publication.

A stale committed receipt is a baseline for deriving the reviewed upgrade, not
proof that Production still lacks it. The Supabase CLI owns authentication.
No migration is applied and no tracked receipt/schema is rewritten here.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from supabase_postflight import (ROOT, build_fingerprint, canonical, connector_capture,
                                release_gate, verify_evidence)
from supabase_capture_query import query
from supabase_migration_manifest import manifest as local_manifest, verify_server_manifest


def live_source():
    if os.environ.get('NETUNIM_SUPABASE_CAPTURE'):
        return 'capture'
    if os.environ.get('PGSERVICE') or all(os.environ.get(k) for k in ('PGHOST', 'PGDATABASE', 'PGUSER')):
        return 'postgres'
    if shutil.which('supabase'):
        return 'cli'
    return None


def capture_live(target, directory, source):
    if source == 'capture':
        return Path(os.environ['NETUNIM_SUPABASE_CAPTURE'])
    sql = query()
    if source == 'postgres':
        command = ['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1']
        select_sql = sql.removeprefix('BEGIN READ ONLY;\n').removesuffix('\nROLLBACK;').strip().removesuffix(';')
        input_sql = 'BEGIN READ ONLY;\nselect row_to_json(capture_row) from ('+select_sql+') capture_row;\nROLLBACK;'
    else:
        path = directory/'catalog.sql'
        path.write_text(sql, encoding='utf8')
        command = [shutil.which('supabase') or 'supabase', 'db', 'query', '--linked',
                   '--project-ref', target['project_id'], '--output', 'json', '--file', str(path)]
        input_sql = None
    try:
        result = subprocess.run(command, cwd=ROOT, input=input_sql, stdin=subprocess.DEVNULL if input_sql is None else None,
                                env={**os.environ, 'PGCLIENTENCODING': 'UTF8', 'PGCONNECT_TIMEOUT': '10'},
                                encoding='utf8', capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit('FAIL: live Supabase catalog read unavailable/timed out. No site uploaded.') from error
    if result.returncode:
        # CLI diagnostics may include connection details; never echo them or tokens.
        raise SystemExit('FAIL: live Supabase catalog read failed. Check connectivity and supabase login; '
                         'the CLI must support db query --linked --project-ref --file --output json. No site uploaded.')
    try:
        payload = json.loads(result.stdout)
        rows = payload.get('rows') if isinstance(payload, dict) and 'inventory' not in payload else payload
        if isinstance(rows, list):
            if len(rows) != 1:
                raise ValueError('expected one catalog row')
            rows = rows[0]
        if not isinstance(rows, dict) or not all(k in rows for k in ('inventory', 'manifest', 'migrations', 'captured_at', 'project_id', 'build_fingerprint')):
            raise ValueError('incomplete capture')
    except (ValueError, TypeError) as error:
        raise SystemExit('FAIL: Supabase returned an incomplete/unrecognized catalog response. No site uploaded.') from error
    path = directory/'capture.json'
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf8')
    return path


def expected_upgrade(target, reviewed_manifest):
    # Imported only for pending releases: ordinary static deployments need no
    # local PostgreSQL installation and never run the repository test suite.
    from supabase_candidate_schema import (validate_authenticated_receipt,
                                          migration_files_for_deployed_prefix,
                                          replay_upgrade_candidate)
    receipt = json.loads((ROOT/'supabase'/target['deployment_receipt']).read_text(encoding='utf8'))
    pending = validate_authenticated_receipt(target, receipt, reviewed_manifest)
    expected = json.loads((ROOT/'supabase'/target['schema_snapshot']).read_text(encoding='utf8'))
    if pending:
        print('Verifying the reviewed database upgrade against the authenticated baseline...', flush=True)
        prefix, suffix, _ = migration_files_for_deployed_prefix(receipt['migration_manifest'], reviewed_manifest)
        expected = replay_upgrade_candidate(prefix, suffix, expected)
    return expected


def verify():
    target = json.loads((ROOT/'supabase/postflight-target.json').read_text(encoding='utf8'))
    reviewed = json.loads((ROOT/'supabase'/target['manifest_snapshot']).read_text(encoding='utf8'))
    if local_manifest() != reviewed:
        raise SystemExit('FAIL: local migration files differ from reviewed SQL hashes; no deploy allowed.')
    source = live_source()
    if source is None:
        try:
            release_gate(target)
        except SystemExit as error:
            raise SystemExit('FAIL: database release needs live verification. Install the Supabase CLI and run supabase login once, '
                             'or configure PostgreSQL access/a fresh connector capture. Then rerun deployment; '
                             'do not reapply a migration just because the saved receipt is old.\n'+str(error)) from error
        return
    fingerprint = build_fingerprint()
    print('Checking live Supabase migration SQL and application schema...', flush=True)
    with tempfile.TemporaryDirectory(prefix='netunim-supabase-deploy-') as directory:
        capture = capture_live(target, Path(directory), source)
        actual, history, server_manifest = connector_capture(capture, target)
        # Check the live ledger FIRST. A missing/edited migration is diagnosed
        # before spending time replaying an expected schema locally.
        wanted_history = json.loads((ROOT/'supabase'/target['migration_snapshot']).read_text(encoding='utf8'))['migrations']
        if canonical(history) != canonical(wanted_history):
            raise SystemExit('FAIL: live migration history differs from the reviewed code. Apply the missing reviewed migrations; no site uploaded.')
        try:
            verify_server_manifest(server_manifest, reviewed)
        except (ValueError, OSError) as error:
            raise SystemExit('FAIL: live migration SQL differs from the reviewed code. '+str(error)) from error
        expected = expected_upgrade(target, reviewed)
        verify_evidence(target, expected, actual, history, server_manifest)
        if connector_capture(capture, target) != (actual, history, server_manifest) or build_fingerprint() != fingerprint:
            raise SystemExit('FAIL: release/capture changed during verification; retry. No site uploaded.')
    print('PASS: live Production matches this code, including reviewed migrations. Static deployment is allowed.')


if __name__ == '__main__':
    verify()
