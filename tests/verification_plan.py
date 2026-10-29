"""One suite inventory for local verification and the GitHub Actions matrix.

CI shards run on separate machines; suites within a shard stay sequential.
The original groups remain available for focused local verification.
Helpers and operator-only tools (including live bank integration) are not suites.
"""
from pathlib import Path

from ci_timing import balanced_partition, estimates, timing_weights
from node_models import SHARD_SUITES, test_files

TESTS = Path(__file__).resolve().parent
GROUPS = {
    "contracts": [
        "acceptance_safety_contracts.py",
        "ci_contracts.py",
        "startup_evidence_contracts.py",
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
        "public_asset_names_contracts.py",
        "service_worker_contracts.py",
        "calendar_contracts.py",
        "google_drive_contracts.py",
        "morning_documents_contracts.py",
        "bank_bridge_contracts.py",
        "bank_morning_contracts.py",
    ],
    "models": ["module_contracts.py", *SHARD_SUITES],
    "database": ["tax_calculator_database.py","spreadsheet_documents.py", "supabase_candidate.py", "storage_writer_protocol_server.py", "supabase_retention.py", "morning_ledger.py", "morning_expenses_ledger.py"],
    "browser-ui": ["runtime_tax_calculator.py","runtime_browser_isolation.py", "runtime_smoke.py", "runtime_responsive.py", "runtime_calendar.py", "runtime_calendar_payload.py", "runtime_calendar_storage_contracts.py", "runtime_calendar_auth_disposal.py", "runtime_calendar_resource_ownership.py", "runtime_calendar_ownership.py", "runtime_calendar_account_privacy.py", "runtime_calendar_pending.py", "runtime_calendar_multitab_confirmation.py", "runtime_calendar_delivery_ownership.py", "runtime_calendar_commit_notification.py", "runtime_events.py", "runtime_supplier_search.py", "runtime_document_deadlines.py", "runtime_google_drive_scope.py", "runtime_document_account_privacy.py", "runtime_kupa_dashboard_ownership.py"],
    "browser-morning": ["runtime_morning_reports.py", "runtime_morning.py", "runtime_morning_catalog.py", "runtime_morning_command_form.py", "runtime_morning_form_edit_ownership.py", "runtime_morning_recovery_display_ownership.py", "runtime_morning_status_ownership.py", "runtime_morning_operation_evidence.py", "runtime_morning_operation_drain.py", "runtime_morning_media_ownership.py", "runtime_morning_ownership.py", "runtime_morning_recovery_timer.py", "runtime_morning_metadata.py", "runtime_morning_account_privacy.py"],
    "browser-lifecycle": ["runtime_finance_lease_ownership.py", "runtime_kupa_bank_archive_reconciliation.py", "runtime_orders_bank_publication.py", "runtime_finance_connection_import_ownership.py", "runtime_kupa_bank_connection_ownership.py", "runtime_orders_bank_connection_ownership.py", "runtime_bank_balance_evidence.py","runtime_orders_credit_connection_ownership.py", "runtime_credit_connection_ownership.py", "runtime_kupa_bank_snapshot_commands.py", "runtime_kupa_bank_archive.py", "runtime_orders_bank_archive.py", "runtime_security.py", "runtime_pwa.py", "runtime_performance.py", "runtime_startup.py", "runtime_document_lazy.py", "runtime_search_lazy.py", "runtime_data_integrity.py", "runtime_finance_automation.py", "runtime_credit_operation_ownership.py", "runtime_credit_publication.py", "runtime_credit_preferences.py", "runtime_bank_operation_ownership.py", "runtime_bank_local_publication.py", "runtime_kupa_bank_capability.py", "runtime_kupa_credit_capability.py", "runtime_kupa_checks_ownership.py", "runtime_bank_snapshot_confirmation.py", "runtime_finance_write_confirmation.py", "runtime_finance_lease_confirmation.py", "runtime_orders_finance_ownership.py", "runtime_orders_finance_preferences.py", "runtime_orders_finance_capability.py"],
    "browser-sync": ["runtime_restore_server_recovery.py", "runtime_backup_restore_scope.py", "runtime_backup_browser_resources.py", "runtime_local_birth_gate.py", "runtime_owner_transfer.py", "runtime_storage_owner_binding.py", "runtime_owner_transactions.py", "runtime_checkpoint_authority.py", "runtime_journal_authority.py", "runtime_journal_input_capture.py", "runtime_main_ownership.py", "runtime_automatic_backup_ownership.py", "runtime_orders_folder_write_ownership.py", "runtime_primary_tab_lock_ownership.py", "runtime_storage.py", "runtime_orders_save_scheduling.py", "runtime_orders_checks_capability.py", "runtime_ack_checkpoint_sequence.py", "runtime_cloud_publication_scope.py", "runtime_post_ack_recovery.py", "runtime_cloud_record_recovery.py", "runtime_kupa_save_confirmation.py", "spreadsheet_runtime.py", "runtime_spreadsheet_confirmation.py", "runtime_workflows.py", "runtime_sync_multitab.py", "runtime_sync_two_computers.py", "runtime_financial.py"],
    "browser-database": ["runtime_sync_postgres.py"],
}
GROUPS["browser-sync"].append("runtime_auth_session_persistence.py")
GROUPS["browser-sync"].append("runtime_finance_json_hydration.py")
GROUPS["browser-morning"].append("runtime_morning_expenses.py")
GROUPS["browser-morning"].append("runtime_morning_expense_reporting_memory.py")
GROUPS["browser-morning"].append("runtime_morning_expense_ocr.py")
GROUPS["browser-morning"].append("runtime_morning_expense_local.py")
GROUPS["browser-morning"].append("runtime_morning_expense_drafts.py")
GROUPS["browser-morning"].append("runtime_morning_expense_source.py")
GROUPS["browser-morning"].append("runtime_morning_expense_completion.py")
GROUPS["browser-morning"].append("runtime_morning_expense_progress.py")
GROUPS["browser-morning"].append("runtime_morning_expense_workflow.py")
GROUPS["browser-morning"].append("runtime_morning_expense_batch.py")
GROUPS["browser-morning"].append("runtime_morning_expense_composition.py")
GROUPS["browser-lifecycle"].append("runtime_worker_release_cache.py")
GROUPS["browser-sync"].append("runtime_kupa_source_transition.py")
GROUPS["browser-sync"].append("runtime_spreadsheet_lifecycle.py")
GROUPS["database"].append("sync_incidents_postgres.py")
GROUPS["browser-sync"].append("runtime_sync_incidents.py")
GROUPS["browser-sync"].append("runtime_idb_receipts.py")
GROUPS["browser-lifecycle"].append("runtime_release_compatibility.py")
GROUPS["browser-lifecycle"].append("runtime_loaded_data.py")
GROUPS["browser-sync"].append("runtime_mutation_admission.py")
GROUPS["browser-sync"].append("runtime_incident_storage_liveness.py")
CORE_SUITES = [suite for group, suites in GROUPS.items() if not group.startswith("browser-") for suite in suites]
RUNTIME_SUITES = [suite for group, suites in GROUPS.items() if group.startswith("browser-") for suite in suites]
# Repair feedback is an explicit subset, never part of CI's partition or a
# deployment authorization. Keep core-only's existing database coverage intact.
REPAIR_SUITES = [suite for suite in CORE_SUITES if suite not in GROUPS["database"]]

