# Main cloud ACK and local publication

## Scope and owners

This contract describes the current Kupa/Orders Main Storage V2 path.
The journal owns local durability, sequence, writer and epoch fencing. Each app's
sync owner owns its immutable RPC flight, business merge and error policy. The
browser storage adapter owns the ACK/checkpoint transaction and its post-commit
cache. The canonical `cloud-checkpoint-publication.js` boundary commits before
publishing, with an app-supplied test of the current local head.

Shared Checks has its own journal and sync owner. It already commits a merged
checkpoint before reading/publishing the recovered head. Main cannot ACK Shared
work. Finance readouts and Shared checks retain their separate owners when a
Main cloud result is composed for display.

## Invariants

1. Local sequence advances through typed journal operations. A mutation's
   synchronous emergency copy is verified when available; IndexedDB completion
   is a separate durability event. Existing quota/unload guards still apply.
2. A flight fixes operation ID, base revision, sequence range, snapshot and delete
   intents. Transport uncertainty never rotates that ID or changes its payload.
3. ACK advances `ackSeq` only to that flight's `endSeq`. Newer local sequence and
   generations remain pending. ACK revision is a validated current cloud head;
   `operation_revision` may describe an earlier commit replayed at a newer head.
4. A valid Main no-op success need not bump revision. The existing response
   validator and database transaction remain responsible for revision validity.
5. ACK and the reconciled current checkpoint commit atomically with owner, epoch,
   writer and expected-sequence checks. A failed transaction retains the old base,
   flight and journal. It cannot authorize a visible model or session cursor update.
6. Prepare a candidate without modifying the visible model. Commit it, then
   publish only while the live account/login epoch, storage owner/epoch,
   leadership, local generation and returned sequence still
   match the captured head. Live Shared/Finance data retains its composition owner.
7. If an edit arrives during ACK commit, the confirmed flight remains ACKed but
   its earlier candidate cannot overwrite that edit. Persist a `concurrent-ack`
   conflict control, keep the newer journal work pending, and stop subsequent
   sends for explicit review. This follows the existing concurrent-rebase safety
   policy. A fresh runtime respects the control; it does not silently retry it.
8. If leadership was lost after commit, keep the committed receipt but do not
   publish, write a control from the secondary tab, or send another flight.
   The next primary recovers its own durable head and writer fence.
9. Post-ACK cache verification or optional local-backup failure cannot turn an
   already committed ACK into another cloud write. The adapter retains its exact
   receipt-derived cache when a verification read is unavailable.
10. A model-publication exception is a post-commit failure, not a failed ACK.
    Preserve/report its original cause and committed receipt. Only the same live
    identity may persist an `ack-publication-failed` control and stop further sends. An optional render
    exception after the model was published is reported without replaying the ACK.
11. An HTTP-success Main response must contain its authoritative object document.
    `readDocumentWriteAck` owns this envelope and the existing revision/no-op/replay
    decision. Never replace absent/null/scalar/array state with the sent snapshot:
    an operation replay returns the current cloud head, which may include another
    computer's later write. The returned receipt is not a durable ACK; the same
    fenced transaction, generation checks and publication sequence still apply.

## Candidate sequence is part of the ACK input

Both Main sync owners capture `expectedSeq` from the durable head used for
reconciliation. It travels with `currentState` in **every** ACK, including a
post-RPC merge-conflict checkpoint. The browser adapter forwards it unchanged;
its mutable cloud cache is not evidence for the candidate's sequence.

The journal requires a nonnegative safe integer sequence whenever an ACK contains
`checkpointState` (`storage_ack_checkpoint_required` otherwise). It compares
that sequence with recovered operations **before** sealing the checkpoint. The
existing IndexedDB transaction separately compares the sealed checkpoint with
the live metadata sequence, owner, epoch and writer. An append committed between
these checks must abort the entire ACK. Neither check replaces the other.

Cursor-only ACKs used by detached owner transfer do not supply a reconciled
checkpoint and retain their existing contract. Shared Checks already supplies
its own captured sequence; Finance receipts remain independent.

