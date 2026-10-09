# JavaScript model tests run once via node_models.py in the canonical full gate.
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEV_NODE_MODULES = Path(os.environ.get("NETUNIM_OFFLINE_NODE_MODULES", ROOT / "node_modules"))
for command in (
    [sys.executable, 'tests/pdfjs_runtime_vendor_contracts.py'],
    [sys.executable, 'tests/document_viewer_runtime_vendor_contracts.py'],
    [sys.executable, 'tools/pdfjs-runtime.py', 'check'],
    [sys.executable, 'tools/document-viewers-runtime.py', 'check'],
    [sys.executable, 'tests/public_js_guard_contracts.py'],
    [sys.executable, 'tools/public_js_guard.py', 'netunim-kupa/site'],
    [sys.executable, 'tools/public_js_guard.py', 'netunim-orders/site'],
    [sys.executable, 'tools/sync-assets.py', '--check'],
    [sys.executable, 'tests/document_search_parity_contracts.py'],
    [sys.executable, 'tests/sync_assets_contracts.py'],
    ['node', 'tests/module_graph.cjs'],
    ['node', 'tools/typecheck.mjs'],
    ['node', str(DEV_NODE_MODULES / 'eslint/bin/eslint.js'), 'netunim-kupa/site', 'netunim-orders/site', 'shared'],

):
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)
print('ALL MODULE, ASSET, TYPE AND LINT CONTRACTS PASSED')
