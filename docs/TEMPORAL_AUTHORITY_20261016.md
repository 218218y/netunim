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
