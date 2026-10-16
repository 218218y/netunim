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
