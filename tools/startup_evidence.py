"""Summarize raw startup samples without hiding unavailable readiness metrics."""
from datetime import datetime, timezone
from math import ceil, isfinite
from pathlib import Path
from statistics import median
import argparse
import json
import os
import platform
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MODES = ('cold', 'cached', 'offline')
DURATIONS = ('moduleEvaluation', 'composition', 'localRecovery', 'boot', 'firstView', 'commandReady')


def distribution(raw):
    values = [value for value in raw if value is not None]
    if any(type(value) not in (int, float) or not isfinite(value) or value < 0 for value in values):
        raise ValueError('Startup measurements must be finite nonnegative numbers or null')
    ordered = sorted(values)
    return {'n': len(values), 'missing': len(raw) - len(values),
            'complete': bool(raw) and len(values) == len(raw),
            'min': min(values) if values else None, 'median': median(values) if values else None,
            'p95': ordered[ceil(len(values) * .95) - 1] if values else None,
            'max': max(values) if values else None}


def summarize_startup(observations, duration_fields=DURATIONS):
    summary = {}
    for mode in MODES:
        fields = {name: [sample.get(mode, {}).get('durations', {}).get(name) for sample in observations]
                  for name in duration_fields}
        fields['moduleResponses'] = [sample.get(mode, {}).get('resources', {}).get('lastResponseMs') for sample in observations]
        script = [sample.get(mode, {}).get('cpu', {}).get('ScriptDuration') for sample in observations]
        # Validate before multiplying: Python booleans must not become 0/1000 ms.
        distribution(script)
        fields['scriptMs'] = [value * 1000 if value is not None else None for value in script]
        summary[mode] = {name: distribution(values) for name, values in fields.items()}
    return summary


def capture_environment():
    try:
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=10).strip()
        dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True, timeout=10).strip())
    except (OSError, subprocess.SubprocessError):
        revision, dirty = None, None
    return {'schemaVersion': 2, 'capturedAt': datetime.now(timezone.utc).isoformat(),
            'sourceRevision': revision, 'workingTreeDirty': dirty,
            'execution': 'github-actions' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'local',
            'os': platform.system(), 'architecture': platform.machine(),
            'workload': 'fresh-isolated-profile', 'browserMode': 'headless-chromium'}


def inspect_report(report, *, minimum_samples=5, expected_revision=None, require_physical=False):
    if type(minimum_samples) is not int or minimum_samples < 1:
        raise ValueError('A positive minimum sample count is required')
    summaries, issues = {}, []
    for app in ('kupa', 'orders'):
        profile = report.get(app, {})
        observations = profile.get('samples', [])
        summary = summarize_startup(observations)
        summaries[app] = summary
        if type(profile.get('cpuThrottleRate')) is not int or profile['cpuThrottleRate'] != 1:
            issues.append(app + ': native CPU measurements are missing')
        for mode, fields in summary.items():
            for name, stats in fields.items():
                if not stats['complete'] or stats['n'] < minimum_samples:
                    issues.append(f"{app}/{mode}/{name}: {stats['n']} measured, {stats['missing']} missing")
    environment = report.get('environment', {})
    if expected_revision is not None and environment.get('sourceRevision') != expected_revision:
        issues.append('Source revision does not match the requested release')
    if require_physical:
        if environment.get('execution') != 'local' or environment.get('os') != 'Windows':
            issues.append('Physical Windows evidence is required; CI and CPU emulation do not qualify')
        if environment.get('browserMode') != 'headed-chromium':
            issues.append('Physical readiness evidence requires an interactive browser session')
        if environment.get('workingTreeDirty') is not False:
            issues.append('Physical measurements need an identified clean source revision')
        revision = environment.get('sourceRevision')
        if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision):
            issues.append('Physical measurements have no valid source revision')
        if environment.get('hardwareClass') != 'weak':
            issues.append('The operator has not identified the physical weak-machine workload')
        for field in ('deviceDescription', 'diskDescription', 'networkDescription'):
            if not isinstance(environment.get(field), str) or not environment[field].strip():
                issues.append('Physical context missing: ' + field)
    return {'environment': environment, 'summary': summaries, 'issues': issues, 'complete': not issues}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--minimum-samples', type=int, default=5)
    parser.add_argument('--revision')
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--require-physical', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect_report(json.loads(args.input.read_text(encoding='utf-8-sig')),
                                minimum_samples=args.minimum_samples, expected_revision=args.revision,
                                require_physical=args.require_physical)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        parser.exit(2, 'Invalid startup report: ' + str(error) + '\n')
    output = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding='utf-8')
    else:
        print(output, end='')
    return int(bool(result['issues']) and (args.require_complete or args.require_physical or args.revision is not None))


if __name__ == '__main__':
    raise SystemExit(main())
