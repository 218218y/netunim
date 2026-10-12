# Main save, polling and recovery resource ownership

## Proven cutover defects

Before this change, Kupa cutover waited for `cloudSyncBusy`/`cloudWriteBusy`.
A save held in its initial cloud-state read or flight materialization had not
set either flag, so cutover returned while accepted work was still pending.
Two focused tests reproduced the early return before the refactor.

Orders cutover waited for saves and polling but omitted the private Morning
Main refresh promise. A held read in `refreshForMorningRecovery` demonstrated
the same early return; its completion is now included in quiescence.

## Owners

`shared/runtime-task-owner.js` tracks accepted work from command entry, including
preflight. Invocation remains synchronous so the existing emergency journal
submission does not move to a later microtask. Synchronous command validation
still throws synchronously; task results and rejected promises remain observable
by callers. `drain()` waits for completion and for
work accepted by a continuation of an earlier operation. It is not a durability
receipt and does not turn failure into success. `close()` rejects new work and
never aborts an accepted operation.

Kupa Main persistence privately owns its serialized file/cloud queue, joined
cloud-save promise and latest unsent cloud request. `runtime.drain()` covers
accepted fast saves before their next-turn work starts, ordinary saves,
explicit portable exports, loads and local recovery reads. `runtime.dispose()`
closes entry; accepted queue work can still finish. Existing coalescing, file
ordering, typed normalization operations and durability risk handling remain.

Both Main sync adapters privately own the scope-specific joined cloud promise.
Accepted requests are tracked before the first await. The scope/epoch guards,
immutable flight, retry policy, exact ACK publication and final-head checks are
unchanged. Old and new scope operations remain tracked independently; a former
scope cannot clear the new scope's promise.

The polling task owns its timer and now offers `drain()`. Only the boolean
`cloudPollingEnabled` observation reaches session state. Orders' 0ms follow-up
wakeup uses the existing debounce owner. Stopping invalidates its scheduling
epoch and cancels its pending wakeup; an older completed save cannot rearm it.
Recurring polling retains its existing 12–14 second cadence.

`shared/cloud-recovery-runtime.js` owns the automatic-open wakeup, attempt index
and accepted recovery work. Both apps retain their 15/30/60/120 second capped
backoff and existing opt-in, authenticated-owner, primary-tab and online policy.
The policy is rechecked at delivery. A cancelled delivered callback cannot
re-enter, and reset returns the next attempt to 15 seconds. The UI uses reset
on success/logout and schedule on the existing transient-error paths.

## Cutover and composition

Main quiescence stops polling and optional wakeups, asks the UI recovery owner
to cancel its queued task through a port, and awaits actual Main work. It no
longer polls busy flags in a 25ms loop or reads another subsystem's timer.
Started automatic opening can itself initiate ownership transfer, so this port
cancels queued recovery rather than awaiting the initiating recovery operation.
That operation retains the existing authenticated-owner and transfer fences.

Kupa's V2 coordinator validates and consumes the Main save runtime in addition
to the Checks runtime. Local engine preparation and source transfer stop Main
sync and drain both persistence owners before reading journal heads. Orders
continues to drain its existing Main/Checks save owners and now drains the
private Main writer and Morning refresh through sync quiescence.

The contexts no longer contain `saveQueue`, `cloudSavePromise`,
`storageV2CloudSavePromise`, `cloudPollTimer`, `cloudRecoveryTimer` or
`cloudRecoveryAttempt`. Architecture checks forbid their use through objects
and their reintroduction into contexts. The cloud UI exposes a recovery runtime
port; production code does not recreate retired context aliases.

## Verification and scope

Focused tests cover early cutover, held Morning refresh, fast-save entry,
accepted queue completion after closure, nested task acceptance, original
failures/results, recovery backoff and stale-callback cancellation. Strict
checkJs checks the actual owners and negative consumers; an implementation
mutation proves that closed state cannot become a formatted string.

A native browser scenario in both apps uses production composition, actual
local-to-account transfer, native timers and both real IDB journals. It holds
Main materialization, proves quiescence waits, finishes clean-head confirmation,
cancels a delivered recovery callback, compares exact raw journal records and
recovers the same retained note and check through fresh read-only owners.
The scenario is registered in the GitHub verification matrix.

No persisted formats, SQL migrations, RPC envelopes or live provider policy
changes. This does not finish the entire resource migration: startup service
promises, file backup resources, tab locks and credit resources remain, along
with broader controller decomposition, business boundary typing and Bridges.
