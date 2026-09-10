"""One suite inventory for local verification and the GitHub Actions matrix.

Groups run on separate machines in CI; suites within a group stay sequential.
Helpers and operator-only tools (including live bank integration) are not suites.
"""
from pathlib import Path

TESTS = Path(__file__).resolve().parent
GROUPS = {
    "contracts": [
        "ci_contracts.py",
        "windows_deploy_contracts.py",
        "supabase_contracts.py",
        "static_contracts.py",
        "cloud_sync_v3_contracts.py",
        "sync_integrity_v5_contracts.py",
        "offline_dependencies_contracts.py",
        "confirmation_contracts.py",
        "cloud_backup_contracts.py",
        "asset_contracts.py",
        "deploy_preflight.py",
        "service_worker_contracts.py",
        "calendar_contracts.py",
        "morning_documents_contracts.py",
        "bank_bridge_contracts.py",
    ],
    "models": ["module_contracts.py", "node_models.py"],
    "database": ["supabase_candidate.py", "supabase_retention.py", "morning_ledger.py"],
    "browser-ui": ["runtime_smoke.py", "runtime_responsive.py", "runtime_calendar.py", "runtime_events.py"],
    "browser-morning": ["runtime_morning.py"],
    "browser-lifecycle": ["runtime_security.py", "runtime_pwa.py", "runtime_performance.py", "runtime_data_integrity.py"],
    "browser-sync": ["runtime_workflows.py", "runtime_sync_recovery.py", "runtime_sync_multitab.py", "runtime_sync_two_computers.py", "runtime_financial.py"],
    "browser-database": ["runtime_sync_postgres.py"],
}
CORE_SUITES = [suite for group, suites in GROUPS.items() if not group.startswith("browser-") for suite in suites]
RUNTIME_SUITES = [suite for group, suites in GROUPS.items() if group.startswith("browser-") for suite in suites]


def validate_plan():
    suites = CORE_SUITES + RUNTIME_SUITES
    if len(suites) != len(set(suites)):
        raise ValueError("A verification suite is assigned more than once")
    if any(not suites for suites in GROUPS.values()):
        raise ValueError("Empty verification group")
    missing = [name for name in suites if not (TESTS / name).is_file()]
    if missing:
        raise ValueError(f"Verification suites missing: {missing}")


def ci_matrix():
    validate_plan()
    return {"include": [{"group": name, "browser": name.startswith("browser-"), "postgres": name in ("database", "browser-database")} for name in GROUPS]}