# Lifecycle estimates were recalibrated on October 27 from three successful
# GitHub runs. The fixture replays each measured run against the current split;
# no previous result is used to skip tests. Models retain two isolated Node
# workers per machine. Only checked-in cost estimates influence scheduling.
CI_SHARDS = {"models": 2, "browser-lifecycle": 4, "browser-sync": 2}
# These short groups share compatible setup and remain below the browser critical
# path when combined. Only CI placement changes; local selections stay available.
CI_BUNDLES = {"contracts-database": ("contracts", "database", "browser-database")}


def suite_estimates():
    weights = timing_weights("suite_seconds")
    node_costs = estimates(test_files(), timing_weights("node_seconds"))
    for index, name in enumerate(SHARD_SUITES, 1):
        costs = [node_costs[file] for file in test_files(shard=index)]
        weights[name] = max(sum(costs) / 2, max(costs))
    return estimates([suite for suites in GROUPS.values() for suite in suites], weights)


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
    bundled = set()
    for name, members in CI_BUNDLES.items():
        if name in GROUPS or not isinstance(members, (tuple, list)) or not members:
            raise ValueError(f"Invalid CI bundle: {name}")
        for group in members:
            if group not in GROUPS or group in bundled or CI_SHARDS.get(group, 1) != 1:
                raise ValueError(f"Invalid or repeated CI bundle member: {group}")
            bundled.add(group)


def ci_groups():
    """Disjoint CI selections derived entirely from the full local inventory."""
    validate_plan()
    selections = {}
    weights = suite_estimates()
    for name, suites in GROUPS.items():
        count = CI_SHARDS.get(name, 1)
        parts = balanced_partition(suites, count, weights)
        for index, part in enumerate(parts):
            shard = name if count == 1 else f"{name}-{index + 1}"
            if shard in selections or (count > 1 and shard in GROUPS):
                raise ValueError(f"Duplicate CI group name: {shard}")
            selections[shard] = part
    for name, members in CI_BUNDLES.items():
        if name in selections:
            raise ValueError(f"Duplicate CI group name: {name}")
        bundled = [suite for member in members for suite in selections.pop(member)]
        selections[name] = balanced_partition(bundled, 1, weights)[0]
    # Offer the longest jobs first when runner capacity is limited. GitHub still
    # owns actual dispatch order; its account queues are outside this scheduler.
    return dict(sorted(selections.items(), key=lambda row: (-sum(weights[name] for name in row[1]), row[0])))


def ci_matrix():
    weights = suite_estimates()
    return {"include": [{"group": name, "browser": any(suite in RUNTIME_SUITES for suite in suites),
                         "postgres": any(suite in GROUPS["database"] + GROUPS["browser-database"] for suite in suites),
                         "estimated_seconds": round(sum(weights[suite] for suite in suites), 1)}
                        for name, suites in ci_groups().items()]}
