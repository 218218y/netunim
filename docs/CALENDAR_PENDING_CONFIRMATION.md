# Calendar pending confirmation and continuation

## Evidence

Baseline: `38b1b35d282d1f9e1dff2165d41d326238e61cf3` (PR #109).
[Full baseline verification](https://github.com/218218y/netunim/actions/runs/37929089602)
passed, with 1,842 Node tests and all required CI groups.

The new Node regression initially failed in three cases: a durable event arriving
during Google reads, during cache writes, and a missing continuation after that
append. Its clean-queue control passed. The native browser `--baseline` replay
uses the original controller in the disposable site copy and fails specifically
with `old snapshot falsely confirmed whole Calendar sync`. The new operation
was committed to real IndexedDB before that erroneous success.

This proves stale success, stale pending display and a lost immediate wakeup.
It does not prove deletion of the queued event: its stable ID/body remain stored.
The root cause was reading pending before network/cache awaits, then treating
a successful remote read as proof that the local queue was fully delivered.

## Confirmation contract

Google delivery, a remote read, local cache durability and an empty settled
outbox are separate facts. After delivery/read/cache completion the controller
reads a new pending snapshot. It can return `true`, show the completion toast
or advance the completed-sync time only if:

1. The original cloud/Google operation authority remains current.
2. The pending read is still current in this JavaScript realm.
3. No queue write is still settling and the durable snapshot is empty.

Pending events from a current receipt are included in the display projection;
their status uses the pending class even while the Google connection is valid.
A stale receipt cannot overwrite the more recent optimistic display. Cached
remote data still records its own fetch time, independently of completed sync.

`calendar/queue-observation.js` observes each queue write before its first
await and closes the observation again when it settles, including rejection.
An old read cannot become current again merely because the write finished.
Overlapping writes and repeated settlement cannot produce a negative count.
The observer is private to the Calendar IDB adapter module; all adapter instances
in this realm use that same physical queue and observation. It is neither an
ACK nor a persisted revision. No schema, operation bytes, sequence, event ID,
Google endpoint, Main/Shared data or migration changed.

## Continuation ownership

Known pending work after a successful delivery/read requests one coalesced
continuation once the current task finishes, including when the Calendar tab
is not the active view. The continuation rechecks the original operation,
connection and online state. The existing single-owner task handles coalescing.
New work cannot disappear by joining an already running Promise.

If a receipt became stale but all writes have settled, a fresh pass may inspect
that work. If a local write is still settling, the consumer returns `false`
without a wake loop: the existing producer wakes after its durable append and
pending overlay finish. Google/IDB failures and uncertain delivery responses
do not trigger this continuation; existing explicit refresh/poll retry behavior
and stable-ID replay verification remain in place. Revocation never launches
the old continuation under a new account.

## Verification and recovery

- Controlled-promise Node cases cover append at remote/cache/receipt awaits,
  clean success, immediate wake, authorization loss, unfinished local writes,
  queue-read failure and uncertain delivery without a new automatic retry.
- Observer tests cover before/after write completion and overlapping settlement.
  Strict checkJs checks the real observer body and negative consumers.
- `runtime_calendar_pending.py` runs actual composition/auth/API/controller,
  journal and native IndexedDB in five isolated profiles. It intercepts Google
  bodies or real IDB transaction completion for remote read, cache commit,
  stale queue read, unfinished local append and revoked authority.
  A separate adapter appends to the same physical queue in the read races;
  the staged-write case uses the actual Calendar editor save command.
- Each case blocks stale success, retains the pending ID/body until Google
  confirmation, creates one synthetic provider effect, checks unchanged raw
  Main/Shared records and recovers the same event/note after a fresh runtime.
- Full branch CI remains the merge gate; endpoints here are controlled rather
  than a certification of live Google/provider availability.

After a failed/uncertain request, retain the queue and refresh under its original
verified Google account. Never clear pending to make the status green or create
a replacement event ID. A confirmed remote read alone cannot acknowledge work.

## Limits and remaining work

The observer is in memory and does not claim to detect another tab's writes
after this transaction's snapshot. Each read still uses real durable IDB data;
cross-tab notification/privacy, complete resource disposal and local editor/
overlay publication ownership remain separate reviews. Main/Shared/Finance
protocols and provider retry/fallback policy are untouched. Failed uncommitted
editor intent is not a durable queued event; this change does not invent one.
