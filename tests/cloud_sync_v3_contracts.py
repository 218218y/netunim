from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDERS = ROOT / "netunim-orders"
KUPA = ROOT / "netunim-kupa"
errors = []


def ok(condition: bool, label: str):
    print(("PASS " if condition else "FAIL ") + label)
    if not condition:
        errors.append(label)


orders_migration = (ORDERS / "supabase/cloud_sync_lossless_v3_upgrade.sql").read_text(encoding="utf-8")
kupa_migration = (KUPA / "supabase/cloud_sync_lossless_v3_upgrade.sql").read_text(encoding="utf-8")
lower = orders_migration.lower()

ok(orders_migration == kupa_migration, "lossless v3 migration is byte-identical in Orders and Kupa")
ok("security definer" not in lower and lower.count("security invoker") >= 2,
   "private replacements and existing public wrappers retain invoker rights")
ok("netunim_internal.save_order_management_document" in lower
   and "netunim_internal.save_shared_checks_document" in lower
   and "netunim_internal.save_kupa_document" in lower
   and "revision_conflict" in lower and "pt409" in lower,
   "only explicit revision-conflict branches are upgraded to PT409")
ok("stale_bank_snapshot_watermark' using errcode='40001'" in lower
   and "idempotency_key_reuse' using errcode='pt422'" in lower,
   "bank watermark and idempotency-key reuse keep distinct machine contracts")

finance_equality = lower.index("if v_current_state = p_state")
finance_conflict = lower.index("if v_current<>p_expected_revision", finance_equality)
ok(finance_equality < finance_conflict,
   "Finance checks semantic equality before optimistic revision conflict")

bank_lookup = lower.index("from netunim_internal.bank_sync_operations")
bank_write = lower.index("set revision=f.revision+1", bank_lookup)
ok(bank_lookup < bank_write
   and "payload_sha256" in lower
   and "digest(convert_to(p_bank_state::text" in lower
   and "return next; return;" in lower[bank_lookup:bank_write],
   "Bank snapshot token replay is verified and returned before either revision is incremented")
ok("primary key (owner_id, document_name, operation_id)" in lower
   and "enable row level security" in lower
   and "revoke all on table netunim_internal.bank_sync_operations" in lower
   and "grant select, insert on table netunim_internal.bank_sync_operations to authenticated" in lower,
   "bank idempotency ledger has owner-scoped uniqueness, RLS and explicit grants")
ok("netunim_internal.document_sync_operations" in lower
   and "primary key (owner_id, domain, document_name, operation_id)" in lower
   and "grant select, insert on table netunim_internal.document_sync_operations to authenticated" in lower
   and "enable row level security" in lower,
   "document operation ledger is owner-scoped, internal, RLS-protected and minimally granted")
ok(all(name in lower for name in (
    "save_order_management_document_v3", "save_kupa_document_v3",
    "save_shared_checks_document_v3", "save_finance_sync_document_v3"))
   and lower.count("p_operation_id text") >= 4
   and lower.count("operation_replayed boolean") >= 4
   and lower.count("operation_revision bigint") >= 4
   and lower.count("idempotency_key_reuse") >= 5,
   "v3 RPCs use explicit non-overloaded names and durable operation acknowledgements")
ok("netunim_financial_write:" in lower and "lock_timeout', '100ms'" in lower,
   "financial advisory gate and 100ms row-lock timeout are preserved")
ok("statement_timeout" not in lower,
   "statement timeout is not guessed before staging percentile measurements")
ok("notify pgrst,'reload schema'" in lower and lower.rstrip().endswith("commit;"),
   "migration is transactional and requests a PostgREST schema reload")

shared = (ROOT / "shared/cloud-sync.js").read_text(encoding="utf-8")
for site in (ORDERS, KUPA):
    copied = (site / "site/assets/js/shared/cloud-sync.js").read_text(encoding="utf-8")
    ok(copied == shared, f"{site.name}: shared outbox/error/scheduler primitive is deterministic")
ok("status===429||code==='SUPABASE_DATA_API_RATE_LIMIT'" in shared
   and "else if(status===409)kind='conflict'" in shared
   and "code==='PT429'" in shared and "code==='PT409'" in shared,
   "generic HTTP 429/409 are not misclassified as application busy/revision conflict")
ok("if(item.key)coalesced.delete(item.key)" not in shared
   and "promise.finally" in shared and "coalesced.delete(coalesceKey)" in shared,
   "poll coalescing remains active until the in-flight promise settles")

for label, site in (("Orders", ORDERS), ("Kupa", KUPA)):
    auth = (site / "site/assets/js/cloud/auth.js").read_text(encoding="utf-8")
    ok("SUPABASE_DATA_API_RATE_LIMIT" in auth
       and "responseIsAppBusy" in auth
       and "tripSupaDataApiRateLimit" in auth
       and "retry-after" in auth.lower(),
       f"{label}: generic Data API 429 honors Retry-After while PT429 remains app contention")

