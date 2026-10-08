# Kupa credit operation ownership and publication

## Evidence and scope

Baseline: main `543fee8287172befec330601fad97f43c9517b91`; full GitHub
verification `37821462358` passed. Thirteen controlled Node regressions failed
before the fix; the ordinary automatic-stop/drain case passed. The actual Kupa
composition reproduced a changed credit projection after production logout
while a local Bridge result was held. The browser used a disposable profile,
real IndexedDB/owner transfer and controlled finance/Bridge responses. This is
evidence of stale publication, not evidence of lost journal data.

Two additional regressions proved that authenticated requests in both apps
retried after the original login epoch changed during network backoff. The
existing bounded retry policy now checks the supplied scope before each send.

## Ownership contract

`createFinanceOperationScope` receives one access snapshot port. A captured
operation records the connection mode, durable storage owner, authenticated
account and login epoch. Its guard requires live write access and the same
snapshot. Account-owned storage requires matching authentication even if the
connection mode changes. Logout/relogin of the same account revokes the old
operation; ordinary token refresh preserves its login epoch.

Kupa credit receives this capture port from Finance composition. Root write
access includes primary leadership, an unlocked durable owner, completed
recovery and absence of startup/owner-transfer blocking. Online status and the
automatic enabled preference are deliberately separate: stopping automatic
work prevents new provider entry but lets an already received result finish
under valid ownership. This slice applies the publication guard to credit
refresh, structured provider failures, reset and card settings. It does not
claim that every Bank/Orders Finance controller is already covered.

## Candidate, commit and displayed data

1. A provider result is a candidate, not proof of cloud persistence.
2. Rebase, manual-lease waiting, lease renewal, finance reads, RPC sends and
   retries receive the captured guard. Lease fence epochs and RPC bodies retain
   their existing contracts. The guard callback is runtime-only, never serialized.
3. A successful finance receipt is checked before revision publication and
   before replacing the displayed credit projection. `saved:false` is a visible
   failure. Before confirmed cloud success the Last Known Good remains intact.
4. Local projection persistence follows cloud confirmation under the same
   operation. An already committed cloud write is not undone on later logout or
   local backup failure. A fresh authorized read can recover that cloud state.
5. Structured failure diagnostics follow the same publication contract; they
   cannot be attached to another account or silently delete good profile data.

No schema, SQL, journal ACK, merge, provider fallback, cooldown or retry budget
changes are part of this slice. Finance remains separate from Main and Shared
Checks journals. A failed finance candidate is not represented as a durable
offline queue; the operator sees failure and retries/reloads the authorized
finance document. Tests cover unchanged Last Known Good after failed publication
and stable transaction IDs after offline/lost-response recovery simulations.

## Resource and cleanup policy

Heartbeat callbacks observe scope before renewal and cannot execute after stop.
Queued manual edits observe their original scope before acquiring a lease.
After authorization loss a lease is left to its existing server TTL; renewal or
release must never use a newer login. Expected scope loss is already reported
by the operation and does not produce an orphan cleanup error. Other release
failures retain diagnostics. No cancellation aborts an IndexedDB commit.

## Verification

- `kupa_credit_operation_ownership.test.mjs`: manual/automatic owner change,
  logout, same-account relogin, leadership loss, late receipts, structured
  errors, failed/no-op publication, scheduler drain, queued edits, heartbeat
  ownership and transaction identity through recovery.
- `authenticated_request_scope_retry.test.mjs`: actual auth adapters in both
  apps with a controlled network backoff and same-account relogin.
- `runtime_credit_operation_ownership.py`: actual Kupa composition/auth,
  durable owner transfer, six controlled failure cases, unchanged journal/note
  identity and fresh-runtime recovery. Finance/provider I/O is injected; these
  are not live issuer or production Supabase experiments.
- Existing finance fences, cross-app freshness, automatic refresh, settings,
  Storage V2, real browser/PostgreSQL and two-computer suites remain full CI gates.

Live provider execution, a new Finance offline outbox and exhaustive remaining
controller resource ownership require separate evidence and changes.
