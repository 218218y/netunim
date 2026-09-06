"""Release contracts for the canonical migration chain and reviewed Advisor notices."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_schema_baseline import render
from supabase_postflight import drift


def read(name):
    return json.loads((ROOT / 'supabase' / name).read_text(encoding='utf8'))


class SupabaseContracts(unittest.TestCase):
    def test_versioned_files_match_actual_server_versions_and_hashes(self):
        target = read('postflight-target.json')
        history = read(target['migration_snapshot'])['migrations']
        paths = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
        local = [{'version': p.name.split('_')[0], 'name': p.name.split('_', 1)[1][:-4]} for p in paths]
        self.assertEqual(local, history)
        manifest = [{**row, 'sha256': hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()} for row, p in zip(local, paths)]
        self.assertEqual(manifest, read('audit/applied-migration-manifest.json'))
        self.assertEqual(manifest, [{k: row[k] for k in ('version', 'name', 'sha256')} for row in read('audit/production-migration-statement-hashes.json')])

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

    def test_upload_requires_live_or_fresh_release_bound_postflight(self):
        deployment = (ROOT / 'tools/deploy_site_core.bat').read_text(encoding='utf8')
        self.assertLess(deployment.index('supabase_postflight.py'), deployment.index('call npx --yes wrangler'))
        self.assertIn('Supabase postflight failed. No site was uploaded.', deployment)


if __name__ == '__main__':
    unittest.main(verbosity=2)
