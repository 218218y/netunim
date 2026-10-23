# Isolated acceptance execution

The acceptance environment extends `BrowserSession` and `IsolatedPostgres`.
It accepts no production URL, account, backup or provider credential. Site copies,
browser profiles and downloads are disposable; only synthetic records are used.
Production site configuration, CSP and installed Bridges are not modified.

Before Chromium starts, preflight verifies temporary roots, download containment,
the exact substituted Supabase fixture and the owned ephemeral loopback listener.
A non-forwarding HTTP proxy denies every destination except that exact listener.
Chrome's implicit localhost bypass is explicitly removed, so installed services
on 8765/8766 are not reachable. QUIC and non-proxied WebRTC UDP are disabled.
The real-browser regression uses a disposable decoy, never an installed service,
to verify loopback/localhost/IPv6 and foreign-host denial plus allowed site access.
This is application/browser network isolation, not an OS or VM security sandbox.

PostgreSQL is initialized from empty files on a fresh loopback port and migrations
run against that instance. All inherited `PG*` settings are removed, including
`PGHOSTADDR` which can override the destination even with an explicit `-h`.
The explicit null-device `PGPASSFILE` also prevents reading a user's default
libpq password file, even though the isolated cluster uses trust authentication.
Before migrations, the live server must report the owned data directory, address
and port. No Docker or hosted Supabase project is required for these SQL/browser
tests. Supabase Auth, PostgREST, Storage and Realtime services are **NOT RUN**;
the fixture uses a synthetic authenticated SQL role and a local RPC relay.

Run the safety gate and isolated browser check:

```text
python tests/acceptance_safety_contracts.py
python tests/runtime_browser_isolation.py
```

Both are in the canonical CI inventory. Each runtime evidence report records the
source commit/tree, dirty status, harness hashes, platform and scenario outcomes.
Local reports are under `.work/acceptance`; CI reports are kept with each suite's
normal verification artifacts. A passing modified checkout is explicitly dirty
evidence, not a claim that a clean commit passed.

## Synchronization and recovery

`runtime_sync_postgres.py` retains all four Main/Shared lost-ACK cases. Its new
two-profile cases execute the production business normalization, validation,
three-way merge and journals in two independent Chromium processes, with real
HTTP requests relayed to the disposable PostgreSQL V6 RPCs. They exercise actual
offline transport, a hard process kill after remote commit/before ACK, immutable
retry, concurrent same-record field merges and a durable same-field conflict.
Evidence includes operation ledger rows/revisions, checkpoint checksums, journal
sequences, base checksums, state digests and another process restart. Main writes
must leave the separate Shared head unchanged; the financial record remains
unique. These tests do not claim two physical computers or full Supabase services.

`runtime_backup_browser_resources.py --phase roundtrip` creates synthetic Main
and Shared records, downloads the actual application's backup file into its
owned download directory, selects that file through Chromium's native file input
in a fresh profile, restores both journals, kills the process and verifies both
records after restart. No hand-built backup stands in for the exported file.
Existing malformed/stale/account-change/file-resource regressions remain active.

`runtime_restore_server_recovery.py` now kills the real browser after the
controlled remote-commit/read failure, retaining the native pending restore ID.
The remote service in this test is explicitly a controlled stub. Additional
native-IDB barriers stop paired restore at each durable `prepared`,
`shared-applied` and `main-applied` phase. A hard process kill follows the barrier;
fresh journals resume the production boundary and another process restart proves
idempotency and exactly one restored check. Barriers are test-only adapters;
the process termination and on-disk IndexedDB recovery are real.

Focused reproduction (the full suites are in the existing CI inventory):

```text
python tests/runtime_sync_postgres.py --two-profiles-only --app orders
python tests/runtime_sync_postgres.py --two-profiles-only --app kupa
python tests/runtime_backup_browser_resources.py --phase roundtrip
python tests/runtime_restore_server_recovery.py
```

Full Windows installers must run on a disposable Windows runner/profile, never
the working machine. Real provider acceptance requires an official sandbox;
two physical computers, a full local Supabase stack, global installer/autostart
and a live provider remain distinct from browser/SQL/staged-process tests.

