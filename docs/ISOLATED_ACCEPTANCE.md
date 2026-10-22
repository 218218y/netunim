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

Full Windows installers must run on a disposable Windows runner/profile, never
the working machine. Real provider acceptance requires an official sandbox;
two physical computers, a full local Supabase stack, global installer/autostart
and a live provider remain distinct from browser/SQL/staged-process tests.