| Transition | Evidence and local action |
| --- | --- |
| New cloud write | Valid authoritative RPC state; matching candidate sequence; atomic flight ACK/checkpoint; then scoped publication |
| Valid no-op | Same revision is permitted; acknowledge the exact flight range with the same candidate fence |
| Replayed operation | Reuse the original operation ID/snapshot; reconcile with the returned current cloud head and newly captured local sequence |
| Stale candidate before commit | No ACK, publication or cursor advance; keep the immutable flight and newer journal; an eligible explicit/reconnect/poll retry re-reads and reconciles |
| Wrong operation | Reject without changing base, checkpoint, flight or journal |
| Malformed authoritative state | Reject before ACK; never substitute the sent snapshot |

A stale **uncommitted** candidate is different from a new edit **after** a
successful ACK transaction. The latter retains the existing post-commit
publication/review policy. A stale candidate retry uses the existing owner and
retry path, without a new operation ID, artificial ACK, journal cleanup or
immediate unbounded retry loop. Orders checks primary access and the captured
owner/epoch again before writing retry control after an ACK failure. An old
primary cannot add control to another scope; Kupa retains its existing scope fence.

Both pre-transaction and transaction rejection expose `code` =
`storage_ack_checkpoint_stale`, `candidateSeq` and `observedSeq`. Existing error
messages remain compatible (`storage_ack_checkpoint_stale` and
`storage_checkpoint_stale`, respectively). The persisted retry code can identify
this failure without logging snapshots, business IDs, account names or tokens.
Missing/invalid candidate sequence also exposes the existing message as `code` =
`storage_ack_checkpoint_required`; normalization and persisted retry retain it.

## Scope-bound post-commit publication (2026-10-11)

The Main sync owner captures a frozen storage owner/epoch and authenticated
account/login epoch **before its first head read**. The composition root provides
`getCloudWriteScope`, joining the runtime's synchronous `cloudScope` identity
with `cloudAuth.getAccountScope()`. They must name the same raw account. A cached
cloud head, committed receipt or repeated seq/generation is never live authority.
The runtime query does not create a journal, claim a writer, read IDB or advance
an epoch. It can expose the same identity as non-writable after leadership loss
so only that operation's busy flag may finish; it cannot authorize publication.

Before ACK publication and every subsequent session/status/control/backup
continuation, compare that captured identity with the **live** writable identity
and the committed head. Re-check after asynchronous backup and in scheduled
retry callbacks. The same fence applies after rejection/rebase, before composing
a replacement flight or making another RPC, including both merge-conflict
branches. Generation and candidate-sequence checks remain additional fences.
An older promise's `finally` cannot clear a newer request's promise or busy flags.

Control writes additionally carry the captured expected owner/epoch and live
authorization check through the browser/runtime ports. The journal checks that
epoch and authorization again **after** its queue drains, before sealing control;
the existing IDB writer/epoch check remains atomic. A controlled regression
reproduced an old retry attaching to a reset epoch while waiting behind the
reset. Rejection preserves the new checkpoint/base and adds no control.
The obsolete sync owner returns false if it loses authority during that control
wait, without retrying or publishing the failure under the new identity. Control
storage failures under unchanged authority still reject visibly; regressions
distinguish this from normal scope cancellation.

If owner, storage epoch, login epoch or leadership changes after commit, return
false without publishing the old candidate, advancing the new session's revision,
adding concurrent-ACK/retry control to the new identity or starting its follow-up.
The completed transaction belongs to the old identity and stays committed there;
the new owner recovers its own head. This is not a transaction failure and does
not authorize replay as a different account. Optional adapter cache fallback after
commit is retained as evidence of the old commit, not as authorization for display.
Normal same-scope replay/no-op and bounded pre-commit retries are unchanged.

The browser cache has its own live owner/epoch fence. A late IDB read or old
receipt fallback can be returned as evidence, but cannot replace the new cache,
clear its pending flag or transfer a conflict flag to it. Orders cursor hydration
also checks the live scope before updating the session. An old cache cannot
activate the current owner's outbox. A native fault injection reproduced the
old fallback clearing the new pending flag before the adapter fix.

