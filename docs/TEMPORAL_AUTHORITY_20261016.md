# Temporal authority continuation, 2026-10-16

The four code stages are Bank observation admission, Credit observation and
freshness, bounded automatic cooldown, and a focused authority/release audit.
Each branch runs the full workflow before merging; local checks stay focused.
Physical hardware and provider logins remain explicit operator evidence.

## Bank observation admission

`readBankBalanceResult` admits only real, zoned ISO observation timestamps at most
five minutes ahead of the receiving clock. Omitted timestamps retain the older
balance-only response behavior; supplied null, malformed and future timestamps
reject the entire result before reconciliation or publication in either app.

The new immutable migration `20261016140000_bank_snapshot_temporal_authority`
guards the v6 RPC with the server clock before business mutation. Lease fencing,
transaction evidence, stale ordering and operation context remain in place.
Null and both PostgreSQL infinities reject as `invalid_bank_snapshot_time`.
This prevents new poisoning; it does not silently rewrite historical observations.

The disposable PostgreSQL regression saves T1, rejects future/infinite/null
complete and partial writes with byte-equivalent archive, presence, snapshot and
Finance state, then applies T2 and verifies absence reconciliation. Small clock
skew remains supported. The candidate chain runs this regression on clean install.

One shared checked observation-time module adds one eager module per app. Measured
startup source is 1,740,976 bytes / 299 modules in Kupa and 2,360,426 / 399 in Orders.
Existing byte ceilings remain unchanged; module ceilings explicitly increase by one.

## Credit observation and freshness

The current response reader validates envelope/profile `syncedAt`, profile
`attemptedAt`, month `fetchedAt`, and frame/pending fetch clocks using the same
five-minute tolerance. Null/omitted observations remain absent evidence for
supported older responses and unavailable components. Future billing dates and
intentional retry deadlines keep their separate meaning.

Both Bank/Credit automatic freshness and Credit smart forecast selection reject
invalid/future persisted observations as due. A valid clock on a second client
can therefore recover a poisoned older feed without deleting financial history.
The current network reader and historical persisted readers remain separate.
No server publication clock is invented: Finance commit time is not yet a
dedicated per-provider successful-observation clock and cannot safely replace it.

Tests cover every admitted observation position, exact skew boundaries, both
actual merge models, and future/malformed replies in both native refresh owners
with unchanged readout/journals and zero Finance publication. No eager modules
or byte ceilings are added in this stage.

## Bounded automatic cooldown

The reviewed maximum is 24 hours from the original failure, matching one daily
Credit refresh cycle and the existing 403/429 fallback. A shorter provider delay
is respected. Re-reading a stored failure never moves its deadline. Missing,
malformed or unreasonably future failure clocks grant no cooldown authority.
Camoufox-only 403 suppression stays engine-scoped; 429 remains issuer-wide.

`providerRetryAfterAt` retains the issuer's original parsed deadline for diagnostics;
`retryAfterAt` is the effective automatic deadline. Provider aggregation, sanitized
diagnostics, both retained-feed readers and Bridge deferral use this distinction.
Rejected effective deadlines are explicitly cleared rather than retaining the raw
date through an object spread. A component cannot choose its own reference clock.

All four issuer HTTP paths now use the same Retry-After parser. Numeric values
outside the JavaScript Date range return unavailable evidence instead of throwing.
The shared ISO primitives are generated into the installed Bridge; the installer
stages both transitive helpers. Original historical algorithm digests stay intact;
test adapters reverse only the explicitly tested policy/diagnostic deltas.

The new checked cooldown policy adds one eager module per app (300 / 400). Measured
source is 1,743,450 / 2,362,898 bytes, within unchanged ceilings. Expanding the
touched diagnostic objects lowers the readability count from 491 to 487 lines
above 500 characters and from 116 to 114 above 1000; only those entries tighten.

## Focused scheduling and release audit

The audit found additional concrete authority: Kupa Credit `autoDelay` and Orders
Finance `autoWait` computed wakeups directly from `syncedAt` despite a conservative
due policy. Both now use the checked shared observation delay. Their actual timers
schedule prompt bounded wakeups for poisoned observations instead of forwarding
year-scale delays to browser timers. Computer-local Bank/Credit attempt clocks
also ignore observations more than five minutes ahead after clock correction;
malformed preference failure handling and persisted diagnostic evidence remain.

| Decision | Authority after this continuation |
| --- | --- |
| Bank archive ordering/presence | Server clock admission plus existing lease/epoch/operation fence and transactional ordering |
| Bank/Credit automatic freshness and wakeup | Shared observation admission, including retained cross-client state; actual timers tested |
| Smart forecast coverage | Valid non-future month observation plus existing status, coverage and weekly age |
| Provider retry | Intentional deadline bounded by original valid failure; provider date kept separately |
| Computer-local attempt cooldown | Valid epoch milliseconds, bounded future skew, no deletion or new automatic permission |
| Pending billing projection | Existing local calendar-day policy requires nonnegative day age; current wire observations are validated separately from intentional day-based projections |
| Future billing/transaction dates | Intentional financial schedule, outside observation validation |
| Lease expiry and publication | Server-owned fence/token/epoch and document revisions remain authoritative; no client observation is promoted to a commit clock |

Six actual JavaScript guard removals prove the observation/freshness/cooldown bugs
return. The PostgreSQL candidate also removes the installed temporal guard, reruns
the durable regression expecting failure, reinstalls the original function and
reruns successfully. These complement the native zero-publication regressions.

The read-only Production query recorded at `2026-10-16T13:57:20.542713Z` found
zero future Bank snapshots and zero future presence rows. The new migration and
guard were not installed. This aggregate result is not a full postflight or a
live provider/physical release pass. The new migration is explicitly required
before static rollout, alongside complete SQL hash and schema verification.
No Production DDL, provider login, site deployment or destructive device test
was performed. The physical/live matrix remains the release operator's next step.

Final startup measurement: Kupa 300 modules / 1,744,570 normalized source bytes;
Orders 400 / 2,364,031. Both retain the existing byte ceilings. The earlier Bank
sample above records the initial admission implementation before final caller wiring.
