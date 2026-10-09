# Persisted checkpoint decoding and recovery

## Evidence and scope

Baseline: `a20eadd6383b56d3af2cd3e13087472ac749db54`, after
[PR #102 full branch verification](https://github.com/218218y/netunim/actions/runs/37874535901).
Eight new tests failed before the change: the generic replay owner accepted
checksum-valid checkpoints with array/scalar state or array/scalar metadata.
A further test reproduced an unclassified `TypeError` while reading a BigInt
payload; the existing recovery policy classified that error as retryable.

These are component/fault-injection findings, not evidence of corrupted
production user records or data loss. Application business validators already
reject many malformed states; they remain mandatory after structural decoding.

## Boundaries and owners

1. `storage-json-codec.js` verifies the JSON representation and checksum, then
   returns a detached JSON value. It grants no record-kind or business authority.
   Non-JSON persisted values are rejected before serialization, using the
   existing `storage_non_json_value`/`storage_unsafe_key` codes. An invalid
   envelope or mismatching checksum uses `storage_checksum_mismatch`.
2. `storage-checkpoint.js` decodes that value as a version-2 checkpoint: bounded
   non-empty owner/epoch, a non-negative safe integer sequence, object state
   and object metadata when present. It rejects invalid structure with the
   existing `storage_invalid_checkpoint` code; it never coerces fields.
3. Journal recovery matches owner/metadata, validates/replays operations,
   checks Main projection and validates the recovered business state. Only
   successful recovery may claim a writer or grant runtime readiness.
4. Main and Shared Checks retain distinct roles/cursors/flights and their
   existing mutation fences. Shared open/read-only role checks use the same
   checkpoint decoder; a secondary recovery never claims a writer.

JSON validity, record-kind validity, business validity and account/sequence
authority are different proofs. Passing an earlier check does not replace
the later checks. Generic JSON cannot be typed as an arbitrary business model.

## Compatibility

The reader contract is distinct from the current writer contract. Existing
checkpoints may lack `appMetadata`/`savedAt`, or have null metadata. Decoding
preserves those forms, extra JSON fields, property order and contents exactly.
The existing replay owner still supplies its historical empty metadata view
when necessary; the decoder does not rewrite the stored record. Current writers
continue to require their explicit metadata/timestamp through existing types.

The checksum algorithm, persisted envelopes, schema version, JSON rules and
writer output bytes remain unchanged. Instrumentation still measures
validate -> clone -> stringify -> bytes, with the same labels and error
propagation. Compatibility exports delegate to the checked codec. No supported
historical format, migration, ACK, SQL, RPC or retry policy is removed or replaced.

## Failure and restoration

Invalid persisted structure/JSON is corruption under the existing recovery
taxonomy. Main recovery retains its fatal identity fence; Shared open fails
before trust is granted. Neither path claims a writer, clears journal/pending,
advances an ACK/base, deletes a flight/control, or synthesizes empty state to
make the application ready. Retryable IDB/network/ownership failures keep their
existing classification.

There is no automatic repair in this change. Retain/export the affected local
records and compare verified account-specific backups/cloud heads before using
the existing recovery workflow. An empty/default model is not a repair source.
The browser drill restores only an exact known-good checkpoint captured before
test corruption; it does not invent a production recovery procedure. A fresh
runtime must prove the restored checkpoint plus retained journal again.

## Verification and limits

- Node checks structural failures, legacy absent/null metadata and missing
  timestamps, detached reads, checksum/JSON errors, operation replay, append,
  compaction and fresh recovery of original note identity/content.
- The baseline writer fixture still proves exact sealed bytes/checksums at
  eight journal/ACK/rebase stages; historical upload-owner tests stay required.
- Strict checkJs compiles actual codec/decoder bodies and both generated
  decoders. Negative consumers cannot treat raw JSON as a checkpoint, assume
  business fields/current-writer metadata, or return asynchronous instrumentation.
- Both deployed app roots run real IDB fault injection for Main/Shared and
  primary/secondary recovery. Malformed state/metadata and native BigInt are
  retained alongside every journal/base/flight/control/writer record. Verified
  restoration plus a fresh runtime recovers pending IDs/content and the same
  immutable flight/cursor/control.
- Full CI must pass Browser/PostgreSQL, offline/PWA, two-tab/two-profile,
  recovery, performance and Windows gates before merge.

Full operation/Flight/base/control decoders, complete IDB transaction typing
and all business schemas/application consumers remain separate coverage work.
