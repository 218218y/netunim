# PDF index: complete read before publication and compaction

## Evidence and scope

Two before-change regressions ran the production `readPdfIndexFiles` body:
an injected journal `EIO` and malformed JSON after a valid journal entry both
resolved successfully. The old reader cleared the live map before reading the
journal and silently skipped read/parse failures. Compaction subsequently used
that incomplete projection and could truncate an unread/invalid journal.

This is Document Bridge's derived local PDF search index. It is separate from
Main/Shared Storage V2, business document files, SQL and cloud ACK. No operator
data was used in the reproductions.

## Owners and publication

- `pdf-index-reader.mjs`: canonical schema version, persisted envelope decoding,
  ordered upsert/remove replay, complete candidate construction and stable-read
  evidence. Two explicit ports supply file access and the existing synchronous
  entry normalizer. The actual body and negative consumers are checked strictly.
- `pdf-index-file-platform.mjs`: native read-only snapshot/journal access and
  size/mtime/ctime signatures. Only `ENOENT` means a missing bootstrap input.
  Permission, I/O and other errors propagate; no blanket fallback makes a file
  appear empty.
- `server.mjs`: existing index lock, entry normalization, synchronous publication,
  maintenance and compaction. Publication starts only after the candidate has
  fully decoded and its signatures match. Failed reads cannot change the live
  map, metadata, loaded/signature flags or match cache.

Successful publication invalidates match text for prior and newly loaded PDF
paths. A maintenance process can update PDF text/geometry without modifying the
document's size/mtime; the match cache must observe the successful disk reload.
Invalidated in-flight fills retain the cache ownership contract.

## Persisted input contract

Schemas 1, 2 and 3, historical numeric schema strings, missing/null count
metadata, legacy extractor annotations, BOM/CRLF and a missing snapshot with an
existing journal remain readable. Ordered repeated upserts and idempotent
removals keep their previous behavior. A final complete JSON line does not
require a newline.

Invalid snapshot JSON/schema/entry shape, non-integral or invalid count metadata,
unknown/malformed journal operations, missing/non-string paths and a normalizer
that drops/relocates an entry fail closed. Journal diagnostics expose only a code
and line number, never record content or document paths. Entry field normalization
still belongs to its existing owner; this slice does not fully typecheck or
validate every PDF form field/business payload.

| Failure | Result |
| --- | --- |
| `PDF_INDEX_SNAPSHOT_INVALID` | Keep the active last-known projection and original files |
| `PDF_INDEX_JOURNAL_INVALID` | Keep all journal bytes, including the invalid record; do not compact |
| Native `EIO`, `EACCES`, etc. | Preserve classification and active state; no empty input substitution |
| `PDF_INDEX_READ_CHANGED` | Reject the candidate; a later explicit read may retry under the lock |
| Valid candidate | Publish all entries/metadata synchronously, then allow existing compaction |

The caller holds the existing index lock through read/publication. Metadata
signatures additionally detect observed disk changes; they are not a
cryptographic content CAS or a replacement for cooperative locking. Lock
takeover policy, worker lifecycle and the full index write/publication pipeline
remain separate review slices.

## Verification and operator recovery

Native synthetic tests exercise actual server normalization/publication and
compaction. I/O failures, a truncated journal and a changed-read signature keep
the live projection and raw bytes intact; compaction cannot write/truncate after
failed read. Exact fixture restoration followed by a fresh reader preserves
paths, text and form geometry. Valid compaction still produces schema 3 and an
equivalent fresh projection. Node cases cover negative envelopes, historical
inputs, ordered replay and safe error diagnostics; typecheck mutation rejects a
string pending-count result.

If a real index read fails, keep copies of **both** `pdf-form-index.json` and
`pdf-form-index.journal.jsonl` before any repair. Preserve the failed pair for
diagnosis. Stop only the owned Bridge/maintenance processes before restoring a
known-good pair, then resume and explicitly refresh the derived index. If no
known-good pair exists, inspect the retained records and plan a controlled
rebuild from source PDFs without overwriting the original artifacts. The code
does not automatically delete or truncate corrupt input to obtain a green status.
Source document files and business storage are not index repair targets.

The installer stages both modules before activation; activate the installed
server update by rerunning the updated `install_document_bridge.bat`. Staging
retains the previous runtime for rollback. Wire version and persisted schema
are unchanged. Full branch CI remains required before merge.
