# Calendar durable read and synchronous publication

## Baseline and evidence

Baseline: main `4bbe4652d0718ba79cfaf1c8174b3e04355ff47e` (PR #112), containing
tested head `64c6dbecd4821c2b6026be0c605a9927ac29eed0`.
[Full branch verification](https://github.com/218218y/netunim/actions/runs/38104441006)
passed all 11 jobs and 1,881 Node tests; the main rerun is not required to reuse
that tested baseline.

The previous receipt observed only this JavaScript realm's generation. A native
Calendar queue read finished with no pending rows. Its completion was held while
a second tab committed a new event through the production queue adapter. The
consumer then returned `true` and advanced its completed-sync time from the old
receipt. The Node regression and `runtime_calendar_multitab_confirmation.py
--phase receipt` both failed before production changes. The event remained in
IDB: this is proof of stale success/lost immediate wake, not deletion/data loss.

The producer is a real separate tab/realm sharing the same origin/physical DB.
Its queue-port call is controlled fault injection, not a shipped bypass of the
secondary tab's UI mutation guard. Google/token responses are synthetic.

## Publication contract

`readPendingSnapshot()` remains available as an inspection receipt. It cannot
authorize success after its native transaction has finished merely because the
realm's in-memory generation has not changed.

`confirmPendingSnapshot(publish)` delegates to the checked implementation in
`calendar/queue-confirmation.js`. It opens a **fresh readonly queue transaction**,
reads the native pending rows and calls `publish` synchronously from the request's
success handler while the transaction is active. A conflicting write transaction
in another tab cannot commit between that read and publication. No network call,
timer or asynchronous callback is allowed inside publication.

The controller asserts original account/connection authority inside publication.
It combines the fresh durable rows with the same-realm live write fence. Pending
rows publish as pending and request the existing owner continuation; emptiness
can publish completed-sync time/toast. After transaction completion it rechecks
authority and the same-realm receipt before returning the accepted result. A
revoked completion cannot claim success for a new login.

This is a **point-in-time read proof**, not a Google ACK, a new persisted revision
or a guarantee that future writers cannot enqueue after publication. Only the
existing journal's verified provider result authorizes removal of an operation.
Read/query/abort/callback failures reject; they neither substitute an empty queue
nor remove any record. A failed confirmation clears continuation intent so it
does not start another automatic delivery; explicit recovery remains available.

No schema/version, queue bytes, event IDs, seq, attempt policy, Google endpoint,
409 reconciliation, Main/Shared/Finance, Journal/ACK, SQL or credentials change.
The extra read is intentionally small and uses the existing queue store; no
BroadcastChannel or cross-tab message is treated as durable evidence.

## Verification

- Node: another-realm append without a local generation change; native-reader
  event ordering; same-realm writes; query/abort errors; invalid result; rejected
  async consumer; current-account assertion; completion revocation/new work.
- Strict checkJs compiles the actual reader body and rejects async publication,
  cached boolean fences, unchecked queued JSON field access and boolean/promise
  confusion. Mutating the real implementation to return a string fails checking.
  Full Calendar storage/controller/journal business typing remains a later slice.
- `runtime_calendar_multitab_confirmation.py` runs two real tabs in four
  disposable profiles: Google-body await, cache commit, final receipt and native
  final-read transaction abort. It checks committed queue content/IDs before
  Google response, one synthetic effect, owned continuation or explicit recovery
  after abort, unchanged raw Main/Shared, cache/note recovery after reload.
- `--baseline` replaces only the controller in the disposable copy and must
  fail at `cross-tab commit was falsely reported as synchronized`; `--phase`
  selects a focused local case. All four profiles are in CI's browser-ui group.
- Existing offline, fixed-ID 409/replay, auth loss, immutable effect, recovery,
  PostgreSQL and Windows gates remain required before merge.

## Recovery, rollback and remaining scope

If the final read fails, the committed event stays queued. Restore storage/network
availability and refresh under the original Google account. Inspect the retained
error; do not clear the queue, assign a different ID or create a replacement event.
An older compatible site can be restored without a DB migration/reset. Reverting
this slice restores the old status race, but does not change readable data bytes.

Idle cross-tab notification/wake, cached-display privacy after logout, full
Calendar resource disposal and concurrent delivery-owner policy are separate
reviews. This slice closes the demonstrated **commit-before-publication** window
and retains existing visibility/poll/producer wake behavior. It does not certify
live Google, physical devices or global exactly-once PATCH effects from competing
consumers. Broader claims require separate controlled ownership/provider drills.
