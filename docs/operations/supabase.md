# Supabase operations

[Root migrations](../../supabase/migrations) are the single installation and upgrade chain. Applied migrations stay byte-stable. Add a forward migration for each schema change. [Canonical migration lists and hashes](../../supabase) are reviewed expectations, while the deployment receipt and its source audit describe an authenticated Production observation. Per-app SQL and historical files remain available for their compatibility and verification consumers.

## Database release

1. Make the schema change in a new migration. Run `python tools/supabase_migration_manifest.py --write` for a reviewed change to the chain and verify it with isolated PostgreSQL and the full suite. See [Staging](staging.md) for the hosted rehearsal.
2. From the root, set `$projectRef` to the intended hosted project. The Production project ref is in [postflight-target.json](../../supabase/postflight-target.json). Inspect the dry run and exact target's history. A supported CLI v3 defaults to the local stack without an explicit remote.

   ```powershell
   supabase migration list --workdir . "--remote=$projectRef"
   supabase db push --dry-run --workdir . "--remote=$projectRef"
   ```

3. Confirm that the installed chain is an exact prefix and that only the reviewed suffix is pending. After release approval, apply that suffix once with `supabase db push --workdir . "--remote=$projectRef" --yes`. Leave production migration history, seeds and data resets alone.
4. Run `python tools/supabase_deploy_gate.py` with an authenticated live source. Verify project identity, SQL hashes, application schema, grants, RLS and retention jobs before releasing dependent clients.

## Edge release

From the repository root, set `$functionName` and `$projectRef` to the reviewed function and exact target. The [function configuration](../../netunim-orders/supabase/config.toml) and server handlers own authentication. Preserve the configuration, especially for browser preflight and Google callbacks. The user operations authenticate inside each function and require the applicable MFA and feature permissions.

```powershell
supabase functions deploy $functionName --workdir netunim-orders --no-verify-jwt --use-api "--remote=$projectRef" --yes
```

Use the setup guides for [Google](../integrations/google.md), [Morning income](../integrations/morning-income.md) and [Morning expenses](../integrations/morning-expenses.md). Set secrets in the owning project. Only publishable keys belong in browser config.

## Deployment gate

`tools/supabase_deploy_gate.py` first checks the local manifest. If provided, it uses `NETUNIM_SUPABASE_CAPTURE`, a PostgreSQL service/connection, or the Supabase CLI on PATH, in that order. The CLI must be authenticated and support `db query --read-only --remote=<project-ref>`. A live-source failure blocks the upload. Without a live source, the stored receipt must cover the complete reviewed chain. The regular verifier can accept an exact prefix so pending SQL can be tested before release.

When the stored receipt is an exact prefix but Production already has the suffix, the live gate can reconstruct the expected upgraded catalog in disposable PostgreSQL. It never applies remote migrations or updates evidence. Preserve the authenticated baseline and audit file. To record a new release receipt after a verified database release:

```powershell
python tools/supabase_candidate_schema.py --output .work/database-release-candidate.json
python tools/supabase_capture_query.py
# Run the generated SELECT using the authenticated Production connector.
# Save the single returned JSON row to .work/production-capture.json.
python tools/supabase_postflight.py --expected .work/database-release-candidate.json --capture .work/production-capture.json --record-release
```

Use a new private candidate path for each release and a fresh capture within five minutes. The command writes the reviewed schema snapshot, dated source audit and receipt after full live verification. A capture is an authenticated operator handoff. Keep it out of the public repository. Catalog discrepancies or unexpected SQL hashes require investigation. A stale receipt alone calls for live verification.

## Access and retention

Keep RLS plus scoped RPC grants as the database authority. Cloudflare Access controls site delivery independently. Application MFA and MFA for Supabase management accounts require separate enrollment. Keep the two retention schedules and their owned commands consistent with [retention-jobs.json](../../supabase/retention-jobs.json). The postflight verifies cron metadata. The [recovery runbook](recovery.md) covers isolated database and Storage drills.

The historical [Advisor inventory](../../supabase/audit/security-advisor-upgraded.json)
is still used to verify grants. The acknowledgement RPCs
`acknowledge_bank_transaction_alert` and `acknowledge_bank_transaction_missing`
and the lease RPCs `claim_finance_sync_lease` and `release_finance_sync_lease`
are deliberately available to authenticated callers within their owner scope.
The historical write RPCs `apply_restore_group_v5`, `stage_restore_group_v5`,
`merge_bank_transactions`, `sync_bank_transactions_snapshot`,
`save_bank_sync_snapshot` and `save_finance_sync_document_v5` remain in the
catalog with browser execution revoked. [Authorization checks](../../tests/supabase_authorization.py)
and [writer protocol checks](../../tests/storage_writer_protocol_server.py)
cover these distinctions.
