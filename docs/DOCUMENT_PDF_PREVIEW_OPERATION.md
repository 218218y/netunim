# On-demand PDF preview and worker ownership

## Proven boundary gaps

The immutable `tests/fixtures/pdf-preview-policy.json` captures the original
preview, worker transport and serialization functions from `a7b339be`. Token
hashes protect those functions from accidental fixture updates. Tests execute
that implementation alongside the current owner.

- A preview extraction held across result invalidation could append its positive
  entry after the file's removal. The old match-text cache fenced its own slot,
  but did not control the separate persistent index publication.
- A timeout or oversized worker output rejected immediately after `kill()`;
  neither that promise nor shutdown acknowledged the worker's `close` event.
- A truthy `ok` envelope and unchecked result could authorize a false negative
  or invalid form geometry. A successful envelope followed by a failed process
  exit was also accepted. The worker's stdin had no error listener.

These are local process/index authority gaps, without evidence of financial
data loss or changes to the browser account protocol.

## Owners and contracts

`pdf-preview-operation.mjs` owns one complete accepted enrichment, including index
load, extraction, durable append and failure audit. Six narrow roles provide the
index, extraction, Windows path names, presentation, revision policy and audit.
It cannot remove document files or acquire Everything processes.

`read` captures an abort controller before execution. Terminal `dispose` fences
unstarted work, aborts accepted extraction and joins every complete operation.
`invalidate(path)` aborts and joins that path's existing operations. The server
awaits it before appending a removal. An append already admitted to the durable
writer completes first, so replay ends with the remove record. Invalidation of
another file remains independent. Public opaque-ID retirement prevents new file
commands after removal; the owner does not add a permanent per-path tombstone.

The independent match-text cache retains its coalescing, TTL and LRU contract.
Index reload still invalidates match text synchronously; it does not invoke the
operation's path invalidation from inside a journal publication.

`pdf-extraction-process.mjs` owns launch, timer, abort listener, output/diagnostic
limits, first failure and final close. Its platform adapter owns only native
spawn and pipe events. The existing 25-second deadline, 32 Mi UTF-16 output-char
limit, 4,096 diagnostic-char limit, runtime executable, cwd, hidden window and
isolated short-lived worker remain. Diagnostics are now strictly bounded even
when a single chunk exceeds the cap. Timeout, overflow, abort, spawn and pipe
errors preserve the first cause, terminate the child where necessary, and settle
only after all worker pipes close. Repeated disposal joins accepted children.

`pdf-extraction-result.mjs` starts from `unknown`. Explicit boolean success and
zero exit status are required. Result presence/count/text must agree with the
decoded fields. Each field requires a positive integral page, nonnegative
integral annotation index, nonempty identity, text name/type/values, four finite
coordinates and boolean multiline state. Only the text/choice fields emitted by
the current extractor are accepted. Returned arrays are independent copies.
Malformed evidence falls back without changing the durable index. Historical
index schemas and their compatibility normalization remain separate and intact.

## Preserved behavior and verification

The current fingerprint tolerance, positive and current-negative caching,
detection/search/geometry revisions, geometry-only repair, retained page text,
serialization and failure messages match 864 old/current scenarios plus uncached,
timestamp fallback and load/journal failure cases. No retry, fallback selection,
maintenance scan or browser wire policy is added.

Deterministic lifetime tests hold every accepted phase, reproduce both original
races, and check invalidation during extraction or an admitted journal append.
Actual server composition tests recover native index files, reject malformed
worker evidence without changing either file, and prove shutdown/removal joins.
Native child tests cover Unicode/cwd, timeout, overflow, abort, missing runtime,
broken stdin and actual vendored PDF.js extraction of Hebrew AcroForms, ordinary,
password-protected and corrupt PDFs. Strict checkJs includes all three production
owners/decoders, negative consumers and implementation mutations. The native I/O
adapter remains outside that compiler boundary and is tested with real children.

The Windows installer stages all four new modules through the existing atomic
runtime installation. No persisted schema, wire version, SQL, vendored PDF.js or
site asset is changed. Existing installations activate this server change by
rerunning `install_document_bridge.bat`; this source change does not itself run
the installer on a user's machine. Controlled live Windows UI/provider drills
remain outside synthetic and CI evidence.