| After commit | Permitted continuation |
| --- | --- |
| Same owner/epoch/login, same head and primary | Publish; update that session; confirm clean state separately |
| Same owner but different login epoch | Retain commit; no old continuation under the new login |
| New owner or storage epoch with identical seq/generation | Retain commit; no old model/session/control/flight/backup publication |
| Same identity, secondary tab | Retain commit; release only its own busy flag; no publication/control/follow-up |
| Old receipt returned after refresh failure | Require live identity independently; receipt alone grants no authority |
| Publication throws after an identity transition | Retain commit/cause; do not fence the new identity with old failure control |

Post-commit diagnostics have explicit scalar fields only: phase, fixed error code,
base/ACK revision, flight endSeq, candidateSeq and observedSeq. Phases distinguish
`SCOPE_CHANGED_AFTER_COMMIT`, `ACK_COMMITTED_PUBLICATION_STALE` and
`ACK_PUBLICATION_EXCEPTION`. They omit snapshots, exception messages, owner IDs,
operation IDs and credentials. Pre-commit/atomic sequence errors keep their
existing codes and candidate/observed sequence evidence; diagnostics do not
change ACK or retry decisions.

### Isolation regression evidence

Main baseline `99ca5607ddd47540c2849eaec9be1a2c28b28f11` passed all eleven
[CI jobs](https://github.com/218218y/netunim/actions/runs/38156903674) on its
identical tested branch tree. Twelve controlled Node regressions nevertheless
failed: both applications published or updated session state after owner, storage
epoch or login-epoch replacement at ACK/rebase with seq/generation kept identical.
Additional regressions exercise committed old-cache fallback, all conflict
branches, publication exceptions and primary loss. This demonstrates a boundary
bug, not a known production incident.

`runtime_cloud_publication_scope.py` runs twelve disposable native-IDB profiles:
ACK/rebase × account/epoch replacement × both applications. A controlled promise
pauses **after** the native transaction completes; the next identity is recovered
and a synthetic note appended at the same seq/generation before release. It
Two additional account-change profiles reject an old fallback after a deliberately
failed post-commit cache refresh. The suite verifies no old publication,
session advance, status, backup, control or follow-up
RPC. A fresh document recovers both accounts with unchanged IDs/content/cursors;
epoch-reset cases preserve the acknowledged note alongside the new pending note.
Two further native profiles reject old control waiting behind an epoch reset,
retaining the new raw stores and recovering their note IDs/content unchanged.
The native pre-fix ACK/account test failed for both apps with old-scope publication.

These tests exercise actual storage and sync adapters with synthetic RPC receipts.
The identity transition is deliberately injected at their boundary; the production
login UI may additionally serialize/drain transitions. This is not evidence of a
production cross-account leak, live-provider validation or physical two-computer
testing. Existing native transaction, lost-response, no-op, PostgreSQL, multitab
and two-browser-device gates remain required. No RPC, SQL, persisted format or
operation-ID policy changes are introduced.

### Regression evidence (2026-10-11)

Baseline `214cf3869af173405c5c4c4d975ec6376282a7c6` passed all eleven
[CI jobs](https://github.com/218218y/netunim/actions/runs/38133113602).
Nevertheless, both production browser adapters accepted a sequence-1 candidate
after a sequence-2 append in `memoryDb` and native IndexedDB. Recovery returned
`flight-A` instead of `late-B` under the unchanged synthetic note ID. The
regression failed before this fix in both native application profiles; this is
not evidence that a production account suffered data loss.

`ack_checkpoint_sequence.test.mjs` verifies unchanged raw stores on rejection,
exact flight retention, late content/ID recovery, valid replay and mandatory
sequence inputs. Both application sync suites cover plain, after-flight and
post-RPC merge-conflict candidates plus leadership loss. Orders also covers an
account/epoch change before retry control.

`runtime_ack_checkpoint_sequence.py` adds ten isolated native-IDB profiles:
append before the browser adapter, append before the ACK transaction, transaction
abort, quota and primary loss, for each app. A fresh document recovers the same
flight and note, then acknowledges only the original range. `runtime_storage.py`
also injects the race into the actual sync owners, business merge and production
adapters, using a synthetic server ledger. Restart replays the exact RPC and
preserves visible, durable and remote IDs/content without duplicate effects.
Browser+PostgreSQL, lost response, no-op, multitab and two-browser-device gates
remain mandatory in CI. Synthetic ledgers/native IDB do not replace live provider
or physical two-computer validation. No persisted schema, RPC or SQL changes.

## Failure outcomes

| Failure point | Preserved state and continuation |
| --- | --- |
| Offline before send | Journal/pending remain; no RPC; existing reconnect owner resumes eligible work |
| RPC response lost after server commit | Same immutable local flight remains; replay the identical operation ID/snapshot |
| Another computer writes before that replay | Validate the current returned head, merge later local edits against the sent snapshot, retain both computers' work |
| IndexedDB ACK abort/quota failure | No publication or cursor advance; retain flight/pending; a later explicit/reconnect attempt can retry the identical operation |
| Invalid ACK revision | No ACK or publication; pending remains under existing error policy |
| Successful RPC without authoritative state | No ACK/publication/cursor advance; retain the exact flight and newer pending work; replay under the existing owner policy |
| Edit overlaps ACK commit | Confirm only the sent generation; prove and CAS a conflict-free journal delta before publication/normal pending drain, otherwise retain work with a review fence |
| Leadership changes during commit | No continuation from the old primary; new primary recovers from the durable journal |
| Post-commit cache/backup unavailable | ACK stays committed; report/defer the optional work without replaying the write |
| Post-commit model publication fails | ACK stays committed; preserve the cause, persist a review fence and stop further sends |

Busy/revision-conflict loops retain their current bounded three-attempt policies;
server retry deadlines remain persisted. No blanket ACK-error suppression,
unbounded retry, flight replacement or compatibility fallback is introduced.

## Evidence and limits

Six new behavior tests failed against main `9a68ff40`: both apps published before
ACK completion, changed visible state after ACK failure, and sent again after a
commit-overlapping edit. The fixed tests also verify identical operation replay,
late-generation preservation and leadership loss. Existing tests cover no-op ACK,
post-commit cache failures, rebase, delete intents and Main/Shared ownership.

`runtime_storage.py` additionally exercises both app sync APIs with real IndexedDB:
lost response, offline mutation, another computer's write, aborted ACK transaction,
fresh runtime recovery, exact operation replay and an edit during actual ACK commit.
The full CI gate includes Browser+PostgreSQL, two-tab/two-computer, PWA/offline and
Windows suites. Both apps additionally reject a malformed successful replay,
recover its retained journal in a fresh runtime, and eventually retain both
computers' note IDs/content without duplicate cloud commits. The standalone
receipt tests cover envelope, revision, no-op and JSON wire compatibility.
Controlled RPC fault injection complements the real SQL suites;
it is not a claim that every possible OS/browser/provider failure is simulated.

Persisted schema/protocol versions, SQL and RPC payloads are unchanged. Conflict
controls already accept an opaque `kind`; both new reasons use that existing
shape and readers keep their existing generic conflict gate.

## Committed ACK with later local work

ACK durability and publication permission are separate facts. A generation or
sequence change after ACK commit is not by itself a business conflict. Both apps
now use the bounded proof/replay/three-way-merge/CAS described in
[ORDERS_CONCURRENT_ACK_RECOVERY.md](ORDERS_CONCURRENT_ACK_RECOVERY.md).

The captured pre-ACK candidate sequence remains immutable. Every later displayed
edit must be explained by the validated post-candidate durable journal; the base
must still equal the authoritative ACK receipt. CAS validates live owner/login
epoch/primary, writer/epoch, sequence and checkpoint/base/control checksums.
Only the local projection changes; ACK, base, journal rows and flight identity do
not. Publication remains scope/generation fenced after the transaction.

Immediate recovery is bounded to two attempts. A real record conflict, unjournaled
draft, corrupt/stale head or ownership loss never becomes silent success.
Historical `concurrent-ack` controls require the explicit reviewed recovery action
and a fresh remote read; only that exact control can be retired. No blanket
`clearCloudControl`, synthetic ACK or new operation ID for the old flight.
