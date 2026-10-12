# Everything result and PDF inventory boundary

## Evidence and reviewed source

Four before-change production-function regressions failed: a non-result JSON
object was accepted as an empty result set; a malformed row silently shortened a
page; a status string containing `0` was accepted as a count; and cancellation
during the last page still allowed an inventory result to resolve successfully.
Native synthetic process tests now prove malformed output cannot authorize
indexed-record removals or publish opaque search IDs/success.

ES is pinned to 1.1.0.38 in `install_es.ps1`. Its matching upstream
[version header](https://github.com/voidtools/ES/blob/b749e17044d073ce1f928c3368d0df5103f25a15/src/version.h)
and [output implementation](https://github.com/voidtools/ES/blob/b749e17044d073ce1f928c3368d0df5103f25a15/src/es.c)
were inspected. The JSON opening bracket is emitted at the first result row;
zero rows legitimately produce empty stdout. The scalar result-count path emits
decimal digits. These reviewed empty/UTF-8 behaviors stay compatible rather than
being guessed from synthetic fixtures.

## Decoder

`everything-result-codec.mjs` checks real implementation bodies with checkJs.
The existing `parseEsJson`/`parseEsCount` exports delegate to it.

- Blank JSON stdout, a bare result array, or one named `results/items/files/rows`
  collection is readable. Case variants of named wrappers remain supported.
  Ambiguous collections and unrelated metadata arrays are not success evidence.
- All rows must decode. Missing/invalid identity, primitive rows, relative paths
  or malformed JSON reject the whole page; no silent filter changes cardinality.
  Unicode paths, UNC/direct path columns, drive roots and existing attribute/date/
  size normalization remain covered by behavior tests. Nullable optional path
  columns retain prior compatibility only when complete identity can be derived
  independently from another column; missing identity still rejects.
- Count output must be a complete nonnegative safe integer scalar. No grouping,
  fractions, exponent/status text or partial digit match becomes a valid cursor.
- Errors retain `ES_INVALID_JSON`/`ES_INVALID_COUNT`, with an optional row index.
  Diagnostics contain no raw document or stdout payload. Preview-content policy
  remains separate from result enumeration.

## Inventory owner and source

`pdf-inventory.mjs` receives two explicit ports: opening a source session and
checking runtime stop authority. It exposes `read` and `assertActive`.
`everything-inventory-source.mjs` implements the native config/probe/command
boundary using three explicit ports and existing ES query builders.

1. Open one session; capture executable path, IPC instance and timeout scalars.
   Config/probe cache changes by another search cannot redirect later pages.
2. For full reconciliation read a valid starting count. Incremental date scans
   deliberately do not manufacture full count proof.
3. Page by actual row cardinality. Validate page bounds/PDF file identity and
   unique case-insensitive paths. Repeated pages fail with `PDF_INVENTORY_CHANGED`
   rather than looping or returning a partial list.
4. Full reconciliation requires matching final count and unique cardinality.
   Growth, omissions or changed counts refuse reconciliation.
5. Check abort/runtime stop before and after every owner await and again in the
   root caller before removal/backlog publication. Cancelled/invalid reads do not
   touch the derived index. Writes already started drain; a late stop retains
   their committed result and prevents a successful subsequent backlog result.

The existing single page retry for native exit 8 is retained only when a fresh
probe confirms the same captured executable/IPC instance. A changed source
throws `PDF_INVENTORY_SOURCE_CHANGED`; start a fresh inventory instead of mixing
namespaces. Count/non-exit-8 failures retain their classification and receive no
new retry policy. Signal checks also fence config/probe, native output and retry.

Count/uniqueness checks are necessary reconciliation evidence, not an atomic
filesystem/index snapshot. Same-cardinality concurrent file changes and broader
search merge/pagination semantics remain separate orchestration work. No claim
of live Everything/provider certification or production data loss is made from
synthetic process tests.

## Verification and operation

Tests cover malformed/ambiguous envelopes, exact row/cardinality and count
contracts, all paging/abort phases, repeated pages, pinned source/retry and typed
negative consumers. Native Node stdout feeds the actual root rebuild/search
functions, native index reader/writer and lock. Rejected enumeration retains the
same snapshot/journal bytes, projection and backlog; verified zero-result output
still reconciles correctly. Post-read cancellation and a stop after an already
started index append are separate controlled tests.

When inventory is changed, cancelled or invalid, keep the retained index and
diagnostics. A later fresh reconciliation can reread the source. Do not clear the
index or reinterpret failure as zero documents. Activate with the updated
`install_document_bridge.bat`; all three modules are staged with normal rollback.
Storage V2/ACK, business records, SQL, PDF persisted schema, browser wire versions
and Bank/Credit provider policies are unchanged.