## Windows, providers and performance

The existing required `Windows deployment contracts` CI job additionally runs:

- The real staged Bank HTTP/DPAPI vault, token revocation/restart and retained
  image test, plus native Bank/Credit provider compositions with inert scrapers
  and shutdown/drain tests. Every native service uses a fresh LOCALAPPDATA and
  ephemeral port. The provider modules cannot navigate or fetch real accounts.
- The existing browser isolation, native backup-file roundtrip, three paired
  restore process boundaries, actual Service Worker/offline/PWA upgrade and
  mixed-release fencing suites on Windows Chromium. The existing scheduler owns
  child-process cleanup and preserves suite logs/evidence as a CI artifact.

This extends the current runner and fixtures, not the deployed installers. The
existing real staged Document Bridge/private Node/C# preview test remains in that
same job. No global installation, scheduled-task registration or OS PWA install
is inferred from these results.

The first Windows expansion exposed a test-only CRLF mismatch in the mixed-release
assertion: Python's universal-newline read did not equal the cached HTTP bytes.
The fixture now preserves and compares exact module bytes on both platforms.
Cold PWA installation also exhausted a short single CDP socket wait; the harness
now polls native registration/controller state with a bounded installation
deadline and worker-error diagnostics. It does not retry or suppress an install
failure. Both complete PWA/legacy-worker and mixed-release suites passed locally
on Windows after these changes; exact-candidate CI remains required.

Financial mock coverage uses the existing `bank_balance_result`,
`bank_source_integrity`, `bank_snapshot_confirmation`, archive reconciliation,
provider/credit and ownership suites. Missing versus zero, partial/malformed
history, disappearing rows, unknown confirmation and cross-account evidence have
explicit assertions. The focused 85-test money/source/receipt/origin/native-vault
selection passed on Windows during preparation. No live provider credentials are
available or required. Official Bank/Credit sandbox integration remains NOT RUN.

Bank Origin policy is unchanged. The source inventory and actual HTTP tests in
`BRIDGE_THREAT_MODEL_20261022.md` still show that a valid stolen token can be used
from a foreign origin. Existing custom-domain/client migration and rollback
evidence is insufficient to change the default. This is an explicit unresolved
security/product decision, not a fixed vulnerability or permission bypass.

The existing loaded-data measurement now performs three independent IDB reloads
per app/size (1,000 and 10,000 synthetic records), retaining each sample and
median/min/max plus sample count. It distinguishes checkpoint, instrumented
startup, synchronous compute/DOM, search interaction, local durable edit and
post-GC JS heap. Local-only loaded tests do not measure cloud ACK or total process
memory. Three samples do not establish p95 or certify a physical weak computer;
no production optimization follows merely from these measurements.

The recorded 4x-CPU CI median for 10,000 Orders records included about 21.5 s
for delegated search, versus about 2.1 s at 1,000 records. These are slow
synthetic interactions, not a passing usability budget. The next performance
decision requires an unthrottled profile separating script, layout and paint;
physical target-machine acceptance remains open. The same measurement tool
accepts `NETUNIM_LOADED_CPU_RATE=1` (default remains 4), so an unthrottled control
needs no production code or alternative harness. Raw samples always retain the
actual selected CPU rate.

Earlier-schema acceptance is included in the existing native backup suite:
`python tests/runtime_backup_browser_resources.py --phase legacy`. Synthetic
Orders schema 3 and Kupa schema 5/state 3 fixtures omit later optional fields and
exercise old notes/card identity defaults plus a genuine zero check. The native
file pipeline imports both, survives a hard process restart and rejects future
versions and the other application's format with byte-identical journals.
These are supported-contract fixtures, not copied live historical backups or
proof of every historical exporter version.

The expanded Windows runs observed both post-crash and initial cold browsers
reach `interactive` without application errors but miss the Linux-oriented
10-second load deadline. Windows functional navigation has a 30-second deadline;
other platforms retain 10 seconds. A timeout records recent resource timings.
No storage operation or restore is retried to hide a failed result, and separate
startup/performance measurements retain their actual elapsed times and gates.

