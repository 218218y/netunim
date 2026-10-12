# Primary tab lock resource ownership

Three before-change production regressions established the next resource-owner
boundary shared by Kupa and Orders:

- Reacquiring an already held Web Lock requested the same lock again with
  `ifAvailable`. Its denial demoted the application's own writer to permanent
  read-only while the original hold remained.
- Repeated fallback acquisition registered duplicate storage/pagehide listeners,
  channels and heartbeat intervals; overwriting the interval field left earlier
  registrations without an owner.
- The fallback reused a sessionStorage identity. Separate owners with the same
  inherited sessionStorage ID both accepted the existing lease as their own.

`shared/tab-lock.js` now privately owns acquisition, native hold release, fallback
identity, lease, settle/election deadlines, heartbeat, channels and listener
releases. Its one acquisition coalesces concurrent callers. Later calls read the
established authority and neither request another native lock nor restart the
fallback. An instance receives a fresh identity; an inherited historical session
ID is not authority. The old session ID key is no longer read or written, and is
left untouched as non-authoritative historical data.

`shared/browser-tab-lock-platform.js` isolates Web Locks, localStorage, native
events/channels, crypto identity and the clock. Construction registers no timer,
listener or channel. The actual owner and platform adapter are checked by strict
checkJs, including negative consumers and an implementation-mutation fixture.
Generated copies remain supplied by the canonical asset generator.

Disposal is final/idempotent. It marks the tab read-only, removes owned resources,
settles interrupted fallback/acquisition waits and releases its native hold. Late
grants and previously delivered callbacks cannot republish writer authority or
rewrite another owner's lease. Cleanup removes a fallback lease only if its
current ID belongs to the disposing instance. `pagehide` invokes the same cleanup.
`runtime.drain()` waits for acquisition/backend completion, including native lock
release; a live native hold is intentionally pending until disposal. This runtime
does not abort or drain application journal commands; those keep their existing
durability/owner contracts.

Both state contexts retain only primary/read-only/readiness observations. The
unused `primaryLockRelease` callback is removed. Orders tab-guard composition
also removes its two unused acquisition/toast collaborators; its retry behavior
still reloads the page.

## Preserved behavior and limits

Web Locks remain preferred; native denial does not authorize a fallback writer.
A native backend exception still enters the existing storage fallback. Lease
format/key, 1.5-second heartbeat, 5-second expiry, initial settle delay and bounded
election jitter are unchanged. Unavailable storage, corrupt leases and unavailable
channel construction fail closed. A denied or demoted tab stays read-only until
reload; `pagehide` disposal similarly requires reload if that document returns.

The localStorage fallback is not an atomic compare-and-swap protocol. This change
fixes the demonstrated inherited-identity and repeated-resource defects; it does
not claim Web-Locks-level exclusivity for every simultaneous storage election or
cross-computer ownership. Main/Shared fencing and recovery remain mandatory.
Physical multi-computer and live-provider drills remain separate rollout evidence.
Loaded old assets require refresh to participate in the new owner lifecycle.

## Validation

- Node regressions cover the three original failures, concurrent acquisition,
  late native grants, pagehide, replacement leases, stale callbacks, disposal,
  native denial/exception and unavailable/corrupt fallback infrastructure.
- `runtime_primary_tab_lock_ownership.py` exercises both production applications
  with native Web Locks, fallback localStorage/channels/listeners/timers and actual
  fresh/secondary tabs. It compares exact Main/Shared IDB records and recovers
  original note/check IDs and contents without changing those records.
- Strict implementation/negative-consumer checks and architecture guards reject
  string authority, context release callbacks and direct browser I/O in the owner.
- Full branch CI covers the wider browser, PostgreSQL, Windows, offline and
  multitab regressions before merge. No schema, RPC, provider or journal-format
  change is part of this stage.
