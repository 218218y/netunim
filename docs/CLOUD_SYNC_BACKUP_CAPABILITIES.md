# Cloud, Main sync and backup capability boundaries

This slice preserves persisted formats, journal operations, RPC envelopes,
conflict/retry policy, historical readers and backup contents. The intended
behavior changes fix Kupa sticky-note durability at owner transfer and stale
restore approvals in both applications.

## Proven Notes defect

`runtime_owner_transfer.py` edited the production Notes input and started
local-to-account transfer before the old 220ms debounce, without blur. Before
the fix, the uploaded and recovered note contained `durable local note` instead
of `exact unblurred transfer edit`. The failure reproduced with native
IndexedDB. After the fix, the exact edit survives transfer, the old timer's
delivery time and a fresh page load.

`domains/notes/commands.js` now owns sticky-note mutations. It submits typed
operations to existing persistence synchronously in the input turn; deferred
file/cloud effects remain in persistence. Its runtime tracks accepted saves,
drains completion, closes new commands on disposal and invalidates pending
delete confirmations on cancellation. Write guards capture the storage owner
and recheck it after confirmation. Kupa V2 source quiescence cancels Notes
preflight and joins accepted Notes saves before recovering the source journals.
Drain remains a completion barrier, not a successful durability receipt.

The command implementation is included in strict checkJs. Negative consumers
reject unchecked text/IDs and nonboolean authorization; implementation mutations
reject a fabricated synchronous drain and a numeric note body.

## Cloud UI

Both applications compose six explicit owners:

| Owner | Responsibility |
| --- | --- |
| `cloud-authentication.js` | Login presentation, password authentication and continuation |
| `cloud-opening.js` | Open/hydrate, pending recovery routing and secondary hydration order |
| `cloud-transfer.js` | Detached V2 transfer and verified target activation |
| `cloud-reset.js` | Read-only reset verification and destructive confirmation |
| `cloud-review.js` | Existing guarded recovery or discard action |
| `cloud-session.js` | Logout authorization, status and runtime cleanup |

`ui/cloud.js` composes these owners and one existing recovery runtime.
Login/reset continuations use callbacks constructed before startup; they do
not introduce circular imports. The root exposes the existing action API only.
Production composition supplies named Auth, View, Storage, Main, Secondary and
Recovery-review ports. Test-only adapters translate existing named stand-ins.

Top-level Cloud factory members decrease from 44 to 11 in Orders and from 41
to 8 in Kupa. These counts describe the public port groups and contexts, not
the total number of individual methods those groups contain.

## Main sync

`sync/write-flight.js` owns the immutable send and conflict rebase.
`sync/ack-publication.js` owns ACK validation, the atomic checkpoint/publication
step, post-ACK recovery and existing publication fences. `sync/confirmation.js`
owns the final authoritative read needed to assert synced. `sync/polling.js`
owns manual/scheduled single flight, the polling task and accepted-work drain.

`sync/document.js` retains save orchestration, retry/follow-up scheduling and
application-specific hydration/recovery. Its public action API is preserved.
Orders' Morning refresh joins the polling runtime instead of reading its private
promise. Main quiescence joins save, polling, recovery and follow-up obligations.
An old save cannot restart explicitly stopped polling.

Document source decreases from 34,732 to 17,225 bytes in Orders and from 43,481
to 23,255 in Kupa. At that stage the composition factory still forwarded 33/42
individual collaborators. The later [Main sync composition](MAIN_SYNC_COMPOSITION.md)
slice replaces those flat inputs with twelve runtime roles and ten root owners;
internal save/hydration coordination remains separate work.

## Backup

`backup-restore.js` owns durable import/restore and interrupted restore recovery.
`backup-local.js` owns local import/export commands. `backup-catalog.js` owns
catalog pagination, point selection and preview actions, invoking the restore
owner through its command port. `backup-presentation.js` owns pure diff labels
and rendering. `backup-download.js` isolates the existing platform download
effect. The root keeps the existing external actions; its top-level members
decrease from 39/31 to 10/10.

Existing file-picker/download resource lifetimes and broader restore/UI account
ownership remain separate work. This extraction does not assert a new lifecycle
proof for those effects.

Four before-change regressions showed that a stale restore approval continued
reading journal authority after account replacement or a later edit. The shared
strict `restore-review-scope.js` captures owner and visible generation before
confirmation. Restore checks that scope after confirmation/reads and before
publication. A stale review requests a fresh confirmation, preserving newer
data. The native regression compares both raw journals and recovers the exact
later note; removing the guards in its disposable site must make it fail.

## Verification

Existing tests execute the actual production factories after decomposition.
Static contracts inspect the explicit owner modules through
`tests/capability_sources.py`; all existing assertions remain active. The module
graph gate checks deployment reachability/cycles and the storage/sync import
direction. `tools/sync-assets.py` includes the new modules in the generated
offline application shells.

The focused suites cover native owner transfer/restart, Notes fencing/drain,
cloud hydration during leadership/account changes, polling lifetime/status,
flight rebase, exact ACK and post-ACK recovery. The full local gate additionally
uses PostgreSQL, native browser/IndexedDB and Windows. Live Bank/Credit sessions
and two physical computers are separate operator evidence.
