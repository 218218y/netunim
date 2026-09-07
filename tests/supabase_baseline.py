"""Clean install parity on a disposable local PostgreSQL cluster, never Production."""
import json
import sys
import subprocess
from datetime import datetime, timezone, timedelta
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import drift, build_fingerprint, connector_capture
from build_schema_baseline import render

expected = json.loads((ROOT / 'supabase/audit/production-schema.json').read_text(encoding='utf8'))
migrations = sorted((ROOT / 'supabase/migrations').glob('*_production_schema_baseline.sql'))
assert len(migrations) == 1
assert migrations[0].read_text(encoding='utf8') == render(expected), 'baseline generation drift'
with IsolatedPostgres(schema_files=migrations) as db:
    actual = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    differences = drift(expected, actual)
    if differences:
        (ROOT / 'supabase/audit/clean-install-drift.txt').write_text('\n'.join(differences), encoding='utf8')
        raise AssertionError('clean install schema differs; inspect supabase/audit/clean-install-drift.txt')
    # Prove the verifier rejects a changed definition, privilege, policy and column.
    for mutate in [
        'alter function public.get_netunim_sync_capabilities() security invoker',
        'grant execute on function public.get_netunim_sync_capabilities() to anon',
        'create policy fixture_bad_policy on public.shared_checks_documents for select using (true)',
        'alter table public.shared_checks_documents add column fixture_drift text',
    ]:
        changed = json.loads(db.sql('begin;' + mutate + ';' + (ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8') + '\nrollback;'))
        assert drift(expected, changed), 'postflight failed to detect: ' + mutate
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    # The default deploy target is now the normalized/upgraded release. Validate
    # that full chain after preserving the independent historical baseline test.
    for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if migration not in migrations:
            db.migrate(migration.read_text(encoding='utf8'))
    # Exercise the actual deployment command's live read-only connection, including
    # ledger drift. The URL cannot escape this disposable cluster.
    target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
    history = json.loads((ROOT / 'supabase' / target['migration_snapshot']).read_text(encoding='utf8'))['migrations']
    db.sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text,name text,statements text[]);' +
           ''.join('insert into supabase_migrations.schema_migrations values(' + quote(r['version']) + ',' + quote(r['name']) + ',ARRAY[' + quote((ROOT / 'supabase/migrations' / (r['version'] + '_' + r['name'] + '.sql')).read_text(encoding='utf8')) + ']);' for r in history))
    env = {**db.env, 'PGHOST': '127.0.0.1', 'PGPORT': str(db.port), 'PGDATABASE': 'postgres', 'PGUSER': 'postgres', 'PYTHONUTF8': '1'}
    def live_gate():
        return subprocess.run([sys.executable, str(ROOT / 'tools/supabase_postflight.py')], env=env, capture_output=True, encoding='utf8', timeout=30)
    result = live_gate()
    assert result.returncode != 0 and 'pg_cron: expected True, got False' in result.stderr, result.stdout + result.stderr
    # An authenticated connector/CI handoff has the same schema/history gate and
    # must additionally reject expired, wrong-project or different-build evidence.
    capture = {'project_id': target['project_id'], 'captured_at': datetime.now(timezone.utc).isoformat(),
               'build_fingerprint': build_fingerprint(), 'inventory': json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8'))), 'migrations': history,
               'manifest': json.loads((ROOT / 'supabase' / target['manifest_snapshot']).read_text(encoding='utf8'))}
    # Synthetic extension/worker evidence ONLY in this disposable test handoff.
    # Windows does not ship pg_cron. Its absence above must block a real deploy.
    capture['inventory']['operations'].update(pg_cron=True, timezone='GMT', launch_active_jobs='on')
    capture_file = db.tmp / 'capture.json'
    capture_file.write_text(json.dumps(capture), encoding='utf8')
    assert connector_capture(capture_file, target)[1] == history
    def fixture_gate():
        capture['inventory'] = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
        capture['inventory']['operations'].update(pg_cron=True, timezone='GMT', launch_active_jobs='on')
        capture['migrations'] = json.loads(db.sql("select json_agg(json_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations"))
        from supabase_postflight import migration_manifest_sql
        capture['manifest'] = json.loads(db.sql(migration_manifest_sql()))
        capture_file.write_text(json.dumps(capture), encoding='utf8')
        return subprocess.run([sys.executable, str(ROOT / 'tools/supabase_postflight.py'), '--capture', str(capture_file)], env=env, capture_output=True, encoding='utf8', timeout=30)
    result = fixture_gate()
    assert result.returncode == 0, result.stdout + result.stderr
    for field, invalid in [('project_id', 'different-project'), ('build_fingerprint', 'different-build'),
                           ('captured_at', (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat())]:
        capture_file.write_text(json.dumps({**capture, field: invalid}), encoding='utf8')
        try:
            connector_capture(capture_file, target)
            raise AssertionError('invalid connector evidence accepted: ' + field)
        except SystemExit as error:
            assert str(error).startswith('FAIL:')
    db.sql('alter function public.get_netunim_sync_capabilities() security definer;')
    assert 'application schema drift' in fixture_gate().stderr, 'deploy gate accepted function drift'
    db.sql('alter function public.get_netunim_sync_capabilities() security invoker;')
    db.sql("update supabase_migrations.schema_migrations set statements=ARRAY['unreviewed SQL'];")
    assert 'recorded migration SQL' in fixture_gate().stderr, 'deploy gate accepted migration SQL drift'
    db.sql("update supabase_migrations.schema_migrations set name='unreviewed fixture change';")
    assert 'migration history differs' in fixture_gate().stderr, 'deploy gate accepted ledger drift'
print('PASS application clean install, fixture capture schema/history gates, real-extension absence fail-closed, and finance fence regressions (Windows cron model)')
