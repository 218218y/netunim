# Paired static releases and recovery

Orders and Kupa deploy independently. No script claims Cloudflare makes the pair
atomic. Keep the previous verified commit and each project's previous deployment
URL/ID with the release record before the first upload. The full local or exact
GitHub verification and fresh authenticated Production database gate remain
required. These changes do not deploy a site or apply a database migration.

## Compatibility window

The current release and its immediately preceding verified release must coexist
on the same server during rollout, recovery and long-lived browser sessions.
Main/Shared retain protocol 2, existing writer RPCs and persisted formats;
workbooks retain their independent version 1 store and RPCs. A future incompatible
API/schema change must first ship an additive server version compatible with both
clients, then clients, then retire old contracts only after consumer closure and
old-backup evidence. Renaming/removing an RPC or changing merge/ACK semantics is
outside a presentation or deployment refactor.

`sync-assets.py` derives each response's `X-Netunim-Release` from the public shell,
security headers, vendor manifests and worker implementation. The derived header
and cache key do not hash themselves; LF/CRLF checkouts produce the same identity.
The normal and staged generators update both `_headers` and worker atomically
after validating the plan. An unchanged rerun is read only.

The worker still tries the network first. A missing/different release header or
failed shell response falls back only to a matching entry in that release's own
cache. Mismatched bytes never refresh that cache. The same applies to first-use
vendor runtime responses. An unavailable matching asset fails closed. Installation
checks every cached shell response's release before accepting the worker. An
update waits while old controlled tabs remain; close all app tabs after saving to
activate it. First installation retains immediate control and offline support.

The first rollout of this protection cannot retrofit guards into an already
installed old worker. Keep this adoption release compatible with its predecessor
and close/reopen existing tabs before testing the protected release. The release
label is a deployment consistency contract, not a substitute for TLS or an
independent cryptographic signature of every HTTP response.

## Upload and per-project recovery

1. Verify both sites and record the exact source commit, previous deployments and
   fresh database postflight. Use disposable data for release exercises.
2. Upload Orders. Its shared engine runs `deployment_smoke.py` before returning
   success. The read-only smoke compares 11 critical static files, response release,
   JavaScript MIME and nosniff to the local verified source. It records hashes in
   `.work/deploy/bargig-orders-smoke.json` and never reads business data.
3. Upload Kupa only after Orders passes. Its smoke records the equivalent Kupa
   report. A failure is a partial release, including an upload that succeeded but
   whose smoke failed. Inspect the actual deployment and reports before retrying.
4. Prefer roll-forward of only the failed project from the same verified commit:
   `netunim-kupa\deploy_site_fast.bat` or the Orders counterpart. Retain the fresh
   database check and smoke. Do not rerun database migrations just to retry static
   assets. Run the read-only smoke for both projects to confirm the final pair.
5. If roll-forward is unsuitable, use Cloudflare's previous deployment for only
   the affected project. Independently smoke it against a clean checkout of its
   exact previous verified commit. Do not compare a rollback to current source or
   reset, restore or delete browser/database business state. Reopen saved app tabs
   so their waiting workers can activate; recheck local and cloud status.

A smoke failure returns a nonzero code and stops the pair. Recovery remains an
explicit operator action; the scripts never guess which deployment to roll back.

## Evidence and remaining limits

The original worker reproduced mixed module bytes in both actual worker bodies.
The regression now covers wrong network release, offline retry, no matching cache,
failed install and waiting update. Native Chromium tests cover the same mixed
response/offline path, legacy update, restart and preserved Local V2 data. Actual
Windows BAT tests prove upload failure skips smoke and smoke failure blocks success.
Physical weak-PC, two-device and live Bank/Credit exercises remain the separate
release-authority backlog; synthetic results do not close them.
