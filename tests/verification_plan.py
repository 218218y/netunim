"""One suite inventory for local verification and the GitHub Actions matrix.

CI shards run on separate machines; suites within a shard stay sequential.
The original groups remain available for focused local verification.
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
        "bank_morning_contracts.py",
    ],
    "models": ["module_contracts.py", "node_models.py"],
    "database": ["spreadsheet_documents.py", "supabase_candidate.py", "storage_writer_protocol_server.py", "supabase_retention.py", "morning_ledger.py"],
    "browser-ui": ["runtime_browser_isolation.py", "runtime_smoke.py", "runtime_responsive.py", "runtime_calendar.py", "runtime_calendar_auth_disposal.py", "runtime_calendar_resource_ownership.py", "runtime_calendar_ownership.py", "runtime_calendar_account_privacy.py", "runtime_calendar_pending.py", "runtime_calendar_multitab_confirmation.py", "runtime_calendar_delivery_ownership.py", "runtime_calendar_commit_notification.py", "runtime_events.py", "runtime_document_deadlines.py", "runtime_google_drive_scope.py", "runtime_document_account_privacy.py", "runtime_kupa_dashboard_ownership.py"],
    "browser-morning": ["runtime_morning.py", "runtime_morning_ownership.py", "runtime_morning_recovery_timer.py", "runtime_morning_metadata.py", "runtime_morning_account_privacy.py"],
    "browser-lifecycle": ["runtime_finance_lease_ownership.py", "runtime_kupa_bank_archive_reconciliation.py", "runtime_orders_bank_publication.py", "runtime_finance_connection_import_ownership.py", "runtime_kupa_bank_connection_ownership.py", "runtime_orders_bank_connection_ownership.py", "runtime_bank_balance_evidence.py","runtime_orders_credit_connection_ownership.py", "runtime_credit_connection_ownership.py", "runtime_kupa_bank_snapshot_commands.py", "runtime_kupa_bank_archive.py", "runtime_orders_bank_archive.py", "runtime_security.py", "runtime_pwa.py", "runtime_performance.py", "runtime_data_integrity.py", "runtime_finance_automation.py", "runtime_credit_operation_ownership.py", "runtime_credit_publication.py", "runtime_credit_preferences.py", "runtime_bank_operation_ownership.py", "runtime_bank_local_publication.py", "runtime_kupa_bank_capability.py", "runtime_kupa_credit_capability.py", "runtime_kupa_checks_ownership.py", "runtime_bank_snapshot_confirmation.py", "runtime_finance_write_confirmation.py", "runtime_finance_lease_confirmation.py", "runtime_orders_finance_ownership.py", "runtime_orders_finance_preferences.py", "runtime_orders_finance_capability.py"],
    "browser-sync": ["runtime_backup_restore_scope.py", "runtime_local_birth_gate.py", "runtime_owner_transfer.py", "runtime_main_ownership.py", "runtime_automatic_backup_ownership.py", "runtime_orders_folder_write_ownership.py", "runtime_primary_tab_lock_ownership.py", "runtime_storage.py", "runtime_orders_save_scheduling.py", "runtime_orders_checks_capability.py", "runtime_ack_checkpoint_sequence.py", "runtime_cloud_publication_scope.py", "runtime_post_ack_recovery.py", "runtime_cloud_record_recovery.py", "runtime_kupa_save_confirmation.py", "spreadsheet_runtime.py", "runtime_workflows.py", "runtime_sync_multitab.py", "runtime_sync_two_computers.py", "runtime_financial.py"],
    "browser-database": ["runtime_sync_postgres.py"],
}
CORE_SUITES = [suite for group, suites in GROUPS.items() if not group.startswith("browser-") for suite in suites]
RUNTIME_SUITES = [suite for group, suites in GROUPS.items() if group.startswith("browser-") for suite in suites]

# Fixed striping keeps one inventory and automatically includes newly added suites.
# Two successful October 14 CI runs put these groups at 560-591s, 329-332s
# and 218-241s respectively. Their longest striped shards were 213s, 179s
# and 148s; browser-morning (211-214s) then sets the approximate lower bound.
# Historical timings inform this choice only; CI never reads a timing/result cache.
CI_SHARDS = {"browser-lifecycle": 3, "browser-sync": 2, "browser-ui": 2}


def validate_plan():
    suites = CORE_SUITES + RUNTIME_SUITES
    if len(suites) != len(set(suites)):
        raise ValueError("A verification suite is assigned more than once")
    if any(not suites for suites in GROUPS.values()):
        raise ValueError("Empty verification group")
    missing = [name for name in suites if not (TESTS / name).is_file()]
    if missing:
        raise ValueError(f"Verification suites missing: {missing}")
    for group, count in CI_SHARDS.items():
        if group not in GROUPS or type(count) is not int or not 1 <= count <= len(GROUPS[group]):
            raise ValueError(f"Invalid CI shard count for {group}: {count}")


def ci_groups():
    """Disjoint CI selections derived entirely from the full local inventory."""
    validate_plan()
    selections = {}
    for name, suites in GROUPS.items():
        count = CI_SHARDS.get(name, 1)
        for index in range(count):
            shard = name if count == 1 else f"{name}-{index + 1}"
            if shard in selections or (count > 1 and shard in GROUPS):
                raise ValueError(f"Duplicate CI group name: {shard}")
            selections[shard] = suites[index::count]
    return selections


def ci_matrix():
    return {"include": [{"group": name, "browser": name.startswith("browser-"), "postgres": name in ("database", "browser-database")} for name in ci_groups()]}
