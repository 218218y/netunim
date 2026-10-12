# Document PDF index write/publication contract

## Evidence

Two before-change tests ran production server functions on synthetic inputs.
Appending to a supported journal whose last valid JSON record had no newline
joined the new record onto it and made fresh recovery fail. On-demand extraction
also updated the live Map before awaiting journal persistence; an injected disk
failure returned no supplement while leaving the uncommitted candidate visible.

The maintenance loop likewise caught journal failures inside the extraction
catch and could classify them as PDF/provider failures and attempt another write.
The native regression now injects one failing append and proves one write attempt,
unchanged model/files, and a maintenance storage failure instead of a PDF retry.
These are derived PDF index faults; no application journal/ACK or source document
loss is asserted.

## Owners and transitions

`pdf-index-reader.mjs` owns the decoder for recovery and staged exact serialized
operations. Its new synchronous `stage` API copies a candidate and uses the same
operation validation as `read`; it does not modify the original or any file.
`pdf-index-writer.mjs` receives six explicit ports: reader, write files, lock,
serializer, synchronous publication and clock. It exposes append and compact.
The server is the composition root and the single live-map publisher.

| Phase | Required proof / outcome |
| --- | --- |
| Stage append | Capture serialized bytes; decode/validate them against a fully readable head |
| Before mutation | Existing scoped index lock plus unchanged file signature |
| Append commit | Journal handle writes a record separator if required, then payload, sync and close |
| Publication | Synchronous Map/cache/signature publication after the write resolves; local backlog counters stay owned by maintenance |
| Compact stage | Fully decoded head, valid counts, serializer preserves all path identities |
| Snapshot commit | Unique exclusive sibling temporary file, sync/close, then rename |
| Journal clearance | Independently replace with a synced empty temporary file; never truncate the old journal in place |
| Compact publication | Both writes completed; publish the committed entries and updated metadata |

Every root upsert/removal now goes through this owner before Map mutation.
Extraction errors remain provider/content outcomes; storage errors leave that
loop immediately. Backlog/removal metadata is updated after the corresponding
journal writes. An on-demand failure retains the previously confirmed projection.

To avoid quadratic replay of growing journal text during a maintenance batch,
the writer retains its last committed candidate. It can reuse it only under the
same lock after observing the same native size/mtime/ctime signature. A changed
signature forces full canonical decoding; staging never mutates that retained
candidate. Native processes test cooperating writer exclusion and compaction,
and deterministic tests cover external-head changes and queued call identity.

## Failures and recovery

- Malformed/unread inputs or a changed pre-write signature refuse all writes.
  Unknown records cannot be converted into an empty index or authorize clearance.
- Partial append, sync, close and I/O failures propagate. The prior projection is
  retained; raw disk evidence is not truncated or reset. A partial invalid tail
  causes future decoding/writes to fail closed.
- If a complete append reached disk but sync/close failed, its outcome is not
  reported as confirmed. A fresh read resolves what is readable; do not infer
  rollback or blindly repeat source extraction from the failed Promise.
- If snapshot rename fails, both canonical files stay unchanged. Cleanup targets
  only that acquisition's unique temporary artifact, preserving error chains.
- If journal replacement fails or the process dies after snapshot commit, the
  complete snapshot plus the old journal remain replayable. Upsert/remove replay
  is idempotent by path. A fresh lock owner can read and finish compaction.
- `PDF_INDEX_COMMITTED_PUBLICATION_FAILED` means file work finished but its
  consumer failed; reread the committed head before deciding whether to retry.
  A successful Promise from publication is not accepted as synchronous proof.

For an invalid partial journal: keep private copies of snapshot, journal and lock
metadata, confirm the writer has stopped, and restore only a verified exact
fixture/known-good pair or use a separately reviewed derived-index rebuild. The
tests perform exact restoration solely in synthetic private directories. No
automatic deletion, journal reset or source-file modification is introduced.

The protocol assumes upgraded cooperating lock users. Native sync/rename and
process-crash tests are evidence for those boundaries, not certification of
hardware power-loss behavior or arbitrary external filesystem edits.

## Verification and activation

Tests cover old no-newline framing, actual on-demand/maintenance wiring, invalid
wire serialization, partial append, sync failure, rename failure, pre-write race,
post-commit consumer error, cached-head invalidation and serialized operations.
Two real Node writers append/compact under the native file lock. Another worker
is killed after snapshot rename and a fresh owner recovers the exact original
paths/text/form geometry before finishing work. Strict checkJs checks real
writer/decoder bodies and negative consumers; an implementation mutation that
publishes a string timestamp fails the gate.

Both runtime modules are staged by `install_document_bridge.bat`. Normal
installer rollback applies. PDF schema remains 3 and historical schemas 1/2,
nullable counts, BOM/CRLF and complete last records without newline stay readable.
Storage V2, SQL, browser wire versions and provider retry/cooldown are unchanged.
Search/orchestration and scheduled-task/installer lifetime remain separate slices.
