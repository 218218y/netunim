"""Release contracts for the canonical migration chain and reviewed Advisor notices."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_schema_baseline import render
from supabase_postflight import drift


def read(name):
    return json.loads((ROOT / 'supabase' / name).read_text(encoding='utf8'))


class SupabaseContracts(unittest.TestCase):
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

    def test_historical_baseline_stays_reproducible_and_original_history_is_preserved(self):
        baseline = next((ROOT / 'supabase/migrations').glob('*_production_schema_baseline.sql'))
        self.assertEqual(baseline.read_text(encoding='utf8'), render(read('audit/production-schema.json')))
        original = read('audit/original-full-migration-history.json')
        self.assertEqual(len(original), 7)
        self.assertTrue(all(row['statements'] for row in original))
        self.assertEqual([{k: row[k] for k in ('version', 'name')} for row in original], read('audit/production-migrations.json')['migrations'])

    def test_candidate_matches_actual_production_schema(self):
        target = read('postflight-target.json')
        self.assertEqual(drift(read('audit/candidate-schema.json'), read(target['schema_snapshot'])), [])

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
        live = deployment.index('if defined NETUNIM_RUN_LIVE_POSTFLIGHT')
        self.assertLess(release, live)
        self.assertLess(live, wrangler)
        self.assertIn('Supabase release gate failed. No site was uploaded.', deployment)
        self.assertIn('NETUNIM_SUPABASE_CAPTURE', deployment)
        self.assertIn('if defined PGHOST if defined PGDATABASE if defined PGUSER', deployment)
        self.assertIn('Mandatory Production receipt gate passed', deployment)

    def test_release_gate_accepts_current_contract_and_rejects_receipt_drift(self):
        command = [sys.executable, str(ROOT / 'tools/supabase_postflight.py'), '--release-gate']
        result = subprocess.run(command, capture_output=True, encoding='utf8', timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = read('production-deployment-receipt.json')
        receipt['migration_manifest'] = receipt['migration_manifest'][:-1]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'receipt.json'
            path.write_text(json.dumps(receipt), encoding='utf8')
            failed = subprocess.run(command + ['--receipt', str(path)], capture_output=True, encoding='utf8', timeout=30)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('migration versions or SQL hashes changed', failed.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
