from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDERS = ROOT / "netunim-orders"
KUPA = ROOT / "netunim-kupa"
errors = []


def ok(condition, label):
    print(("PASS " if condition else "FAIL ") + label)
    if not condition:
        errors.append(label)


def balanced_dollars(text):
    import re
    tags = re.findall(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text)
    return all(tags.count(tag) % 2 == 0 for tag in set(tags))


orders_sql = (ORDERS / "supabase/sync_integrity_v5_upgrade.sql").read_text(encoding="utf-8")
kupa_sql = (KUPA / "supabase/sync_integrity_v5_upgrade.sql").read_text(encoding="utf-8")
lower = orders_sql.lower()
runbook = (ROOT / "SYNC_HARDENING_V5.md").read_text(encoding="utf-8")

ok(orders_sql == kupa_sql, "sync-integrity v5 migration is byte-identical in Orders and Kupa")
ok(balanced_dollars(orders_sql) and lower.rstrip().endswith("commit;"), "v5 migration is transactionally and dollar-quote balanced")

collections = [
    "suppliers", "transactions", "customerDebts", "customerOrders", "serviceCalls", "notes",
    "inventoryItems", "inventoryEvents", "warehouseOrders", "credits", "cash", "rights", "expenses",
    "cards", "notesSheet.rows", "notesSheet.columns", "checks",
]
ok(all(name in orders_sql for name in collections)
   and "entity_id_missing_or_blank" in lower and "duplicate_entity_id" in lower
   and "document_invariant_guard" in lower,
   "server invariant guard covers every persistent ID-keyed collection")
ok("assertOrderEntityInvariants" in (ORDERS / "site/assets/js/state/validation.js").read_text(encoding="utf-8")
   and "assertKupaEntityInvariants" in (KUPA / "site/assets/js/state/validation.js").read_text(encoding="utf-8")
   and "assertEntityCollection" in (ROOT / "shared/data-invariants.js").read_text(encoding="utf-8"),
   "client validation rejects malformed IDs before staging")

ok("v_absolute_threshold constant integer:=10" in lower
   and "v_percentage_min_count constant integer:=3" in lower
   and "v_percentage_threshold constant numeric:=0.50" in lower
   and "mass_delete_requires_dedicated_rpc" in lower,
   "routine mass-delete threshold is documented in code and enforced by trigger")
ok(all(name in lower for name in (
    "bulk_delete_save_order_management_document_v5", "bulk_delete_save_kupa_document_v5",
    "bulk_delete_save_shared_checks_document_v5", "capture_safety_snapshot", "save_finance_sync_document_v5"))
   and "app.destructive_operation_kind" in lower,
   "approved mass deletion uses dedicated RPCs with a pre-destructive server snapshot")

ok("restore_operation_groups" in lower and "main_payload_sha256" in lower and "checks_payload_sha256" in lower
   and all(phase in lower for phase in ("staged", "main_pending", "main_acked", "checks_pending", "checks_acked", "completed"))
   and "stage_restore_group_v5" in lower and "apply_restore_group_v5" in lower,
   "restore group stores both targets, hashes, revisions, operation IDs and durable phases")
restore_client = (ROOT / "shared/restore-groups.js").read_text(encoding="utf-8")
ok("restorePayloadHash" in restore_client and "await put(currentKey" in restore_client
   and "await stageRemote(current)" in restore_client and "await applyRemote" in restore_client
   and "await onApplied" in restore_client and "await store.complete" in restore_client,
   "client restore persists locally before writes and clears current group only after ACK and local apply")
for site in (ORDERS, KUPA):
    ui = (site / "site/assets/js/ui/backup.js").read_text(encoding="utf-8")
    lifecycle = (site / "site/assets/js/lifecycle.js").read_text(encoding="utf-8")
    ok("executeRestoreGroup" in ui and "resumeIncompleteRestore" in ui and "resumeIncompleteRestore" in lifecycle,
       f"{site.name}: restore is unified and startup-resumable")

ok("create table if not exists netunim_internal.safety_snapshots" in lower
   and "revoke update,delete,truncate on table netunim_internal.safety_snapshots" in lower
   and "grant select on table netunim_internal.safety_snapshots to authenticated" in lower
   and 'create policy "safety_snapshots_insert_own"' not in lower
   and "revoke update,delete,truncate on table public.%i" in lower,
   "safety and public backup history is append-only to browser roles")
ok("remove_inline_pruning" in lower and "prune_sync_operation_ledgers" in lower
   and "cron.schedule" in lower and "netunim-sync-ledger-retention-weekly" in lower,
   "rolling-backup pruning is removed from browser writes and ledger retention has a real trusted schedule")

backup_prune = lower.split("create or replace function netunim_internal.prune_document_backups()", 1)[1].split("$maintenance$;", 1)[0]
ok("security definer set search_path=pg_catalog" in backup_prune
   and all(table in backup_prune for table in (
       "order_management_document_backups", "kupa_document_backups", "shared_checks_document_backups",
       "order_management_periodic_backups", "kupa_periodic_backups", "shared_checks_periodic_backups"))
   and "partition by owner_id,document_name" in backup_prune and "recency_rank>200" in backup_prune
   and "interval ''365 days''" in backup_prune and "safety_snapshots" not in backup_prune,
   "trusted backup prune keeps 200 rolling rows, expires 365-day periodic rows and excludes safety snapshots")
ok("revoke all on function netunim_internal.prune_document_backups() from public,anon,authenticated" in lower
   and "grant execute on function netunim_internal.prune_document_backups() to service_role" in lower
   and "netunim-document-backup-retention-daily" in lower and "43 3 * * *" in lower,
   "backup retention execution and daily schedule are trusted-only")

