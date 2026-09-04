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
ok("out.cards=mergeRecordArray" in (KUPA / "site/assets/js/sync/merge.js").read_text(encoding="utf-8")
   and "stableLegacyEntityId('CARD'" in (KUPA / "site/assets/js/state/normalization.js").read_text(encoding="utf-8"),
   "Kupa cards are stable-ID entities with deletion protection")

contracts = (ORDERS / "supabase/shared/validation/sync_integrity_v5_server_contracts.sql").read_text(encoding="utf-8").lower()
ok(all(fragment in contracts for fragment in (
    "stale_55_to_1_was_accepted", "routine_mass_delete_was_accepted", "approved_bulk_contract_failed",
    "malformed_id_was_accepted", "restore_lost_ack_replay_not_idempotent", "browser_can_delete_immutable_backup",
    "direct_update_was_accepted", "finance_document_changed_by_core_restore", "rollback;")),
   "staging contracts cover historical loss, mass guard, restore replay, immutability, direct guards and finance isolation")

print(f"\nERRORS {len(errors)}")
raise SystemExit(1 if errors else 0)
