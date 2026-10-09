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
   publish only while leadership, local generation and returned sequence still
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
    Preserve/report its original cause and committed receipt, persist an
    `ack-publication-failed` control, and stop further sends. An optional render
    exception after the model was published is reported without replaying the ACK.
11. An HTTP-success Main response must contain its authoritative object document.
    `readDocumentWriteAck` owns this envelope and the existing revision/no-op/replay
    decision. Never replace absent/null/scalar/array state with the sent snapshot:
    an operation replay returns the current cloud head, which may include another
    computer's later write. The returned receipt is not a durable ACK; the same
    fenced transaction, generation checks and publication sequence still apply.

## Failure outcomes

| Failure point | Preserved state and continuation |
| --- | --- |
| Offline before send | Journal/pending remain; no RPC; existing reconnect owner resumes eligible work |
| RPC response lost after server commit | Same immutable local flight remains; replay the identical operation ID/snapshot |
| Another computer writes before that replay | Validate the current returned head, merge later local edits against the sent snapshot, retain both computers' work |
| IndexedDB ACK abort/quota failure | No publication or cursor advance; retain flight/pending; a later explicit/reconnect attempt can retry the identical operation |
| Invalid ACK revision | No ACK or publication; pending remains under existing error policy |
| Successful RPC without authoritative state | No ACK/publication/cursor advance; retain the exact flight and newer pending work; replay under the existing owner policy |
| Edit overlaps ACK commit | Confirm only the sent generation, retain later work, persist conflict fence and require review |
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
