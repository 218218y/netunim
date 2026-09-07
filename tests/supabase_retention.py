"""Retention migration and deploy rejection contracts; no Production access.

Windows fixture models cron catalog APIs, not its binary/background worker.
Missing real pg_cron is separately required to FAIL the actual live gate.
"""
import copy
import json
import re
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime, timezone
from isolated_sync_postgres import IsolatedPostgres, ROOT

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import operational_errors, build_fingerprint, drift
from supabase_migration_manifest import manifest

EXPECTED = json.loads((ROOT / 'supabase/retention-jobs.json').read_text(encoding='utf8'))


def model():
    return {'operations': {'pg_cron': True, 'full_visibility': True, 'database': 'postgres',
            'server_port': 5432, 'timezone': 'GMT', 'launch_active_jobs': 'on',
            'jobs': [{**row, 'jobid': i + 1, 'nodeport': 5432} for i, row in enumerate(EXPECTED)]}}


class RetentionContracts(unittest.TestCase):
    def test_expected_and_unrelated_jobs(self):
        value = model()
        self.assertEqual(operational_errors(value), [])
        value['operations']['jobs'].append({'jobname': 'unrelated', 'command': 'select 1'})
        self.assertEqual(operational_errors(value), [])

    def test_each_operational_drift_fails(self):
        changes = [
            lambda o: o.update(pg_cron=False), lambda o: o.update(full_visibility=False),
            lambda o: o.update(timezone='Asia/Jerusalem'), lambda o: o.update(launch_active_jobs='off'),
            lambda o: o.update(jobs=None), lambda o: o['jobs'].pop(),
            lambda o: o['jobs'].append(copy.deepcopy(o['jobs'][0])),
            lambda o: o['jobs'].append({**o['jobs'][0], 'jobname': 'renamed-extra'}),
        ] + [lambda o, field=key, value=value: o['jobs'][0].update({field: value}) for key, value in [
            ('jobname', 'renamed'), ('schedule', '* * * * *'), ('command', 'select 1'),
            ('active', False), ('active', None), ('username', 'authenticated'),
            ('database', 'other'), ('nodename', 'remote'), ('nodeport', 1111)]]
        for change in changes:
            with self.subTest(change=change):
                value = model()
                change(value['operations'])
                self.assertTrue(operational_errors(value))
        self.assertTrue(operational_errors({}))

    def test_clean_chain_rerun_repair_and_atomic_duplicate_rejection(self):
        files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        migration = next(p for p in files if p.name.endswith('_retention_cron_jobs.sql')).read_text(encoding='utf8')
        inventory_sql = (ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')
        with IsolatedPostgres(schema_files=files, demotable_postgres=True) as db:
            before = json.loads(db.sql(inventory_sql))
            jobs = before['operations']['jobs']
            self.assertEqual(len(jobs), 2)
            before['operations'].update(pg_cron=True, timezone='GMT', launch_active_jobs='on')
            self.assertEqual(operational_errors(before), [])
            # Any accidental direct invocation must throw, even on empty tables.
            definitions = db.sql("select pg_get_functiondef(oid) || ';' from pg_proc where pronamespace='netunim_internal'::regnamespace and proname in ('prune_document_backups','prune_sync_operation_ledgers')")
            traps = re.sub(r'AS \$function\$.*?\$function\$', "AS $function$ BEGIN RAISE EXCEPTION 'prune invoked during migration'; END $function$", definitions, flags=re.S)
            self.assertEqual(traps.count('prune invoked during migration'), 2)
            fixture_migration = migration.replace('create extension if not exists pg_cron;', '-- Windows fixture')
            db.sql('begin;\n' + traps + '\n' + fixture_migration + '\n' + fixture_migration + '\nrollback;')
            db.sql('begin;\n' + traps + '\ndelete from cron.job;\n' + fixture_migration + '\nrollback;')
            # Both normal reruns preserve IDs and every job field, and application catalogs.
            db.migrate(migration)
            db.migrate(migration)
            barrier = Barrier(2)
            def concurrent_rerun():
                barrier.wait()
                db.migrate(migration)
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_rerun) for _ in range(2)]
                for future in futures:
                    future.result(timeout=30)
            after = json.loads(db.sql(inventory_sql))
            self.assertEqual(after['operations']['jobs'], jobs)
            self.assertFalse(drift(before, after))
            db.sql("update cron.job set active=false,schedule='* * * * *',command='select 1';")
            db.migrate(migration)
            self.assertEqual(json.loads(db.sql(inventory_sql))['operations']['jobs'], jobs)
            for mutate in [
                "insert into cron.job(jobname,schedule,command,username) select jobname,schedule,command,'foreign' from cron.job limit 1;",
                "update cron.job set database='other';",
            ]:
                with self.assertRaisesRegex(RuntimeError, 'Ambiguous retention jobs'):
                    db.sql('begin; ' + mutate + '\n' + fixture_migration + '\ncommit;')
                self.assertEqual(json.loads(db.sql(inventory_sql))['operations']['jobs'], jobs)
            with self.assertRaisesRegex(RuntimeError, 'Ambiguous retention jobs'):
                db.sql("begin; insert into cron.job(jobname,schedule,command) select 'renamed-extra',schedule,command from cron.job limit 1;\n" + fixture_migration + '\ncommit;')
            self.assertEqual(json.loads(db.sql(inventory_sql))['operations']['jobs'], jobs)
            # Execute the deployment entrypoint; operational failures must block it.
            target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
            capture = {'project_id': target['project_id'], 'captured_at': datetime.now(timezone.utc).isoformat(),
                       'build_fingerprint': build_fingerprint(), 'inventory': before,
                       'migrations': [{k: r[k] for k in ('version', 'name')} for r in manifest()], 'manifest': manifest()}
            path = db.tmp / 'explicit-test-fixture-capture.json'
            for field, value in [('valid', None), ('pg_cron', False), ('full_visibility', False),
                                 ('jobs', jobs[:1]), ('jobs', jobs + jobs[:1]), ('launch_active_jobs', 'off')]:
                test_capture = copy.deepcopy(capture)
                if field != 'valid':
                    test_capture['inventory']['operations'][field] = value
                path.write_text(json.dumps(test_capture), encoding='utf8')
                result = subprocess.run([sys.executable, str(ROOT / 'tools/supabase_postflight.py'), '--capture', str(path)], capture_output=True, encoding='utf8', timeout=30)
                if field == 'valid':
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('operational infrastructure drift', result.stderr)
            # Match the hosted postgres role: bypass RLS, extension-table SELECT,
            # but no direct catalog writes/locks. Existing exact jobs need no API writes.
            db.sql('alter table cron.job owner to supabase_admin; grant select on cron.job to postgres; alter role postgres nosuperuser bypassrls;')
            with self.assertRaisesRegex(RuntimeError, 'permission denied for table job'):
                db.sql('begin; lock table cron.job in share row exclusive mode; rollback;')
            db.migrate(migration)
            self.assertEqual(json.loads(db.sql(inventory_sql))['operations']['jobs'], jobs)


if __name__ == '__main__':
    unittest.main(verbosity=2)