A further Windows run reproduced `taskkill /T /F` exiting 255 while terminating
the live browser tree. Windows browsers now reuse the existing `SuiteProcess`
gated Job Object owner: its child cannot start Chromium before job assignment,
and both hard termination and ordinary cleanup wait for the owned descendants
and handles. This replaces process-tree enumeration; it does not ignore a failed
kill or signal unrelated browsers. The same owner already covers suite cleanup
and its native process-resource stress contracts.

Restart auditing found the Windows host-preference helper replaced the private
profile's entire `Local State` on each launch. It now merges only its two host
preferences into the existing owned file, retaining profile selection,
encryption metadata and all other fields; malformed existing state fails closed
without replacement. Unit regressions prove preservation and that host-profile
metadata is never copied into the private profile.

A cold Windows run also exposed the seed initializer waiting on an unnecessary
unseeded blank Chromium process. The seed now writes exactly the same two OS
preferences directly from `NetUserGetInfo`, without launching a browser first.
No generated Chromium field was previously used by session seeding. Failed OS
metadata initialization still prevents every browser launch. The native Bank
HTTP fixture separately allows 30 seconds per Windows request and 120 seconds
for its multi-operation test: a cold DPAPI roundtrip on CI measured 12.4 seconds
against the old 10-second HTTP deadline. No operation is retried and these
functional deadlines do not certify production vault latency.

Actual DevTools ownership is now tied to the browser UUID written into that
profile's freshly created `DevToolsActivePort` file. Chromium allocates its own
port, and the HTTP version endpoint must match that UUID before selecting a page.
This removes the ambiguity of a guessed port on separate IPv4/IPv6 listeners.
The real-browser isolation case now restarts A normally and then forcibly while
B remains live, verifying LocalStorage, IndexedDB and CacheStorage persistence
and B's independence. Its LocalStorage baseline is flushed by the first normal
shutdown; this does not claim crash durability for an unflushed LocalStorage
write. The journal commit/kill tests retain their separate durable assertions.
If `Browser.close` closes its socket before acknowledging, the harness still
waits for process exit before forcing termination, allowing the accepted shutdown
to flush its profile. Missing restore-journal failures retain database/namespace
diagnostics; no test creates a replacement journal to manufacture recovery.
Normal process restarts must now prove a graceful exit: they wait up to 30s,
then fail if forced cleanup was needed instead of calling that a normal restart.
On Windows they also require the entire Job Object to become empty naturally;
root-process exit alone cannot authorize terminating a storage utility process
that is still flushing. A native regression keeps a child alive after parent
exit, verifies the wait fails without killing it, then lets it flush and exit.
The paired restore fixture establishes a cleanly flushed LocalStorage canary
before injection, checks it before opening any fixture DB after both restarts,
and requires the original DB to still be listed. Chromium uses the explicit
owned `Default` subprofile throughout. Large-heap diagnostic GC has its own 30s
transport deadline and recorded elapsed time, rather than the generic 5s socket
timeout; application interaction timings and failure assertions are unchanged.
The `Page.navigate` command uses that navigation deadline too, so a default 5s
socket cannot abort before the loading wait starts. Cold DevTools publication
still has a 30s bound; UUID verification and first page enumeration share a 60s
overall startup bound. Legacy-worker upgrade observes native installing/waiting
state for up to 60s instead of a fixed 15s loop, fails immediately on install
errors or premature controller replacement, and requests the update only once.
Offline PWA process restart reuses the same verified graceful tree shutdown;
offline transport is configured before navigating the new process.

### Remaining full-install execution protocol

Status is NOT RUN until all evidence below exists. Use a snapshot-backed disposable
Windows VM with a newly created OS account and no NETUNIM installation. Record the
tested SHA and hashes of both installer packages; never copy working account
profiles, configuration, secrets or backups into it.

1. Prove 8765/8766 have no listeners and neither NETUNIM directory/startup launcher
   nor the PDF maintenance task exists. If any exists, discard/recreate the VM.
2. Install reviewed Everything/ES in that VM, disable all automatic volume
   inclusion and configure only a newly generated fixture directory. Enumerate
   every indexed path and reject any path outside that directory. The isolated
   native research helper can verify its own named fixture index separately:
   `python tools/probe-everything-isolated.py --everything-exe <reviewed-exe> --es-exe <reviewed-es> --parity --resources`.
   Its success does not prove the installer's selected index is equally scoped.
