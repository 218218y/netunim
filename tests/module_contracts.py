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
    ['node', '--test', 'tests/module_probe.test.mjs'],
    ['node', str(DEV_NODE_MODULES / 'eslint/bin/eslint.js'), 'netunim-kupa/site', 'netunim-orders/site'],
    ['node', '--test', 'tests/customer_debt_progress.test.mjs'],
    ['node', '--test', 'tests/morning_debt_progress.test.mjs'],
    ['node', '--test', 'tests/business_models.test.mjs'],
    ['node', '--test', 'tests/global_search.test.mjs'],
    ['node', '--test', 'tests/global_search_navigation.test.mjs'],
    ['node', '--test', 'tests/kupa_search.test.mjs'],
    ['node', '--test', 'tests/kupa_search_navigation.test.mjs'],
    ['node', '--test', 'tests/date_search_filters.test.mjs'],
    ['node', '--test', 'tests/shared_contracts.test.mjs'],
    ['node', '--test', 'tests/sync_models.test.mjs'],
    ['node', '--test', 'tests/shared_checks_flight.test.mjs'],
    ['node', '--test', 'tests/cash_rights.test.mjs'],
    ['node', '--test', 'tests/kupa_notes.test.mjs'],
    ['node', '--test', 'tests/storage_models.test.mjs'],
    ['node', '--test', 'tests/cloud_sync_faults.test.mjs'],
    ['node', '--test', 'tests/sync_hardening.test.mjs'],
    ['node', '--test', 'tests/sync_replay_rebase.test.mjs'],
    ['node', '--test', 'tests/sync_durability_recovery.test.mjs'],
    ['node', '--test', 'tests/finance_fencing.test.mjs'],
    ['node', '--test', 'tests/sync_capabilities.test.mjs'],

    ['node', '--test', 'tests/tab_lock_fallback.test.mjs'],
):
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)
print('ALL MODULE AND BUSINESS CONTRACTS PASSED')