postflight = (ORDERS / "supabase/shared/validation/sync_integrity_v5_postflight.sql").read_text(encoding="utf-8").lower()
ok("v5_postflight_browser_backup_maintenance_grant" in postflight
   and "v5_postflight_backup_prune_not_locked" in postflight
   and "v5_postflight_backup_retention_schedule_missing" in postflight
   and "netunim-document-backup-retention-daily" in postflight and "active" in postflight,
   "database postflight proves the trusted backup prune and active cron job")

ok(all(column in lower for column in (
    "client_instance_id", "app_site", "build_version", "mutation_type", "surface", "base_revision",
    "before_counts", "after_counts", "delete_count", "restore_group_id", "audit_timestamp"))
   and "record_operation_audit" in lower,
   "operation ledger stores forensic metadata without business payload duplication")

cloud_sync = (ROOT / "shared/cloud-sync.js").read_text(encoding="utf-8")
ok("mutationSeq" in cloud_sync and "generationDelta" in cloud_sync and "sequenceDelta" in cloud_sync
   and "Date.parse(a?.updatedAt" not in cloud_sync,
   "dual-store outbox ordering is deterministic under clock rollback")

bulk = (KUPA / "site/assets/js/ui/bulk.js").read_text(encoding="utf-8")
ok("deletedIds:ids" in bulk and "deleteIntents:{[collection]:ids}" in bulk
   and "mutationType:'bulk-delete'" in bulk,
   "Kupa checks/credits/cash/rights bulk deletion forwards exact IDs")
card_merge = (KUPA / "site/assets/js/sync/merge.js").read_text(encoding="utf-8")
card_migration = (KUPA / "site/assets/js/sync/legacy-card-migration.js").read_text(encoding="utf-8")
card_pending = (KUPA / "site/assets/js/storage/pending.js").read_text(encoding="utf-8")
ok("out.cards=mergeRecordArray" in card_merge and "migrateLegacyCards3Way" in card_merge
   and "stableLegacyPositionId" in card_migration and "legacy-card-migration-conflict" in card_migration
   and "migrateLegacyCardPair" in card_pending,
   "Kupa cards use lineage-aware one-time IDs, durable outbox migration and explicit ambiguity conflicts")

kupa_validation = (KUPA / "site/assets/js/state/validation.js").read_text(encoding="utf-8")
kupa_entity_declaration = kupa_validation.split("KUPA_ENTITY_COLLECTIONS=", 1)[1].split(");", 1)[0]
ok("adjustments:mergeValue(" in card_merge and "adjustments:mergeValuePreferLocal(" in card_merge
   and "adjustments:mergeRecordArray(" not in card_merge and "bank.adjustments" not in kupa_entity_declaration
   and "reset-controlled finance configuration" in runbook.lower(),
   "Kupa bank adjustments use whole-value merge rather than unvalidated entity identity")

data_preflight = (ORDERS / "supabase/shared/validation/sync_integrity_v5_data_preflight.sql").read_text(encoding="utf-8").lower()
data_postdeploy = (ORDERS / "supabase/shared/validation/sync_integrity_v5_data_postdeploy.sql").read_text(encoding="utf-8").lower()
ok("transaction read only" in data_preflight and "legacy kupa cards without an id" in data_preflight
   and "pending compatibility" in data_preflight and all(term in data_preflight for term in ("missing=", "blank_or_invalid=", "duplicate_records=")),
   "read-only data preflight reports malformed IDs, legacy Kupa cards and pending compatibility")
ok("bank.adjustments" not in data_preflight and "'{bank,adjustments}'" in lower,
   "bank adjustments remain array-validated configuration and stay outside ID data preflight")
ok("transaction read only" in data_postdeploy and "postdeploy_kupa_cards_invalid" in data_postdeploy
   and "no kupa card is missing a stable id" in data_postdeploy,
   "post-deploy data gate rejects every remaining Kupa card without a stable ID")

ok("last_error_code" not in runbook and "cannot durably update `phase` or an error column" in runbook
   and "failed `apply_restore_group_v5` RPCs" in runbook
   and "last_error_code" not in lower,
   "restore monitoring does not claim transactional failure state is durable")

production = runbook[runbook.index("### 5. Production cutover"):]
production_positions = [
    production.index("-f $dataPreflight"),
    production.index("-f $migration"),
    production.index("-f $postflight"),
    production.index("deploy_all.bat"),
    production.index("open the deployed Kupa v5 client"),
    production.index("-f $dataPostdeploy"),
    production.index("-f $postflight", production.index("-f $dataPostdeploy")),
    production.rindex("reopen normal writes"),
]
ok(production_positions == sorted(production_positions)
   and production_positions[4] < production_positions[5]
   and production_positions[5] < production_positions[6],
   "production runbook puts the Kupa card ID gate after trusted client migration and before final DB postflight/write reopening")

contracts = (ORDERS / "supabase/shared/validation/sync_integrity_v5_server_contracts.sql").read_text(encoding="utf-8").lower()
ok(all(fragment in contracts for fragment in (
    "stale_55_to_1_was_accepted", "routine_mass_delete_was_accepted", "approved_bulk_contract_failed",
    "malformed_id_was_accepted", "restore_lost_ack_replay_not_idempotent", "browser_can_delete_immutable_backup",
    "direct_update_was_accepted", "finance_document_changed_by_core_restore", "browser_can_execute_backup_prune",
    "trusted_prune_did_not_keep_exactly_200_newest", "periodic_backup_under_365_days_was_deleted",
    "periodic_backup_over_365_days_was_retained", "backup_retention_changed_safety_snapshots", "rollback;")),
   "staging contracts cover historical loss, mass guard, restore replay, backup retention, direct guards and finance isolation")

print(f"\nERRORS {len(errors)}")
raise SystemExit(1 if errors else 0)
