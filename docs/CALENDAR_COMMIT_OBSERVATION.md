# Calendar committed peer work and display observation

## Evidence and scope

Baseline `667f9dfd499746c25c3224bb2107fbe2744399bb` already serializes
delivery through the origin-wide Web Lock and confirms pending rows inside a
fresh native read transaction. Those contracts remain in place.

The uncovered case was an idle consumer: tab B saved an event through the
production offline editor, while authenticated tab A remained in the background
with polling/visibility delivery inactive. A's real IndexedDB queue contained the
exact event ID/body/seq, but its visible pending list was empty and its status
remained green. This reproduces a display/wakeup defect, not data loss.
The Node regression and native `--phase peer --baseline` drill fail before the
fix. The baseline option replaces three files in the disposable test site; no
user profile, live Google account or production database is involved.

## Ownership and evidence

`calendar/storage.js` invokes an optional `onLocalCommit` port **after native
transaction completion** for queue and range-cache writes. Failed/aborted writes
do not emit it. A notification failure is reported separately and cannot turn an
already committed operation into a rejected save. No stored counters, schema,
event IDs, queue rows, Main journal or Shared Checks records are changed by hints.

`platform/calendar-commit-notifications.js` carries only a fixed type/version
over an origin-local BroadcastChannel, and also notifies its local subscribers.
It sends no event, account, credential, document or business payload. The first
subscription owns a lazy channel; the last removal closes it. A durable write
that drains after consumer disposal may send a hint using a temporary channel
that closes immediately. Unsupported/blocked/failed notification transport is
optional: existing explicit refresh, visibility and polling remain available.

`calendar/commit-observer.js` owns one read task and coalesces hints into one
trailing pass. A hint arriving during promise settlement also gets a new pass.
Only an authenticated, verified Calendar scope can start a read. The controller
rereads the attributed cache and pending queue, then publishes synchronously
inside **another fresh native queue transaction**. It checks current app/Google
login authority, verified account and display range before publishing.
Logout/dispose fences the old read and stops new reads without cancelling a
native write already in progress.

This owner performs **no Google delivery or automatic retry**. It does not clear
a delivery error, advance `lastSyncAt`, acknowledge a remote effect, or remove an
operation. Delivery remains owned by the existing journal/lock/scheduler. Range
cache commit hints also let a peer observe a delivered event's updated cache.
The hint is an optimization; the durable read is the source of local evidence.

## Failure and recovery

A native read failure keeps the last known display and queue, and shows an
independent observation warning. It does not quietly leave a green status or
begin a retry loop. A later real commit hint or successful manual synchronization
can clear that warning after a fresh read. An unowned/unattributed cache is not
published as the verified account's display. An obsolete read cannot report a
warning or republish data under a new login.

Restore storage availability and refresh under the original account. Do not
clear pending rows or create a replacement event to repair display uncertainty.
An uncertain provider delivery still requires existing stable-ID reconciliation
or manual recovery; a local notification is no provider receipt.

## Verification and limits

- Node production-controller regression: peer work becomes visible, with no
  provider call or new remote confirmation time.
- Observer/transport contracts: held read plus 1,000 hints, settlement-window
  wake, logout/dispose, read error without automatic retry, unverified account,
  malformed signals, unsupported/throwing transport, 1,000 resource cycles and
  notification of a drained write after its subscriber has gone away.
- Strict checkJs compiles the actual observer/transport bodies and negative
  consumers. This does not typecheck the full controller/storage/journal.
- Native two-tab production UI: peer save, transaction abort, logout/dispose
  while a completed display read awaits publication, failed notification after
  commit, aborted write with no hint, exact row recovery in a fresh runtime,
  unchanged raw Main/Shared stores and no provider retry. Google is synthetic.
- Full CI retains Calendar delivery/replay, privacy, offline/PWA, PostgreSQL and
  Windows suites. Physical devices/live providers remain separate operational
  drills; no global exactly-once guarantee is asserted here.

Rollback deploys previous compatible assets. No data migration/reset is needed;
queues and caches remain readable. Old tabs do not emit/listen for the new hint,
so refresh them during rollout. Without hints, existing explicit refresh,
visibility and polling still applies, with the prior idle display delay.
