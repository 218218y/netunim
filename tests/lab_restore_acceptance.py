"""Run the existing bounded crash investigation with retained stopped profiles."""
import os
from pathlib import Path
import subprocess
import sys
from browser_harness import ROOT

if __name__ == '__main__':
    report = Path(os.environ['NETUNIM_SUITE_REPORT_DIR'])
    for app in ('orders', 'kupa'):
        subprocess.run([sys.executable, str(ROOT/'tests/investigate_restore_process.py'),
            '--app', app, '--restart', 'crash', '--repetitions', '1',
            '--report-dir', str(report/app)], cwd=ROOT, check=True)
