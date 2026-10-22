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
