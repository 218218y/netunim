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
2. Upload Orders. After all pre-upload gates pass, its shared engine uses Wrangler's
   exit code as the upload result. It does not fetch the public site from the
   deployment workstation. Use the permanent public domains for the application
   checks below; generated Cloudflare deployment URLs are blocked by NetFree.
3. Upload Kupa only after the Orders upload succeeds. The normal, fast, paired and
   individual entrypoints all use this shared behavior. A failed upload still
   returns a nonzero code and stops the pair. If Kupa's upload fails after Orders
   succeeds, inspect the actual deployments before retrying the failed project.
4. Prefer roll-forward of only the failed project from the same verified commit:
   `netunim-kupa\deploy_site_fast.bat` or the Orders counterpart. Retain the fresh
   database check. Do not rerun database migrations just to retry static assets.
   Check both applications through their permanent public domains.
5. If roll-forward is unsuitable, use Cloudflare's previous deployment for only
   the affected project. Check its login and representative workflows against its
   exact previous verified release. Do not compare a rollback to current source or
   reset, restore or delete browser/database business state. Reopen saved app tabs
   so their waiting workers can activate; recheck local and cloud status.

Recovery remains an explicit operator action; the scripts never guess which
deployment to roll back.

## Published application checks

Deployment success means Wrangler accepted the upload. It does not prove that the
production URL serves the expected release. Use the permanent public domains:

- Orders: https://orders.bargig-furniture.com/
- Kupa: https://kupa.bargig-furniture.com/

Check authorized login, a representative workflow, offline reload and installed-PWA
startup. Save and close existing app tabs before reopening them to activate waiting
workers. These operational checks do not run inside the upload scripts.

The old public byte-comparison tool was removed after testing these domains:
NetFree and Cloudflare inject scripts into HTML, so the delivered page differs
from the uploaded source. Some identical assets also returned stale or missing
release headers through the public delivery path. Changing only the hostname
would still reject successful uploads. The repository/security/database gates and
the service worker's release protections remain in place.

## Evidence and remaining limits

The original worker reproduced mixed module bytes in both actual worker bodies.
The regression now covers wrong network release, offline retry, no matching cache,
failed install and waiting update. Native Chromium tests cover the same mixed
response/offline path, legacy update, restart and preserved Local V2 data. Actual
Windows BAT tests prove both uploads can complete without public access, display
the permanent domains, and still stop the pair on upload failure.
Physical weak-PC, two-device and live Bank/Credit exercises remain the separate
release-authority backlog; synthetic results do not close them.
