# Sync integrity hardening v5

This release keeps the existing document architecture, revision concurrency, 3-way merge, dual-store outboxes, operation IDs, Shared Checks separation, and backup model. It adds fail-closed invariants and explicit destructive-operation boundaries.

## Persistent-array classification

| Document | Collection | Classification | Deletion contract |
|---|---|---|---|
| Orders | `suppliers`, `transactions`, `customerDebts`, `customerOrders`, `serviceCalls`, `notes`, `inventoryItems`, `inventoryEvents`, `warehouseOrders` | Stable-ID user entities | Exact v4/v5 delete intent plus mass guard |
| Orders | `inventoryCategoryOrder` | Replaceable display configuration | Whole-value 3-way merge; no entity delete intent |
| Kupa | `credits`, `cash`, `rights`, `notes`, `expenses`, `notesSheet.rows`, `notesSheet.columns` | Stable-ID user entities | Exact v4/v5 delete intent plus mass guard |
| Kupa | `cards` | User-maintained persistent records | Stable ID assigned once to legacy cards; ID-based merge and exact delete intent |
| Kupa | `bank.adjustments` | Reset-controlled finance configuration | Whole array remains under finance/reset flows; no new delete-intent semantics were added without a separate business decision |
| Shared Checks | `checks` | Stable-ID user entities in an authoritative separate document | Exact deleted-ID contract plus mass guard |
| Shared Checks | `bankEvents` | Server/finance-derived event stream (`eventId`/sequence semantics, not generic `id`) | Preserved by the Shared Checks merge/restore flow; not treated as an ID-keyed user collection |
| Finance | provider feeds, monthly slices, pending/unassigned transactions | Server/provider-derived data in a separate document | Outside Kupa/Orders destructive writes; v5 staging test asserts finance isolation |

Every ID-keyed collection is validated before client staging and again in the database transaction. Missing, blank, non-canonical, or duplicate IDs are rejected; no validator normalizes or collapses duplicates.

## Destructive-write policy

Routine writes may coalesce one or two individually confirmed deletions. A regular writer is rejected when a collection loses either:

- 10 or more records; or
- at least 3 records and at least 50% of the prior collection.

The constants are in `netunim_internal.mass_destructive_guard` and reflect the current UI: bulk controls are already explicit, confirmation-gated surfaces, while single record actions can coalesce in one autosave window. Changing these values requires UX review and staging-contract changes.

Confirmed bulk deletes use dedicated v5 RPCs. Restore uses a durable restore-group RPC. Both capture an immutable server safety snapshot before the protected write. A boolean `force` parameter is not accepted.

## Restore durability

Before cloud mutation, the browser stores the restore ID, both targets, base revisions, exact intents, operation IDs, SHA-256 payload hashes, local target, before-state, and phase in LocalStorage and IndexedDB. The server then stores the same cloud targets and hashes. `apply_restore_group_v5` applies main and Shared Checks in one database transaction; failure rolls back both. Lost ACK is safe because both operation IDs and the group ID are replayable. Startup resumes a local group and also detects server-staged incomplete groups.

Completed local restore archives remain in IndexedDB as before-restore recovery material. Only the current pointer is removed after cloud ACK and successful local application. Server safety snapshots and public backup history cannot be updated, deleted, truncated, or pruned by browser roles.

## Deployment order

1. Stop writes or enter a controlled maintenance window and take a production database/safety export. Record its location and checksum outside browser storage.
2. Apply `sync_integrity_v5_upgrade.sql` on a staging branch first. The migration is additive and transactional; it does not rewrite live business rows or historical backups.
3. Run `supabase/shared/validation/sync_integrity_v5_server_contracts.sql` with a dedicated staging user. It includes the historical 55→1 fixture and rolls back all test rows.
4. Run `supabase/shared/validation/sync_integrity_v5_postflight.sql` and verify RPCs, triggers, RLS, grants, invariant functions, immutable backups, restore tables, and the active trusted ledger schedule.
5. Deploy database protection before dependent clients. Deploy Kupa and Orders together because v5 Shared Checks is common. Old clients fail closed at the invariant/mass guard rather than bypassing protection.
6. Run `python tests/run_all.py` on CI/Windows with localhost/native ESM browser runtime enabled. `--core-only` is not a deployment gate.
7. Monitor delete-intent rejections, mass-delete rejections, revision conflicts, pending-outbox age, incomplete restore groups, and safety-snapshot failures.

Do not shorten the two-year operation-ledger retention until the 365-day durable offline/lost-ACK horizon is re-evaluated. Pruning is scheduled weekly by trusted `pg_cron`; browser roles have neither prune execution nor ledger delete permission.

## Operator runbook (PowerShell)

Run from the repository root. Install PostgreSQL client tools first if `psql` and `pg_dump` are not on `PATH`. Keep database URLs only in the deployment shell or secret store; never place them under either `site/` directory.

```powershell
$repoRoot = (Resolve-Path .).Path
$env:NETUNIM_STAGING_DB_URL = 'postgresql://...staging...'
$env:NETUNIM_PRODUCTION_DB_URL = 'postgresql://...production...'
$env:NETUNIM_STAGING_TEST_OWNER = '00000000-0000-0000-0000-000000000000' # dedicated staging auth.users id
$env:NETUNIM_BACKUP_DIR = 'X:\protected-backups\netunim' # replace with an access-controlled path outside this repository
```

### 1. Verify the checkout

```powershell
Set-Location $repoRoot
npm ci
python tools/sync-assets.py --check
python tests/run_all.py
```

