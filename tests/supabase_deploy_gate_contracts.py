"""Exercise automatic live release verification without touching Production."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import supabase_deploy_gate as gate


class SupabaseDeployGateContracts(unittest.TestCase):
    def setUp(self):
        self.target = json.loads((gate.ROOT/'supabase/postflight-target.json').read_text(encoding='utf8'))
        self.expected = json.loads((gate.ROOT/'supabase'/self.target['schema_snapshot']).read_text(encoding='utf8'))
        self.history = json.loads((gate.ROOT/'supabase'/self.target['migration_snapshot']).read_text(encoding='utf8'))['migrations']
        self.manifest = gate.local_manifest()

    def verify_with(self, *, actual=None, history=None, manifest=None, fingerprint='stable'):
        actual = self.expected if actual is None else actual
        history = self.history if history is None else history
        manifest = self.manifest if manifest is None else manifest
        with patch.object(gate, 'live_source', return_value='cli'), \
             patch.object(gate, 'capture_live', return_value=Path('synthetic-capture')), \
             patch.object(gate, 'connector_capture', return_value=(actual, history, manifest)), \
             patch.object(gate, 'expected_upgrade', return_value=self.expected) as candidate, \
             patch.object(gate, 'build_fingerprint', side_effect=['stable', fingerprint]), \
             patch.object(gate, 'release_gate') as offline:
            gate.verify()
            self.assertEqual(candidate.call_count, 1)
            offline.assert_not_called()

    def test_matching_live_database_passes_even_with_old_committed_receipt(self):
        tracked = [gate.ROOT/'supabase'/self.target[k] for k in ('schema_snapshot', 'deployment_receipt')]
        before = [p.read_bytes() for p in tracked]
        self.verify_with()
        self.assertEqual([p.read_bytes() for p in tracked], before, 'Fast verification must keep the CI-verified checkout clean')

    def test_real_live_differences_never_fall_back_to_an_old_receipt(self):
        actual = copy.deepcopy(self.expected)
        actual['functions'][0]['definition'] += '\n-- unexpected live change'
        changed_manifest = copy.deepcopy(self.manifest)
        changed_manifest[-1]['sha256'] = '0'*64
        bad_jobs = copy.deepcopy(self.expected)
        bad_jobs['operations']['jobs'] = []
        for kw in ({'actual': actual}, {'actual': bad_jobs}, {'history': self.history[:-1]},
                   {'manifest': changed_manifest}, {'fingerprint': 'edited during verification'}):
            with self.subTest(kw=list(kw)), self.assertRaises(SystemExit):
                self.verify_with(**kw)

    def test_no_live_access_only_allows_an_already_authenticated_current_receipt(self):
        with patch.object(gate, 'live_source', return_value=None), patch.object(gate, 'release_gate') as offline:
            gate.verify();offline.assert_called_once_with(self.target)
            offline.side_effect = SystemExit('old receipt')
            with self.assertRaisesRegex(SystemExit, 'supabase login once'):
                gate.verify()

    def test_explicit_capture_and_pg_take_precedence_over_cli(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(gate.shutil, 'which', return_value='/supabase'):
            self.assertEqual(gate.live_source(), 'cli')
            os.environ['PGSERVICE'] = 'production'
            self.assertEqual(gate.live_source(), 'postgres')
            os.environ['NETUNIM_SUPABASE_CAPTURE'] = '/capture.json'
            self.assertEqual(gate.live_source(), 'capture')

    def test_cli_uses_pinned_project_read_only_sql_file_and_never_logs_connection_errors(self):
        row = dict(inventory={}, migrations=[], manifest=[], project_id=self.target['project_id'], captured_at='now', build_fingerprint='fp')
        with tempfile.TemporaryDirectory() as directory, patch.object(gate.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, json.dumps({'rows':[row]}), '')
            path = gate.capture_live(self.target, Path(directory), 'cli')
            self.assertEqual(json.loads(path.read_text(encoding='utf8')), row)
            command = run.call_args.args[0]
            self.assertEqual(command[command.index('--project-ref')+1], self.target['project_id'])
            sql = Path(command[command.index('--file')+1]).read_text(encoding='utf8')
            self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
            self.assertTrue(sql.endswith('ROLLBACK;'))
            self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
            run.return_value = subprocess.CompletedProcess([], 1, '', 'SECRET_MUST_NOT_APPEAR')
            with self.assertRaises(SystemExit) as failure:
                gate.capture_live(self.target, Path(directory), 'cli')
            self.assertNotIn('SECRET_MUST_NOT_APPEAR', str(failure.exception))

    def test_cli_rejects_partial_multiple_or_malformed_catalog_rows(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gate.subprocess, 'run') as run:
            for value in ({'rows':[]}, {'rows':[{},{}]}, {'rows':[{}]}, 'not-json'):
                run.return_value = subprocess.CompletedProcess([], 0, json.dumps(value), '')
                with self.subTest(value=value), self.assertRaises(SystemExit):
                    gate.capture_live(self.target, Path(directory), 'cli')

    def test_postgres_wraps_the_capture_as_one_json_row(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gate.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 1, '', '')
            with self.assertRaises(SystemExit): gate.capture_live(self.target, Path(directory), 'postgres')
            sql = run.call_args.kwargs['input']
            self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
            self.assertIn('select row_to_json(capture_row)', sql)
            self.assertEqual(sql.count('BEGIN READ ONLY;'), 1)
            self.assertTrue(sql.endswith('ROLLBACK;'))
