"""Release contracts for the canonical migration chain and reviewed Advisor notices."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
import shutil
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_schema_baseline import render
from supabase_postflight import (drift, manifest_pending_suffix, normalized_text_sha256,
                                release_contract_errors)
from supabase_migration_manifest import split_sql_statements, verify_server_manifest


def read(name):
    return json.loads((ROOT / 'supabase' / name).read_text(encoding='utf8'))


class SupabaseContracts(unittest.TestCase):
    def test_cli_statement_storage_matches_observed_migrations_without_changing_file_hashes(self):
        rows = json.loads((ROOT/'tests/fixtures/morning_cli_migration_statements.json').read_text(encoding='utf8'))
        reviewed = read(read('postflight-target.json')['manifest_snapshot'])
        server = json.loads(json.dumps(reviewed))
        for row in rows:
            path = ROOT/'supabase/migrations'/(row['version']+'_'+row['name']+'.sql')
            self.assertEqual(split_sql_statements(path.read_text(encoding='utf8')), row['statements'])
            item = next(r for r in server if r['version'] == row['version'])
            item['sha256'] = hashlib.sha256('\n'.join(row['statements']).encode('utf8')).hexdigest()
        formats = verify_server_manifest(server, reviewed)
        formats_by_version = {r['version']: r['storage'] for r in formats}
        self.assertEqual([formats_by_version[r['version']] for r in rows], ['cli-statements-lf-v1']*len(rows))
        for case in ('reordered', 'missing', 'extra', 'changed-string', 'changed-comment', 'renamed'):
            bad = json.loads(json.dumps(server))
            if case == 'reordered': bad[-1], bad[-2] = bad[-2], bad[-1]
            elif case == 'missing': bad.pop()
            elif case == 'extra': bad.append(bad[-1])
            elif case == 'renamed': bad[-1]['name'] += '_changed'
            else:
                changed = '\n'.join(rows[-1]['statements'])
                changed = changed.replace("'pending'", "'failed'", 1) if case == 'changed-string' else changed.replace('-- Separate', '-- CHANGED', 1)
                bad[-1]['sha256'] = hashlib.sha256(changed.encode('utf8')).hexdigest()
            with self.assertRaises(ValueError, msg=case): verify_server_manifest(bad, reviewed)

    def test_statement_hashing_preserves_quoted_bodies_comments_and_internal_whitespace(self):
        statements = [
            "-- ; heading\nselect 'a;''b', \"odd;\"\"name\"",
            r"select E'escaped\';semi'",
            "/* nested /* ; */ comment */ do $outer$ begin perform $inner$;$inner$; end $outer$",
            "select  1 /* keep spacing; */",
        ]
        self.assertEqual(split_sql_statements(';\n\n'.join(statements)+';\n'), statements)
        self.assertEqual(split_sql_statements((';\n'.join(statements)+';').replace('\n','\r\n')), statements)
        for invalid in ("select 'missing", 'select "missing', 'do $tag$ missing', '/* unclosed',
                        'begin atomic select 1; end;', 'copy t from stdin;', 'set standard_conforming_strings=off;'):
            with self.assertRaises(ValueError, msg=invalid): split_sql_statements(invalid)

    def test_record_release_requires_fresh_matching_capture_and_preserves_evidence_on_failure(self):
        # Synthetic evidence lives ONLY in a disposable copy. Exercise the real CLI
        # and artifact binding; never overwrite the repository's Production evidence.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = read('postflight-target.json')
            paths = [ROOT/'tools'/name for name in ('supabase_postflight.py', 'supabase_migration_manifest.py', 'supabase_capture_query.py')]
            paths += list((ROOT/'supabase/migrations').glob('*.sql'))
            paths += [ROOT/'supabase'/name for name in ('postflight-target.json', 'schema_inventory.sql', 'retention-jobs.json',
                      target['schema_snapshot'], target['migration_snapshot'], target['manifest_snapshot'], target['deployment_receipt'])]
            for path in paths:
                destination = root/path.relative_to(ROOT)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
            fingerprint = subprocess.check_output([sys.executable, '-c', 'from supabase_postflight import build_fingerprint; print(build_fingerprint())'],
                                                  cwd=root/'tools', encoding='utf8').strip()
            capture = {'project_id': target['project_id'], 'captured_at': datetime.now(timezone.utc).isoformat(),
                       'build_fingerprint': fingerprint, 'inventory': read(target['schema_snapshot']),
                       'migrations': read(target['migration_snapshot'])['migrations'], 'manifest': read(target['manifest_snapshot'])}
            # New CLI statement-array encoding must produce a receipt bound to
            # unchanged reviewed file hashes while retaining the raw server hash.
            last = capture['manifest'][-1]
            source = (ROOT/'supabase/migrations'/(last['version']+'_'+last['name']+'.sql')).read_text(encoding='utf8')
            last['sha256'] = hashlib.sha256('\n'.join(split_sql_statements(source)).encode('utf8')).hexdigest()
            command = [sys.executable, str(root/'tools/supabase_postflight.py')]
            capture_path = root/'capture.json'
            before = {p.relative_to(root): p.read_bytes() for p in (root/'supabase').rglob('*') if p.is_file()}
            def invoke(args):
                return subprocess.run(command+args, capture_output=True, encoding='utf8', timeout=30)
            for args in (['--record-release'], ['--record-release', '--actual', str(root/'supabase'/target['schema_snapshot'])],
                         ['--record-release', '--release-gate', '--capture', str(capture_path)]):
                self.assertNotEqual(invoke(args).returncode, 0)
            for case in ('expired', 'wrong-project', 'wrong-build', 'schema', 'history', 'sql', 'operations'):
                bad = json.loads(json.dumps(capture))
                if case == 'expired': bad['captured_at'] = (datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat()
                elif case == 'wrong-project': bad['project_id'] = 'different-project'
                elif case == 'wrong-build': bad['build_fingerprint'] = '0'*64
                elif case == 'schema': bad['inventory']['columns'] = []
                elif case == 'history': bad['migrations'] = bad['migrations'][:-1]
                elif case == 'sql': bad['manifest'][-1]['sha256'] = '0'*64
                elif case == 'operations': bad['inventory']['operations']['pg_cron'] = False
                capture_path.write_text(json.dumps(bad), encoding='utf8')
                result = invoke(['--capture', str(capture_path), '--record-release'])
                self.assertNotEqual(result.returncode, 0, case)
                after = {p.relative_to(root): p.read_bytes() for p in (root/'supabase').rglob('*') if p.is_file()}
                self.assertEqual(before, after, case)
            capture_path.write_text(json.dumps(capture), encoding='utf8')
            result = invoke(['--capture', str(capture_path), '--record-release'])
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            receipt = json.loads((root/'supabase'/target['deployment_receipt']).read_text(encoding='utf8'))
            audit = json.loads((root/'supabase'/receipt['source_audit']).read_text(encoding='utf8'))
            self.assertEqual(receipt['migration_manifest'], read(target['manifest_snapshot']))
            self.assertEqual(audit['server_migration_manifest'], capture['manifest'])
            self.assertEqual(audit['build_fingerprint'], fingerprint)
            self.assertEqual(audit['verified_at'], capture['captured_at'])
            result = invoke(['--release-gate'])
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)

    def test_versioned_files_match_reviewed_deployment_expectations(self):
        target = read('postflight-target.json')
        history = read(target['migration_snapshot'])['migrations']
        paths = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        local = [{'version': p.name.split('_')[0], 'name': p.name.split('_', 1)[1][:-4]} for p in paths]
        self.assertEqual(local, history)
        manifest = [{**row, 'sha256': hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()} for row, p in zip(local, paths)]
        self.assertEqual(manifest, read(target['manifest_snapshot']))
        # Historical server evidence is immutable, not generated from local files.
        for row in read('audit/applied-migration-manifest.json'):
            self.assertIn(row, manifest)

    def test_manifest_generator_accepts_the_reviewed_chain(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'tools/supabase_migration_manifest.py')],
            capture_output=True,
            encoding='utf8',
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_historical_baseline_stays_reproducible_and_original_history_is_preserved(self):
        baseline = next((ROOT / 'supabase/migrations').glob('*_production_schema_baseline.sql'))
        self.assertEqual(baseline.read_text(encoding='utf8'), render(read('audit/production-schema.json')))
        original = read('audit/original-full-migration-history.json')
        self.assertEqual(len(original), 7)
        self.assertTrue(all(row['statements'] for row in original))
        self.assertEqual([{k: row[k] for k in ('version', 'name')} for row in original], read('audit/production-migrations.json')['migrations'])

    def test_production_schema_snapshot_stays_bound_to_authenticated_receipt(self):
        target = read('postflight-target.json')
        receipt = read('production-deployment-receipt.json')
        self.assertEqual(receipt['schema_snapshot'], target['schema_snapshot'])
        self.assertEqual(
            normalized_text_sha256(ROOT / 'supabase' / target['schema_snapshot']),
            receipt['schema_snapshot_sha256'],
        )

    def test_reviewed_migrations_are_equal_to_or_an_exact_suffix_after_production_receipt(self):
        target = read('postflight-target.json')
        receipt = read('production-deployment-receipt.json')
        reviewed = read(target['manifest_snapshot'])
        pending = manifest_pending_suffix(receipt['migration_manifest'], reviewed)
        self.assertIsNotNone(
            pending,
            'Production receipt must equal the reviewed chain or be its exact prefix; arbitrary migration drift is forbidden',
        )

    def test_every_remaining_rpc_advisor_warning_has_reviewed_authorization_coverage(self):
        expected = {'acknowledge_bank_transaction_alert', 'acknowledge_bank_transaction_missing',
                    'apply_restore_group_v5', 'stage_restore_group_v5', 'claim_finance_sync_lease',
                    'release_finance_sync_lease', 'merge_bank_transactions', 'sync_bank_transactions_snapshot',
                    'save_bank_sync_snapshot', 'save_finance_sync_document_v5'}
        warnings = read('audit/security-advisor-upgraded.json')['result']['lints']
        relevant = [w for w in warnings if w['name'] == 'authenticated_security_definer_function_executable']
        self.assertEqual({w['metadata']['name'] for w in relevant}, expected)
        inventory = read(read('postflight-target.json')['schema_snapshot'])
        tests = (ROOT / 'tests/supabase_authorization.py').read_text(encoding='utf8')
        review = (ROOT / 'supabase/REVIEW.md').read_text(encoding='utf8')
        for rpc in expected:
            function = next(f for f in inventory['functions'] if f['schema'] == 'public' and f['name'] == rpc)
            self.assertTrue(function['security_definer'])
            self.assertTrue(function['authenticated'])
            self.assertFalse(function['anon'])
            self.assertIn('search_path=pg_catalog', function['config'][0])
            self.assertIn('public.' + rpc + '(', tests)
            self.assertIn(rpc, review)
        capability = next(f for f in inventory['functions'] if f['name'] == 'get_netunim_sync_capabilities')
        self.assertFalse(capability['security_definer'])
        self.assertFalse(capability['anon'])

    def test_static_upload_requires_production_receipt_and_live_check_is_conditional(self):
        deployment = (ROOT / 'tools/deploy_site_core.bat').read_text(encoding='utf8')
        wrangler = deployment.index('call npx --yes wrangler')
        release = deployment.index('supabase_postflight.py" --release-gate')
        preflight = deployment.index('if /I "%~6"=="--preflight-only" (')
        live = deployment.index('if defined NETUNIM_RUN_LIVE_POSTFLIGHT')
        self.assertLess(release, live)
        self.assertLess(release, preflight)
        self.assertLess(preflight, live)
        self.assertLess(live, wrangler)
        self.assertIn('Supabase release gate failed. No site was uploaded.', deployment)
        self.assertIn('NETUNIM_SUPABASE_CAPTURE', deployment)
        self.assertIn('if defined PGHOST if defined PGDATABASE if defined PGUSER', deployment)
        self.assertIn('Mandatory Production receipt gate passed', deployment)

    def test_release_receipt_text_hash_is_line_ending_independent(self):
        target = read('postflight-target.json')
        receipt = read('production-deployment-receipt.json')
        self.assertEqual(receipt['text_hash_normalization'], 'lf-v1')
        for rel, hash_key in ((target['schema_snapshot'], 'schema_snapshot_sha256'),
                              (receipt['source_audit'], 'source_audit_sha256')):
            source = ROOT / 'supabase' / rel
            raw = source.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')
            with tempfile.TemporaryDirectory() as tmp:
                lf = Path(tmp) / 'lf.txt'
                crlf = Path(tmp) / 'crlf.txt'
                lf.write_bytes(raw)
                crlf.write_bytes(raw.replace(b'\n', b'\r\n'))
                self.assertEqual(normalized_text_sha256(lf), receipt[hash_key])
                self.assertEqual(normalized_text_sha256(crlf), receipt[hash_key])

    def test_release_gate_distinguishes_reviewed_pending_release_from_receipt_drift(self):
        target = read('postflight-target.json')
        command = [sys.executable, str(ROOT / 'tools/supabase_postflight.py'), '--release-gate']

        receipt = read('production-deployment-receipt.json')
        audit = read(receipt['source_audit'])
        reviewed = read(target['manifest_snapshot'])
        jobs = read('retention-jobs.json')
        pending = manifest_pending_suffix(receipt['migration_manifest'], reviewed)
        self.assertIsNotNone(pending)

        # Verification accepts a reviewed pending database release, but the real
        # upload gate remains fail-closed until the authenticated Production receipt
        # catches up. After a legitimate DB deployment/receipt refresh, the same test
        # expects the gate to pass rather than baking today's pending state forever.
        result = subprocess.run(command, capture_output=True, encoding='utf8', timeout=30)
        if pending:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('reviewed database release is pending Production', result.stderr)
        else:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


        # Unit-test the logical contract in its post-deployment state without
        # forging a filesystem Production receipt or authenticated source audit.
        current_receipt = json.loads(json.dumps(receipt))
        current_audit = json.loads(json.dumps(audit))
        current_receipt['migration_manifest'] = reviewed
        current_audit['migration_manifest'] = reviewed
        current_audit['canonical_migrations'] = [
            {k: row[k] for k in ('version', 'name')} for row in reviewed
        ]
        # A post-deployment authenticated audit would also contain a server ledger for the
        # newly reviewed suffix. Model that evidence rather than reusing the old Production
        # server hashes, which necessarily have the previous migration count.
        current_audit['server_migration_manifest'] = json.loads(json.dumps(reviewed))
        current_audit['migration_storage_formats'] = verify_server_manifest(
            current_audit['server_migration_manifest'], reviewed
        )
        self.assertEqual(
            release_contract_errors(target, current_receipt, current_audit, reviewed, jobs), []
        )

        drifted = json.loads(json.dumps(current_receipt))
        drifted['migration_manifest'][-1]['sha256'] = '0' * 64
        errors = release_contract_errors(target, drifted, current_audit, reviewed, jobs)
        self.assertTrue(any('migration versions or SQL hashes changed' in error for error in errors), errors)
        self.assertTrue(any('not bound to its authenticated source audit' in error for error in errors), errors)

        # The CLI override used by operator/tests must fail closed too; do not test
        # only the pure helper and accidentally bypass filesystem/hash bindings.
        stale = json.loads(json.dumps(receipt))
        stale['migration_manifest'] = stale['migration_manifest'][:-1]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'receipt.json'
            path.write_text(json.dumps(stale), encoding='utf8')
            failed = subprocess.run(command + ['--receipt', str(path)], capture_output=True, encoding='utf8', timeout=30)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('migration versions or SQL hashes changed', failed.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
