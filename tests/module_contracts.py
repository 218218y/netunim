from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
for command in (
    [sys.executable, 'tools/sync-assets.py', '--check'],
    [sys.executable, 'tests/sync_assets_contracts.py'],
    ['node', 'tests/module_graph.cjs'],
    ['node', 'node_modules/eslint/bin/eslint.js', 'netunim-kupa/site', 'netunim-orders/site'],
    ['node', '--test', 'tests/business_models.test.mjs'],
    ['node', '--test', 'tests/shared_contracts.test.mjs'],
    ['node', '--test', 'tests/sync_models.test.mjs'],
    ['node', '--test', 'tests/storage_models.test.mjs'],
):
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)
print('ALL MODULE AND BUSINESS CONTRACTS PASSED')
