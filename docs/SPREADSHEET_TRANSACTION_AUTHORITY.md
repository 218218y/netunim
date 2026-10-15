# Independent workbook RPC authority

Both applications use `shared/spreadsheet-remote.js` for the actual independent
workbook read/write/backup transport. This does not change Main/Shared Storage V2
or rewrite the workbook merge, delete-intent, draft or local transaction policy.
The SQL `save_spreadsheet_document_v1` name is a current business RPC, unrelated
to the retired Storage V1 writers. Its immutable migration is unchanged.

## Confirmed gaps and boundary

Previously `spreadsheet-sync.js` parsed arbitrary response JSON, selected the
first array member regardless of row count, validated workbook content and then
adopted `result.revision` while clearing the durable flight. A valid workbook
with a missing/regressed/false revision or an ambiguous multi-row response could
therefore supply insufficient ACK evidence. Backup listing bypassed even the
existing post-body account check. Account comparison used only the owner string
and could not distinguish A/logout/A replacement during a held response body.

The checked transport now starts from unknown JSON and, for writes, an unknown
persisted flight. It validates the exact domain/document/operation identity,
safe expected revision, restore ID and equality of saved flight state to its
wire payload without rewriting the persisted payload. The existing
`assertSpreadsheet` algorithm remains the workbook codec.

Document reads accept one object/singleton row; only an empty REST result array
means absence. Metadata reads return revision evidence only. Successful writes
require exactly one valid state/revision receipt and a literal boolean
`operation_replayed`, as returned by the current SQL function. Fresh saves must
return the submitted state and the SQL-expected revision: an unchanged-state
no-op can retain its revision; a changed state advances one. Replay can return a
later current head, including another computer's edits, but cannot regress below
the earliest revision that this flight could have committed. Restore no-ops and
later-head restore replay retain their existing semantics.

The schema permits existing revision-zero rows even though ordinary creation and
migration start at one. Reads and backup metadata retain that compatibility, and
a proven identical-state zero-revision no-op remains valid. Absence is still an
empty REST array; a malformed reply is never converted into an empty document.

Malformed or ambiguous evidence throws before the coordinator clears its flight
or changes its cloud base/revision. The ordinary pending/retry path retains the
same operation ID and payload, including across reload. A read timestamp, HTTP
success or backup catalog entry cannot substitute for a write ACK.

Each request captures the workbook owner, record instance, primary/writable
admission and authenticated login epoch. Both real compositions supply
`cloudAuth.getAccountScope()`. A synchronous guard brackets request, retry,
response body and rejection, including A/B/A replacement. Network connectivity
is deliberately not a post-acceptance authority check: going offline after a
confirmed write cannot invalidate that confirmation. Reopening after a login
can intentionally resume that owner's durable work under a newly captured scope.

Backup catalog reads use the same scoped boundary and validate the bounded row
list, unique safe IDs/revisions, timestamps and known SQL kinds. They return
metadata only. This is not a claim that all workbook presentation or native-IDB
callers have full static coverage; their remaining ownership work is separate.

## Evidence

- Actual strict checkJs transport bodies, generic domain codec outputs, both
  generated consumers, negative consumers and four compiler mutations.
- Malformed JSON, ambiguous row counts, numeric/replay/state/flight faults,
  fresh/no-op/replay/restore policies and body/request success/rejection races.
  Semantic mutations expose first-row-only ACK acceptance and missing body scope.
- Both real sync consumers retain durable flight bytes on invalid ACK, reuse the
  same payload on valid retry, fence held A/B/A bodies and accept confirmed work
  after connectivity loss. Existing lost ACK, edits-during-RPC, deletion/import,
  conflict, legacy comparison and restore-idempotency policies still pass.
- Uninstrumented Chromium with native IndexedDB proves malformed ACK retention,
  full navigation/recovery and exact retry, plus A/B/A body scope in both apps.
  The existing Kupa desktop/mobile workbook deletion/autosave workflow also passes.
- Full SQL/browser/Windows verification runs on the branch; no SQL deployment or
  production provider call is part of this change.
