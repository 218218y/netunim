# Document search and preview

On Windows, Document Bridge owns Everything discovery, authorized file
operations, index maintenance and preview lifetime. Set approved roots and
pair the site using the [connector guide](../operations/connectors.md). Drive
search uses a separate [Google integration](google.md).

## Text matching

[The shared matcher](../../shared/document-text-search.js) drives the site and
connector implementations. The asset generator also emits the classic worker
copy for spreadsheets. Local viewer coordinates and Bridge wire-query input
admission remain separate. The latter limits normalized queries to 240 characters.

Proximity tokenizes whitespace-delimited words and works backwards through the
query. Each stage computes the rightmost viable successor inside its allowed
distance window. Its work is O(query terms * document tokens), with linear
scratch space. A missing final term cannot cause combinatorial backtracking.
The canonical implementation itself is in strict checkJs (including unchecked
index access), with typed numeric UTF-16 ranges, explicit mode unions and separate
term-presence evidence. Negative consumers reject malformed result/collection
types; mutations of actual implementation coordinates and term evidence must fail
compilation. This is targeted coverage of the new boundary, not a claim of full
application typing.
The old greedy, ordered, non-overlapping ranges remain intentional: the first
term may be a token suffix, intermediate terms occupy entire tokens, and the
last may be a prefix. Whole-word matching additionally checks Unicode letters,
numbers and combining marks; punctuation and distance zero keep their meanings.
Lowercase expansions retain original UTF-16 highlight coordinates.

Every distinct term is checked independently of the display limit. Collected
ranges are ordered and deduplicated before truncation. `capped` remains the
existing conservative signal (the returned count reached the limit), rather
than claiming an exact undisplayed count. Spreadsheet `all` remains workbook-wide:
presence can span cells or sheets, and scanning continues after highlights fill.
PDF.js keeps its own normalized page/item matching and uses the shared matcher
for form-value text. A further reproduced failure selected the earliest repeated
intermediate word even when only a later occurrence could complete the query.
PDF proximity now computes reachable suffixes in native coordinates, using word
prefix counts and binary searches instead of repeated candidate/gap scans.
It preserves zero-width visual item boundaries and agrees with canonical greedy
ranges on exhaustive whitespace fixtures. Existing normalization tests remain required.

Everything proximity now requests an AND of distinct terms and the content
property, then verifies ordered distance with that same canonical matcher before
publication. Native ordering, scope and file-type filters are preserved. Candidate
pages start at 100 candidates until enough verified rows exist; only then is
the result offset applied. The candidate ceiling is 5,000 and the existing search
timeout plus subprocess grace bounds each scan. Exhaustion is explicitly partial,
including in the UI and after pagination. Missing/non-string content fails
explicitly; extracted text is never published in result rows. Phone-like queries
retain their existing native separator contract. Everything still owns extraction
and its index coverage; this is not a claim that every on-disk format is indexed.

The native subprocess retains its 16 MiB output ceiling. A stdout overflow is
typed as `ES_OUTPUT_LIMIT`; verification retries the same candidate cursor with
half the batch (minimum one), retaining the original scan deadline and candidate
budget. A successful smaller batch advances normally. A single candidate that
still overflows fails explicitly as `ES_CONTENT_TOO_LARGE`, including after prior
verified progress; no content is silently skipped or published without verification.
Large stderr, malformed data and ordinary IPC failures keep their error behavior.
Only `ES_TIMEOUT` after verified progress may yield a partial page; caller abort
always prevents publication. PDF preparation/partial state participates only for
file types that include PDF.

Run `node tools/benchmark-document-search.mjs` for matcher compute samples.
Use `node tools/measure-document-bridge.mjs --native plan.json report.json` with
the [local connector console](../operations/connectors.md#local-console) to
measure the native route. Record warm repetitions separately from the first
request and keep browser render measurements separate.

## PDF runtime diagnostics

PDF.js remains pinned to the version and integrity in
`tools/pdfjs-runtime-lock.json`. Its worker, ICC profiles and WASM decoders stay
in the verified, lazy vendor tree. Network filtering does not change their
paths, bypass release integrity or authorize caching an error response.

## Internal PDF name warnings

`Name token is longer than allowed by the spec: 1111` comes from PDF.js's PDF
lexer. It reports a PDF **Name object** exceeding its 127-byte limit, not the
Windows filename, directory length or browser URL. The reported order document
reproduced eight such warnings when supplied as bytes, with no filename passed
to PDF.js; all three pages rendered. Renaming the document cannot fix its
internal syntax. Keep these library diagnostics visible rather than hiding
warnings or rewriting customer documents.

## WASM and Content Security Policy

PDF.js uses WASM for image decoding, ICC color conversion and supported
PostScript functions. Both applications allow `'wasm-unsafe-eval'` in
`script-src`; JavaScript `'unsafe-eval'` and inline script remain prohibited.
The viewer also explicitly supplies `isEvalSupported: false`.

The native regression renders a synthetic CMYK ICC and Type 4 PostScript PDF,
checks rendered colors and compiles the four pinned WASM modules. Negative
JavaScript evaluation checks explicitly disable CDP's default CSP exemption.
The same render/policy probe runs against actual production chunks in CI.

## HTTP access denial

The reported `qcms_bg.wasm?__netunim_vendor=...` request returned **418 Blocked
by NetFree**. An independent live audit verified that the published WASM bytes
exist and match the pinned runtime. This is separate from CSP compilation.

HTTP 401/403/418/451 now produces an access-blocked notice with the status and
public vendor path. Such responses never enter the release cache. The next
document opening retries the same SHA-bound URL after normal access is restored.
Network filtering must be resolved with the filtering provider for each site's
`/assets/vendor/pdfjs/wasm/` resources, including the query-bearing URL actually
blocked. Refreshing tabs or resetting application data cannot remove a filter's
denial. No alternate host, renamed resource or embedded copy bypasses the filter.

Run `python tests/runtime_pdf_wasm.py` for the real source-viewer 418/retry,
color, CSP and internal-name regressions. `tests/runtime_production_build.py`
includes the emitted-bundle color/CSP probe in the existing full build suite.
