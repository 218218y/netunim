"""Readiness and physical evidence must never be inferred from missing samples."""
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from startup_evidence import distribution, summarize_startup, inspect_report, DURATIONS, MODES


def fixture():
    samples = [{mode: {'durations': {name: index for name in DURATIONS},
                       'resources': {'lastResponseMs': index}, 'cpu': {'ScriptDuration': index / 1000}}
                for mode in MODES} for index in range(1, 6)]
    return {'environment': {'sourceRevision': 'a'*40, 'execution': 'local', 'os': 'Windows',
                            'workingTreeDirty': False, 'hardwareClass': 'weak', 'browserMode': 'headed-chromium',
                            'deviceDescription': 'operator fixture', 'diskDescription': 'fixture SSD',
                            'networkDescription': 'fixture local origin'},
            **{app: {'cpuThrottleRate': 1, 'samples': copy.deepcopy(samples)} for app in ('kupa', 'orders')}}


class StartupEvidenceContracts(unittest.TestCase):
    def test_nearest_rank_p95_and_real_zero_are_preserved(self):
        result = distribution([0, 1, 2, 3, 4])
        self.assertEqual((result['n'], result['missing'], result['median'], result['p95']), (5, 0, 2, 4))
        self.assertTrue(result['complete'])

    def test_missing_metrics_remain_visible_and_never_become_zero(self):
        result = distribution([None] * 5)
        self.assertEqual((result['n'], result['missing']), (0, 5))
        self.assertFalse(result['complete'])
        self.assertTrue(all(result[name] is None for name in ('min', 'median', 'p95', 'max')))
        report = fixture()
        for sample in report['kupa']['samples']:
            sample['cold']['durations']['commandReady'] = None
        inspected = inspect_report(report)
        self.assertFalse(inspected['complete'])
        self.assertIn('kupa/cold/commandReady: 0 measured, 5 missing', inspected['issues'])

    def test_partial_samples_report_both_observed_and_missing_counts(self):
        self.assertEqual(distribution([None, 0, 10])['n'], 2)
        self.assertEqual(distribution([None, 0, 10])['missing'], 1)
        self.assertFalse(distribution([])['complete'])

    def test_malformed_numbers_including_boolean_cpu_are_rejected(self):
        for value in (True, False, '0', -1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                distribution([value])
        report = fixture()
        report['kupa']['samples'][0]['cold']['cpu']['ScriptDuration'] = False
        with self.assertRaises(ValueError):
            summarize_startup(report['kupa']['samples'])

    def test_complete_physical_report_is_bound_to_revision_and_operator_context(self):
        report = fixture()
        self.assertTrue(inspect_report(report, require_physical=True, expected_revision='a'*40)['complete'])
        self.assertFalse(inspect_report(report, require_physical=True, expected_revision='b'*40)['complete'])
        for patch in ({'execution': 'github-actions'}, {'os': 'Linux'}, {'hardwareClass': None}, {'browserMode': 'headless-chromium'},
                      {'workingTreeDirty': True}, {'sourceRevision': True}, {'sourceRevision': 'unknown'},
                      {'deviceDescription': ''}, {'diskDescription': ''}, {'networkDescription': ''}):
            changed = copy.deepcopy(report)
            changed['environment'].update(patch)
            self.assertFalse(inspect_report(changed, require_physical=True)['complete'], patch)

    def test_throttling_and_insufficient_repetitions_never_qualify_as_native_physical_evidence(self):
        for rate in (4, True, '1', None):
            report = fixture()
            report['orders']['cpuThrottleRate'] = rate
            self.assertFalse(inspect_report(report, require_physical=True)['complete'])
        report = fixture()
        report['kupa']['samples'] = report['kupa']['samples'][:1]
        self.assertFalse(inspect_report(report)['complete'])

    def test_cli_recomputes_from_raw_samples_instead_of_trusting_a_green_summary(self):
        report = fixture()
        report['kupa']['samples'][0]['offline']['durations']['firstView'] = None
        report['kupa']['summary'] = {'complete': True}
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp)/'report.json', Path(tmp)/'inspection.json'
            source.write_text(json.dumps(report), encoding='utf-8')
            result = subprocess.run([sys.executable, str(ROOT/'tools/startup_evidence.py'), str(source),
                                     '--output', str(output), '--require-complete'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertFalse(json.loads(output.read_text(encoding='utf-8'))['complete'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