3. Run the unchanged `netunim-orders/document-bridge/install_document_bridge.bat`
   and `netunim-kupa/bank-bridge/install_bank_bridge.bat` interactively inside the
   VM. Configure the Document roots/index only to those fixtures. Do not configure
   a financial login. Capture exit codes, actual runtime paths, versions (Document
   45, Bank 74), token fingerprints, Startup targets and maintenance-task action.
4. Reboot/log on; verify exactly one owned listener per Bridge. Stage the supported
   historical package on a separate VM snapshot, repeat the upgrade and rollback,
   and compare fingerprints, synthetic vault/settings/data and the selected index.
   The existing historical native replacement probe alone is not this install.
5. Install the isolated site as an OS PWA and repeat the old-tab/update/offline
   workflow. Record browser/private-network permission behavior and client refusal
   of an incompatible Bridge. Use the test site's loopback backend only.
6. Interrupt only the VM's owned processes at the recorded boundaries, repeat
   startup/shutdown, then verify no owned Everything/browser/helper survives and
   no file outside the enumerated installation/fixture/OS startup locations was
   changed. Export redacted evidence, then discard the VM snapshot.

Two physical computers, a full Supabase service stack and official provider
sandboxes retain their separate NOT RUN entries even if this VM protocol passes.
# Full Supabase service acceptance (October 23 follow-up)

`Full Supabase acceptance` is an additional required job in `verify.yml` and the
exact-commit deployment gate. Run `python tests/runtime_supabase_stack.py` only
on a disposable GitHub-hosted Linux runner with Docker and the pinned Supabase
CLI 2.121.0. A workstation or self-hosted runner is rejected before allocation.
The ordinary PostgreSQL/browser suites remain independently required.

The harness starts a fresh, unlinked platform without application migrations,
attests actual Docker labels, internal network, published loopback ports, mounts
and volumes, and challenges the owned database before applying the original
application migration files byte for byte. It removes inherited cloud, database,
Docker, SMTP and provider credentials and uses a private CLI home. No production
project, backup, account, browser profile or installed Bridge is read or used.
Only the test copy's Supabase configuration and CSP connect-src are changed.
Its fresh HTTPS certificate is trusted by its SPKI in owned Chromium processes;
global certificate validation remains enabled. The browser deny proxy still
blocks every destination except the owned site and API ports. API redirects are
rejected. Docker image pulls occur on the host; service containers have no
external network route. This remains application/container isolation, not an OS
sandbox or proof of zero host-level network traffic.

Coverage uses real GoTrue, PostgREST, RPC, RLS, Storage and pg_cron. Two private
Chromium profiles import the production Auth/journal/merge modules, authenticate,
persist sessions, rotate tokens, recover after process restarts, and retry an
immutable operation after an actual HTTP response is withheld following commit.
Offline and HTTP-503 failures are explicitly injected transport faults. Foreign
users are probed directly through the API, including Storage read/list/upload/
delete attempts. Paired restore is staged/applied through the real HTTP RPCs and
retried after restart. This component integration does not claim full UI end-to-
end coverage; existing native UI backup/recovery suites remain required.

Real retention job definitions are compared with `supabase/retention-jobs.json`.
Separate owned, one-second cron jobs execute those exact original commands and
must produce successful `cron.job_run_details` plus the expected deletion of old
synthetic rows and preservation of recent rows. Catalog stubs do not satisfy it.
Supabase Realtime is not used by the application (its tab channel is the browser
BroadcastChannel), so it is disabled and explicitly not claimed as tested.

`full-supabase-acceptance/full-supabase-stack.json` records the exact Git source,
migration hashes, service versions, owner-scoped operation receipts, durable
restart snapshots and isolation evidence. Generated keys, passwords, JWTs,
private CLI state, certificate private keys and raw Docker environment dumps
are never artifacts. PASS is written only after owned resources are removed.
Until this exact source passes the real required job, this route is NOT RUN,
regardless of passing local safety contracts.
