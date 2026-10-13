# Finance lease renewal ownership

The baseline is `b6ee3fd3a9bc6e2a91be72bd4aeafea1ed781715` (PR #160).
Before this change, one held renewal caused all four production Bank/Credit
controller fixtures to release their lease before the renewal settled. The
actual HTTP transport fixture reproduced `release -> renewal`; SQL explicitly
permits a released token to acquire another epoch. This is an ordering defect,
not evidence of corrupted document data.

## Current owner

`shared/finance-lease-heartbeat.js` owns its captured resource/token/epoch,
synchronous account authority, one timeout and one accepted renewal. A stopped
or stale queued callback cannot create another scheduling chain. Remote grants
require confirmed lease identity; explicit local grants allocate no timers or
remote requests. Both applications use deterministic generated copies.

`stop()` closes future scheduling synchronously and returns an idempotent
`Promise<void>` that joins the accepted renewal. All four controller cleanup
paths await it before releasing the lease and clearing their busy state. A
failed renewal remains a publication failure, while its drained cleanup does
not fabricate a receipt or mask the controller's existing result. Kupa Credit
uses account authority for cleanup separately from publication fence validity:
a failed heartbeat prevents publication but still permits own-account release.
Account handoff/disposal still prohibits releasing through a new login; the
former-account server lease expires under the existing TTL policy.

Renewal retains TTL 1200 seconds and wakeup at TTL/3. It cannot adopt a different
resource, token or epoch. Existing transport retry policy, SQL/RPC formats,
provider/fallback policy, document publication and journal ACK rules remain.
The obsolete heartbeat export from `finance-fence.js` is removed; active
scope/manual-queue/fence-payload APIs remain. No forwarding facade is retained.

Kupa Finance read/poll failure reporting rechecks captured account authority
before reporting a network error. Both automatic Credit preflights now pass
that authority to the cloud owner; a late ordinary error cannot expose former
account details or be misclassified as a current-account network failure.

## Evidence

- Five before-change ordering failures: actual lease HTTP boundary and all four
  production controllers. Two preflight privacy failures and a separate Credit
  own-account cleanup failure were reproduced before their corrections.
- Focused regressions cover held/failed renewals, duplicate/stale callbacks,
  local grants, scope handoff, invalid identity and idempotent asynchronous stop.
  Older model fixtures now supply complete grants with the requested resource,
  token and server epoch; incomplete-grant rejection stays enforced.
- Native browser lease confirmation includes a held renewal for Bank/Credit in
  both apps, with production composition, actual HTTP decoders and real IDB.
  The failed provider makes no publication; prior projection, Main/Shared
  journals and durable note identity survive cleanup and reload.
- PostgreSQL fixture characterizes release followed by a late same-token claim
  against the existing deployed fence semantics; no migration is modified.
- Strict checkJs covers the actual heartbeat body and both generated consumers;
  negative fixtures reject async authority, unknown grants, wrong identities,
  serialized epochs and synthetic cleanup ACKs. A mutation replacing the real
  stop contract with `true` fails checking in the implementation itself.

Full GitHub push and PR verification remain the merge gate. This slice does not
typecheck entire Finance controllers/lease adapters, prove live provider
behavior or retire historical persisted-data readers. See the
[remaining work inventory](ARCHITECTURE_REMAINING_WORK.md).
