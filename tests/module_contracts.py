# JavaScript model tests run once via node_models.py in the canonical full gate.
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEV_NODE_MODULES = Path(os.environ.get("NETUNIM_OFFLINE_NODE_MODULES", ROOT / "node_modules"))
for command in (
    [sys.executable, 'tools/sync-assets.py', '--check'],
    [sys.executable, 'tests/sync_assets_contracts.py'],
    ['node', 'tests/module_graph.cjs'],
    ['node', str(DEV_NODE_MODULES / 'eslint/bin/eslint.js'), 'netunim-kupa/site', 'netunim-orders/site', 'shared'],

):
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)
print('ALL MODULE, ASSET AND LINT CONTRACTS PASSED')
