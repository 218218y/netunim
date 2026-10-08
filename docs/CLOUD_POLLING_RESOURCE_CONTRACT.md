# Main cloud polling resource ownership

## Reproduced defects

Four controlled tests failed on main `ca0427b2`, before the implementation change.
Both Orders and Kupa exhibited these two failures:

1. Starting polling while a previous timer's poll was awaiting a response created
   another timer. The previous cycle's `finally` could then schedule its own next
   timer. Clearing the most recently stored timer did not own both loops.
2. A Shared Checks read rejection in `cloudPoll`'s `finally` escaped the async
   timer callback. Native timers do not consume a returned promise. The next tick
   was scheduled, but the rejection had no background observer.

These tests prove scheduling/error-observation defects, not a data overwrite.

## Owner and public ports

The canonical `shared/runtime-polling.js` owns one recurring wakeup. Its six
collaborators are run, delay, error reporting, live scheduling eligibility,
state notification and timers. It exposes only `start` and `stop`.

The app's sync capability exposes its existing start command and an explicit
stop command. Cloud UI logout calls that stop port before clearing credentials.
Cutover calls stop and then awaits the existing poll/save promises. Session
timer/enabled fields are notifications from the owner, rather than a timer
which logout manages separately.

## Behavior contract

- Start is idempotent. While a cycle runs, only its completion owns the decision
  to schedule the next tick. There is at most one queued tick and one running
  scheduled cycle. Existing direct/reconnect calls still join `cloudPollPromise`.
- Stop invalidates queued callbacks, including one already delivered by the
  timer system. A callback from an earlier start cannot alter the new timer.
- Stop never aborts a cloud RPC, local journal commit or other operation already
  started. Restart during such work waits for its completion before scheduling
  another tick. No new epoch runs concurrently with that operation.
- Each tick and rearm consult current cutover eligibility. The actual cloud
  operation retains its live network/leadership/auth/owner/protocol gates.
- The existing 12–14 second cadence remains. Offline/secondary ticks perform no
  Main network read; reconnect can resume the same single loop. Preparation
  blocks and stops scheduling until explicitly started again.
- The background owner consumes and reports unexpected synchronous/asynchronous
  task failures with their original error. Direct poll callers still receive
  the rejection. This observer does not perform ACK, clear pending/control or
  introduce an outbox retry; domain retry/error policies remain with their owners.
- Quiescence awaits Shared/Finance finally work as part of the tracked poll. It
  cannot declare drain complete while this work remains pending or rearm after
  stop. Existing outbox retry cancellation remains in the cutover path.

## Verification and limits

The app regression suite uses held promises and controlled timers for repeat
start, error observation, stale callback delivery, stop/restart, quiescence,
offline/reconnect, leadership loss and preparation. It verifies record identity
and that polling failure leaves the journal head unchanged. Generic owner tests
cover sync/async failures, delay preservation and stop before task entry. Logout
tests require the owner to stop before authorization removal.

Focused status, ACK, hydration, recovery, owner-transfer and connectivity tests
must continue to pass. Full branch CI, including real Browser/IndexedDB,
PostgreSQL, two-tab/two-computer and Windows contracts, is required before merge.

This slice owns Main cloud's scheduled wakeup only. It does not replace Shared
Checks/Finance-specific polling, global runtime disposal, or all-domain status
aggregation. No persisted schema, SQL, ACK protocol, credentials policy or
application data migration changes are included.
