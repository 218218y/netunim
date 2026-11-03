"""One entry point for synthetic acceptance; no provider/project/profile arguments."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tests'))
from run_all import preflight, run_suites
from acceptance_safety import temporary_root
from suite_process import remove_scratch

SCENARIOS = {
    'isolation': ['runtime_browser_isolation.py'],
    'concurrent-edits': ['runtime_sync_two_computers.py'],
    'network-and-lost-ack': ['runtime_supabase_stack.py'],
    'local-save-abort': ['runtime_idb_receipts.py'],
    'restore-and-crash': ['lab_restore_acceptance.py'],
    'old-tab': ['runtime_release_compatibility.py', 'runtime_pwa.py'],
    'bridge': ['lab_bridge_acceptance.py'],
}
EXTERNAL = ['google-live', 'morning-sandbox', 'bank-credit-provider', 'physical-machine',
            'global-windows-installer']


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf8').strip()


def save(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf8')
    temp.replace(path)


def no_links(path):
    """Reject Windows junctions as well as symlinks in every existing ancestor."""
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.exists() and (part.is_symlink() or getattr(part, 'is_junction', lambda: False)()):
            raise RuntimeError('lab path traverses a link or junction')
    return path


def report_directory():
    base = no_links(ROOT/'.work/test-lab')
    if not base.resolve().is_relative_to(ROOT.resolve()):
        raise RuntimeError('report directory escapes checkout')
    directory = base/(time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4))
    directory.mkdir(parents=True)
    return directory


@contextmanager
def environment():
    """Each run owns credentials/config/home/temp; selected fixtures own children."""
    scratch = Path(tempfile.mkdtemp(prefix='netunim-test-lab-'))
    temporary_root(scratch, 'netunim-test-lab-')
    original = dict(os.environ)
    keep = ('PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROGRAMFILES',
            'PROGRAMFILES(X86)', 'PROGRAMW6432', 'USERNAME', 'COMPUTERNAME', 'LANG',
            'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'NETUNIM_BROWSER')
    clean = {key: value for key, value in original.items() if key.upper() in {k.upper() for k in keep}}
    for name in ('home', 'local', 'roaming', 'temp'):
        (scratch/name).mkdir()
    clean.update(HOME=str(scratch/'home'), USERPROFILE=str(scratch/'home'),
                 LOCALAPPDATA=str(scratch/'local'), APPDATA=str(scratch/'roaming'),
                 TEMP=str(scratch/'temp'), TMP=str(scratch/'temp'), TMPDIR=str(scratch/'temp'),
                 GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0',
                 PYTHONUTF8='1')
    try:
        os.environ.clear()
        os.environ.update(clean)
        yield scratch
    finally:
        os.environ.clear()
        os.environ.update(original)
        temporary_root(scratch, 'netunim-test-lab-')
        remove_scratch(scratch)


def evidence_class(guest):
    if not guest:
        return 'automatic'
    # A command line switch alone cannot upgrade automated host evidence.
    marker = ROOT.parent/'guest-attestation.json'
    if os.name != 'nt' or ROOT != Path('C:/NetunimLabRun/source') or not marker.is_file():
        raise RuntimeError('isolated Windows evidence requires the prepared guest workspace')
    data = json.loads(marker.read_text(encoding='utf8-sig'))
    if data.get('kind') not in ('sandbox', 'vm') or not data.get('virtual_machine'):
        raise RuntimeError('missing guest VM attestation')
    return 'isolated-windows'


def blocked_reason(name):
    if name == 'network-and-lost-ack' and not (
        os.name == 'posix' and os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and os.environ.get('RUNNER_OS') == 'Linux'
    ):
        return 'requires the existing disposable GitHub Linux Supabase job'
    if name == 'bridge':
        return '' if shutil.which('node') else 'Node.js is missing'
    return 'browser/Python/Node preflight failed' if preflight(require_browser=True, require_postgres=False) else ''


def run(selected, *, guest=False):
    classification = evidence_class(guest)
    directory = report_directory()
    rows = [{'scenario': name, 'status': 'NOT RUN', 'evidence_class': classification,
             'suites': SCENARIOS[name]} for name in SCENARIOS]
    rows += [{'scenario': name, 'status': 'NOT RUN', 'reason': 'separate operator environment/account required'} for name in EXTERNAL]
    report = {'schema_version': 1, 'source_sha': git('rev-parse', 'HEAD'),
              'dirty': bool(git('status', '--porcelain')), 'synthetic_only': True,
              'physical_acceptance': False, 'complete': False, 'scenarios': rows}
    snapshot = ROOT.parent/'package-source.json'
    if guest and snapshot.is_file():
        report['package_source'] = json.loads(snapshot.read_text(encoding='utf8-sig'))
    path = directory/'report.json'
    save(path, report)
    print('Evidence:', directory, flush=True)
    try:
        with environment():
            for row in rows:
                if row['scenario'] not in selected:
                    continue
                reason = blocked_reason(row['scenario'])
                if reason:
                    row.update(status='BLOCKED', reason=reason)
                    save(path, report)
                    continue
                logs = directory/row['scenario']
                row.update(status='UNRESOLVED', reason='run interrupted before completion', evidence=str(logs.relative_to(directory)))
                save(path, report)
                started = time.monotonic()
                rc = run_suites(row['suites'], keep_going=True, report_dir=logs,
                                label='lab-'+row['scenario'], jobs=1, browser_jobs=1)
                row.update(status='PASS' if rc == 0 else 'UNRESOLVED', exit_code=rc,
                           seconds=round(time.monotonic()-started, 3))
                row['artifacts'] = {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                                    for p in sorted(logs.rglob('*')) if p.is_file()}
                row.pop('reason', None)
                save(path, report)
        report['complete'] = True
    finally:
        # Never promote a checkpoint interrupted by a crash to PASS.
        save(path, report)
    summary = ['# Test lab evidence', '', '| Scenario | Result | Evidence class |', '| --- | --- | --- |']
    summary += [f"| {r['scenario']} | {r['status']} | {r.get('evidence_class', 'operator')} |" for r in rows]
    (directory/'report.md').write_text('\n'.join(summary)+'\n', encoding='utf8')
    print('Report:', path, flush=True)
    return int(any(r['status'] in ('BLOCKED', 'UNRESOLVED') for r in rows if r['scenario'] in selected))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    execute = commands.add_parser('run')
    execute.add_argument('--scenario', action='append', choices=SCENARIOS)
    execute.add_argument('--all', action='store_true')
    execute.add_argument('--guest', action='store_true')
    commands.add_parser('prepare-windows')
    args = parser.parse_args(argv)
    if args.command == 'list':
        print(json.dumps({'automated': SCENARIOS, 'operator_only': EXTERNAL}, indent=2))
        return 0
    if args.command == 'prepare-windows':
        from test_lab_package import prepare
        print(prepare(ROOT))
        return 0
    selected = list(SCENARIOS) if args.all else args.scenario
    if not selected:
        parser.error('select --scenario or --all')
    return run(list(dict.fromkeys(selected)), guest=args.guest)


if __name__ == '__main__':
    raise SystemExit(main())
