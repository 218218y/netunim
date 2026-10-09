# Persisted Cloud Base, Flight and Control authority

## Baseline and reproduced failure

This slice starts from main `1ee11368479f720d853fee0b0d9073e6b517a4ea`,
which contains PR #104. Its verified branch
`8294efb555b57256240d0550de3fd8fcf62a05e1` passed
[all full-gate groups and Windows contracts](https://github.com/218218y/netunim/actions/runs/37879701976).
Node reported 1,674 passing tests. Browser/real IDB, PostgreSQL, recovery,
offline/PWA, two-tab/two-profile and Morning/Bridge contract groups passed.
This is CI evidence, not a live provider login or a physical two-computer drill.

The test-only commit `9f2aee2f56d00f8dcb7ca57912c9d29ccbc23a11`
failed [its deliberate regression run](https://github.com/218218y/netunim/actions/runs/37892951145):
all fourteen new Node regressions failed, and sixteen isolated real-IDB
Main/Shared scenarios across both app roots demonstrated the same gaps:

- A checksum-valid Flight with a foreign payload owner was returned from the
  retained-flight fast path. Journal ACK accepted it under the current owner,
  advanced the base and removed the Flight/Control.
- A checksum-valid Control with a negative retry count passed fresh recovery
  and permitted a writer claim/readiness.
- A checksum-valid Base with version 1 passed the active cloud-head read.

These were synthetic fault injections. They prove inconsistent authority at
the persisted-data boundary, not corruption or data loss in a production DB.
The test restored the exact captured good records and proved original IDs,
content and immutable Flight replay before a valid durable ACK.

## Decision and reader inventory

`shared/storage-cloud-records.js` checks its actual JavaScript reader bodies.
It validates JSON/checksum first, then the kind, then physical namespace scope
and the relationship between Base, Flight and committed metadata sequence.
It returns detached data without rewriting or filling fields.

| Consumer | Decision before using persisted authority |
| --- | --- |
| Journal recovery, primary and read-only | Kind/scope/pair validation before readiness or writer claim |
| Cloud pending/status snapshot | Same head decision, then app cloud-projection validation and pending journal continuity |
| Materialization of a retained Flight | Recovery head decision plus cloud business validation before returning its immutable payload |
| Journal ACK/rebase/import/adoption | Recovery uses the same decoded head; existing optimistic preconditions remain |
| IDB writer claim | Head validation within the claiming transaction, closing the recovery-to-claim gap |
| Fenced full-head transactions | Head validation after writer fencing and before writes, including ACK, rebase, compaction and Control clearing |
| Incoming Base/Flight/Control writes | Existing operation-specific range/scope/ACK preconditions, then kind validation before commit |
| New account cutover marker | Clean Main/Shared head preconditions plus decoded Base authority in the same transaction |

The hot append path still reads its two small records and checks writer,
sequence and immutable retry identity. It does not read full cloud payloads,
clear an outbox or authorize an ACK. Explicit install/fenced historical
adoption retains its established recovery gates; it is not automatic repair
of a malformed live cloud head. Existing complete-marker reads certify the
marker protocol, not current cloud synchronization.

## Invariants and historical annotations

- Base: version 2, bounded nonempty textual owner/epoch, nonnegative safe
  integer revision/ackSeq, JSON object state. ACK cannot exceed committed seq.
- Flight: version 2 and textual immutable operation ID; nonnegative safe
  baseRevision, safe start/end >= 1, end >= start. It requires its Base,
  matching owner/epoch/revision, start = ackSeq + 1 and end <= committed seq.
- Control: version 2 and matching textual owner/epoch. Retry/conflict are
  objects when present. Retry attempts are nonnegative safe integers when
  present; nextAttemptAt is a parseable textual deadline when present.
- Nullable/absent historical Flight generation/audit/deleteIntents/surface/
  mutationType, Base projection and Control annotations remain supported.
  Non-null fields are checked; opaque JSON audit/conflict details remain the
  business owner's responsibility. Diagnostic stamps are not ordering clocks.
- Historical Flight deletion-intent ordering/duplicates are retained. They
  do not authorize journal deletion. Current writers keep their existing
  normalized deletion policy. No operation ID is replaced on replay.
- A Flight lacking startSeq, or a Base lacking owner/epoch, was already
  unsupported by the existing scoped cloud snapshot. Such records remain raw
  and fail closed; this change adds no speculative historical migration.

Writer property order, wire bytes, checksum algorithm, installed schema,
RPC/SQL, no-op ACK revisions, merge and retry scheduling are unchanged.
The eight-stage pre-refactor golden writer fixture still compares exact bytes.

## Failure provenance, retention and restore

`StorageCloudRecordError` identifies a failure proved while decoding persisted
records. Main recovery classifies it as fatal. A generic error from an
optimistic write precondition remains retryable; matching a broad error prefix
would incorrectly poison recoverable races. Transport/IDB abort/owner changes
retain their existing taxonomy and guards. The public message codes remain
specific to the invalid kind or mismatched scope/pair.

No decoder acknowledges, deletes, resets or normalizes stored data. Failed
recovery grants no readiness. Failed transactions preserve Checkpoint,
metadata/writer, physical journal records, Base, Flight and Control atomically.
Export and known-good restore remain explicit operator workflows. Do not
reseal guesses, discard pending work or create an empty state to make boot pass.

`tests/runtime_cloud_record_recovery.py` injects both app roots' real IDB Main
and Shared records: foreign scope, wrong version/type/range, malformed retry,
read-only/primary recovery, direct ACK/claim/compaction/clear and stale writer.
An invalid incoming Control is checked after the checkpoint put request;
transaction abort must retain all preceding writes. Every scenario verifies
unchanged stores, test-only exact restoration, original business IDs/content
once, identical pending Flight, and fresh recovery after a valid ACK.
Existing browser suites separately retain lost RPC response, immutable replay,
abort/quota, concurrent edit, publication, owner transfer and PWA coverage.

The strict checker covers this canonical implementation and both generated
decoder implementations through real negative consumers, including nullable
historical fields. An injected string Flight sequence must fail compilation.
Full transaction/business input typing, Morning ownership/idempotency, Finance
unsaved UX and cross-tab privacy remain separate work; this slice does not
claim to complete them or certify live provider behavior.
