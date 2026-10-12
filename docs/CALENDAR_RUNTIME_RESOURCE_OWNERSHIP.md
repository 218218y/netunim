# Calendar operation and browser resource ownership

The continuation audit proved three failures before changing production code:

- Both manual connection and refresh under a new login waited for an old login's
  held remembered-token response because they joined a promise in the context.
- A delivered callback from a cancelled single-day click opened the superseded
  day's editor. The callback checked account/range authority, but not its task.
- Disposing the Calendar composition before controller creation returned false
  and still permitted the controller to be composed and started later.

`calendar/operation-flight.js` owns scoped sync and remembered-reconnect flights.
Only a current authority can coalesce. An obsolete flight may be replaced, while
its accepted work remains tracked for drainage. A former completion cannot clear
the newer task or busy flag. Releasing the current pointer before scheduling a
known pending-work continuation preserves the existing trailing-pass behavior.
Scoped settlement also runs when revocation skips a queued operation's body, so
its current busy observation cannot remain orphaned after login replacement.
Failed or uncertain delivery still does not authorize an automatic retry.

The controller's action owner tracks async commands from entry, including local
editor appends, confirmation/read awaits, renders, startup wakeups and known
sync continuations. Synchronous view/editor commands reject after disposal.
`runtime.dispose()` is final and idempotent; `runtime.drain()` observes accepted
actions, former/current flights, committed-work reads and started scheduled work.
Disposal revokes publication and new work, without aborting an already accepted
native Calendar queue transaction or deleting its event.

`platform/calendar-browser-effects.js` owns the background interval/listeners,
reconnect deadline, single-day task and animation frames. Construction is inert.
It reuses the existing checked debounce owner so cancellation/replacement fences
previously delivered callbacks. Account invalidation cancels only its queued
effects. Disposal removes owned resources; partial browser-registration failure
cleans earlier registrations and closes the control runtime. Existing 320ms
day-click delay, poll cadence/visibility rules and backend recovery delays remain.

The composition owns disposal even before controller creation and exposes drain
after composition. Contexts retain credential/status/read-model observations;
`syncPromise`, `authResumePromise` and `pollTimer` are removed. Status and gestures
consult the current private flight rather than a stale promise. Existing tests
join the public sync command and use explicit runtime status/drain instead of
reading resource handles or stopping an interval through state.

## Validation and retained contracts

- Four original regressions fail before the fix; focused Node tests also cover
  current/obsolete flights, old finally vs new owner, trailing passes, disposal,
  accepted drainage, inert browser construction and complete/partial cleanup.
  Existing queue confirmation, account scope and local controller tests remain.
- Strict checkJs checks the actual flight/effects implementations and negative
  consumers. Mutation fixtures reject replacing asynchronous completion or
  boolean connectivity evidence with presentation text.
- `runtime_calendar_resource_ownership.py` uses actual composition, auth, native
  timers, DOM and IndexedDB with controlled provider responses. It completes a
  new-login connection before releasing the old token body, replays cancelled
  day callbacks, and holds a native append completion after commit. Drain waits;
  exact pending event ID/body/sequence survives disposal and a fresh adapter.
  Exact Main/Shared IDB records and original note/check recovery are unchanged.
- Architecture guards prohibit Calendar context resources and direct scheduling
  or connectivity access in its controller. The canonical static contracts now
  protect the owner/port boundary, rather than require resources inside contexts.
  Full branch CI is required for PostgreSQL, Windows and all browser gates.

Calendar's account/login/connection fences, native exclusive delivery owner,
pending snapshot confirmation, event IDs, 409 verification, unknown-outcome
recovery and provider policy remain unchanged. No schema, persisted format, RPC
or historical preference reader is changed. Controller presentation, OAuth URL
handling and business projection still need later responsibility decomposition;
this stage does not claim full controller strict typing or live Google/provider
and physical two-computer validation.

The native cross-tab receipt fixture now gates the actual delivery receipt API
after its durable read. Required CI exposed an ambiguous queue-only transaction
selector: a background confirmer could win it while delivery completed before
the other tab's write. Forcing that background ordering reproduced the false
failure, and selecting the receipt port removes the ambiguity. The four native
events/cache/receipt/receipt-abort scenarios keep their original assertions,
including one Google effect, exact event ID/body, completed-queue confirmation,
fresh recovery and unchanged Main/Shared records. Calendar production logic is
unchanged by this fixture correction.
