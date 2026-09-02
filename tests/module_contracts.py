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
    ['node', str(DEV_NODE_MODULES / 'eslint/bin/eslint.js'), 'netunim-kupa/site', 'netunim-orders/site'],
    ['node', '--test', 'tests/business_models.test.mjs'],
    ['node', '--test', 'tests/global_search.test.mjs'],
    ['node', '--test', 'tests/global_search_navigation.test.mjs'],
    ['node', '--test', 'tests/shared_contracts.test.mjs'],
    ['node', '--test', 'tests/sync_models.test.mjs'],
    ['node', '--test', 'tests/cash_rights.test.mjs'],
    ['node', '--test', 'tests/kupa_notes.test.mjs'],
    ['node', '--test', 'tests/storage_models.test.mjs'],
):
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)
print('ALL MODULE AND BUSINESS CONTRACTS PASSED')