for label, path in (("Orders transport", ORDERS / "site/assets/js/cloud/transport.js"),
                    ("Kupa transport", KUPA / "site/assets/js/cloud/transport.js")):
    source = path.read_text(encoding="utf-8")
    ok("_v3" in source and "p_operation_id" in source, f"{label}: operation-aware v3 RPC transport is present")
for label, path in (("Orders document", ORDERS / "site/assets/js/sync/document.js"),
                    ("Kupa document", KUPA / "site/assets/js/sync/document.js")):
    source = path.read_text(encoding="utf-8")
    ok("operationId" in source and "rpcSave" in source, f"{label}: durable operation id is preserved through document retries")

orders_storage = (ORDERS / "site/assets/js/storage/browser.js").read_text(encoding="utf-8")
orders_checks = (ORDERS / "site/assets/js/storage/checks.js").read_text(encoding="utf-8")
kupa_pending = (KUPA / "site/assets/js/storage/pending.js").read_text(encoding="utf-8")
kupa_checks = (KUPA / "site/assets/js/sync/checks-state.js").read_text(encoding="utf-8")
for label, source in (("Orders", orders_storage), ("Orders checks", orders_checks),
                      ("Kupa", kupa_pending), ("Kupa checks", kupa_checks)):
    ok("migrateOutboxRecord" in source and "acknowledgedGenerationMatches" in source
       and ("schemaVersion" not in source or "OUTBOX" in source),
       f"{label}: durable pending supports migration and generation-exact ACK")

for label, path in (("Orders", ORDERS / "site/assets/js/storage/tab-lock.js"),
                    ("Kupa", KUPA / "site/assets/js/storage/tab-lock.js")):
    source = path.read_text(encoding="utf-8")
    ok("BroadcastChannel" in source and "localStorage" in source and "expiresAt" in source,
       f"{label}: no-Web-Locks fallback uses broadcast plus expiring local heartbeat")

calendar = (ORDERS / "site/assets/js/domains/calendar/controller.js").read_text(encoding="utf-8")
main = (ORDERS / "site/assets/js/main.js").read_text(encoding="utf-8")
edge = (ORDERS / "supabase/functions/google-calendar-oauth/index.ts").read_text(encoding="utf-8")
ok("!tab.primaryTab&&ui.currentView!=='calendar'" in calendar
   and main.index("lifecycle.boot().then") < main.index("domainsCalendarController.start()", main.index("lifecycle.boot().then")),
   "Calendar background startup is gated by completed primary-tab election")
ok("calendar_data_api_unavailable" in edge and "PGRST002" in edge and "PGRST003" in edge,
   "Calendar Edge Function maps Data API degradation to semantic HTTP 503")

server_contracts = (ORDERS / "supabase/shared/validation/cloud_sync_v3_server_contracts.sql").read_text(encoding="utf-8").lower()
benchmark = (ORDERS / "supabase/shared/validation/cloud_sync_v3_benchmark.sql").read_text(encoding="utf-8").lower()
stress = (ROOT / "tools/cloud-sync-staging-stress.mjs").read_text(encoding="utf-8")
ok(all(name in server_contracts for name in (
    "save_order_management_document_v3", "save_kupa_document_v3", "save_shared_checks_document_v3",
    "save_finance_sync_document_v3", "save_bank_sync_snapshot", "merge_bank_transactions",
    "claim_finance_sync_lease", "release_finance_sync_lease"))
   and server_contracts.count("intervening_write_replay_failed") == 4
   and "operation_replayed" in server_contracts and "operation_revision" in server_contracts
   and server_contracts.rstrip().endswith("pass cloud sync v3 server contracts (transaction rolled back)'")
   and "rollback;" in server_contracts,
   "staging SQL contracts cover every critical writer and always roll back")
ok(all(metric in benchmark for metric in ("p50_ms", "p95_ms", "p99_ms", "max_ms", "minimum_5x_p99_ms"))
   and "rollback;" in benchmark and "staging only" in benchmark,
   "staging benchmark reports required percentiles without persisting its mutations")
ok("PRODUCTION_PROJECT_REF='bupoidcurcxuypfrjqio'" in stress
   and "NETUNIM_STAGING_CONFIRM!=='staging-only'" in stress
   and "Promise.all([" in stress
   and "p_operation_id:operationId" in stress
   and "save_order_management_document_v3" in stress
   and "save_kupa_document_v3" in stress
   and "stressDocument({label:'orders'" in stress
   and "stressDocument({label:'kupa'" in stress,
   "HTTP concurrency harness refuses production and runs Orders plus Kupa together")

if errors:
    print(f"\nERRORS {len(errors)}")
    for error in errors:
        print("-", error)
    raise SystemExit(1)
print("\nERRORS 0")
