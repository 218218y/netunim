"""One suite inventory for local verification and the GitHub Actions matrix.

Groups run on separate machines in CI; suites within a group stay sequential.
Helpers and operator-only tools (including live bank integration) are not suites.
"""
from pathlib import Path

TESTS = Path(__file__).resolve().parent
GROUPS = {
    "contracts": [
        "ci_contracts.py",
        "runner_contracts.py",
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
        "google_drive_contracts.py",
        "morning_documents_contracts.py",
        "bank_bridge_contracts.py",
    ],
    "models": ["module_contracts.py", "node_models.py"],
    "database": ["spreadsheet_documents.py", "supabase_candidate.py", "storage_writer_protocol_server.py", "supabase_retention.py", "morning_ledger.py"],
    "browser-ui": ["runtime_browser_isolation.py", "runtime_smoke.py", "runtime_responsive.py", "runtime_calendar.py", "runtime_calendar_ownership.py", "runtime_events.py", "runtime_document_deadlines.py", "runtime_google_drive_scope.py"],
    "browser-morning": ["runtime_morning.py", "runtime_morning_ownership.py"],
    "browser-lifecycle": ["runtime_security.py", "runtime_pwa.py", "runtime_performance.py", "runtime_data_integrity.py", "runtime_finance_automation.py", "runtime_credit_operation_ownership.py", "runtime_credit_publication.py", "runtime_bank_operation_ownership.py", "runtime_bank_snapshot_confirmation.py", "runtime_orders_finance_ownership.py"],
    "browser-sync": ["runtime_local_birth_gate.py", "runtime_owner_transfer.py", "runtime_storage.py", "runtime_cloud_record_recovery.py", "runtime_kupa_save_confirmation.py", "spreadsheet_runtime.py", "runtime_workflows.py", "runtime_sync_multitab.py", "runtime_sync_two_computers.py", "runtime_financial.py"],
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