Do not deploy from a `--core-only` result. The unqualified command includes the Windows/localhost browser-runtime suites.

### 2. Take the production safety backup before any schema change

```powershell
$backupDir = [IO.Path]::GetFullPath($env:NETUNIM_BACKUP_DIR)
if ($backupDir.StartsWith($repoRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'NETUNIM_BACKUP_DIR must be outside the repository.' }
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$backupStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $backupDir "netunim-production-before-sync-v5-$backupStamp.dump"
& pg_dump --dbname $env:NETUNIM_PRODUCTION_DB_URL --format=custom --no-owner --no-privileges --file $backupFile
if ($LASTEXITCODE -ne 0) { throw 'Production pg_dump failed; do not continue.' }
Get-Item -LiteralPath $backupFile | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
```

Copy the dump and recorded SHA-256 to protected storage outside the browser and outside the deployment artifact. Do not continue unless the file is non-empty and the checksum has been recorded.

### 3. Apply and prove v5 on staging

```powershell
$migration = Join-Path $repoRoot 'netunim-orders/supabase/sync_integrity_v5_upgrade.sql'
$serverContracts = Join-Path $repoRoot 'netunim-orders/supabase/shared/validation/sync_integrity_v5_server_contracts.sql'
$postflight = Join-Path $repoRoot 'netunim-orders/supabase/shared/validation/sync_integrity_v5_postflight.sql'

& psql $env:NETUNIM_STAGING_DB_URL -X -v ON_ERROR_STOP=1 -f $migration
if ($LASTEXITCODE -ne 0) { throw 'Staging v5 migration failed.' }
& psql $env:NETUNIM_STAGING_DB_URL -X -v ON_ERROR_STOP=1 -v "owner_id=$env:NETUNIM_STAGING_TEST_OWNER" -f $serverContracts
if ($LASTEXITCODE -ne 0) { throw 'Staging destructive/fault contracts failed.' }
& psql $env:NETUNIM_STAGING_DB_URL -X -v ON_ERROR_STOP=1 -f $postflight
if ($LASTEXITCODE -ne 0) { throw 'Staging postflight failed.' }
```

The migration intentionally aborts if the v3 ledger, v4 exact-intent RPCs, internal writers, or document tables are missing. Install the existing prerequisite migrations in their documented order; do not weaken the v5 precondition.

### 4. Staging client acceptance

Deploy both `netunim-kupa/site/` and `netunim-orders/site/` to staging from the same commit. Exercise at least one ordinary edit, single delete, confirmed bulk delete, offline edit/restart, two-tab read-only behavior, and a restore that includes Shared Checks. Then rerun the staging postflight above.

### 5. Production cutover

Use a controlled write-maintenance window. With the backup from step 2 already complete:

```powershell
& psql $env:NETUNIM_PRODUCTION_DB_URL -X -v ON_ERROR_STOP=1 -f $migration
if ($LASTEXITCODE -ne 0) { throw 'Production v5 migration failed; clients must not be deployed.' }
& psql $env:NETUNIM_PRODUCTION_DB_URL -X -v ON_ERROR_STOP=1 -f $postflight
if ($LASTEXITCODE -ne 0) { throw 'Production postflight failed; keep writes closed.' }
```

Do not run the staging fixture on production. After the postflight passes, use the repository's coordinated deployment entrypoint; it verifies the repository once and deploys Orders followed by Kupa from the same checkout:

```powershell
& cmd.exe /d /c deploy_all.bat --preflight-only
if ($LASTEXITCODE -ne 0) { throw 'Combined client preflight failed; do not upload.' }
& cmd.exe /d /c deploy_all.bat
if ($LASTEXITCODE -ne 0) { throw 'Coordinated client deployment failed; keep writes closed.' }
& psql $env:NETUNIM_PRODUCTION_DB_URL -X -v ON_ERROR_STOP=1 -f $postflight
if ($LASTEXITCODE -ne 0) { throw 'Post-deploy database postflight failed; keep writes closed.' }
```

Database guards must precede the clients. Reopen writes only after the second production postflight passes.

### 6. Immediate monitoring

Use Supabase/Postgres logs to alert on `kupa_delete_intent_mismatch`, `order_management_delete_intent_mismatch`, `shared_checks_delete_intent_mismatch`, `mass_delete_requires_dedicated_rpc`, `revision_conflict`, and `save_busy`. Check incomplete restores and recent destructive operations with read-only queries:

```sql
select owner_id,restore_group_id,app_site,phase,created_at,updated_at,last_error_code
from netunim_internal.restore_operation_groups
where phase <> 'completed'
order by created_at;

select owner_id,domain,document_name,operation_id,app_site,client_instance_id,
       build_version,mutation_type,surface,base_revision,applied_revision,
       before_counts,after_counts,delete_count,restore_group_id,audit_timestamp
from netunim_internal.document_sync_operations
where audit_timestamp >= now() - interval '24 hours'
order by audit_timestamp desc;

select owner_id,domain,document_name,operation_id,operation_kind,revision,restore_group_id,created_at
from netunim_internal.safety_snapshots
where created_at >= now() - interval '24 hours'
order by created_at desc;
```

Pending outbox age is client-local by design; monitor the visible sync status and browser diagnostics on both sites. Never clear site data while an outbox or restore is pending.

If the migration fails, its transaction rolls back automatically. After a successful production migration, prefer rolling back only the static clients while leaving the fail-safe database guards in place. A database restore is an outage procedure and should use the verified dump from step 2, not ad-hoc cleanup SQL.
