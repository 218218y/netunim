# Journal command authority

Current IDB append, bootstrap and import-boundary writers decode operations
against a schema selected by the physical owner namespace: Orders, Kupa or
Shared Checks. They capture checked input synchronously before opening IDB.
Unknown namespaces require an explicit generic-journal schema at construction;
that captured configuration cannot override an application namespace. Schema arrays are immutable and Shared Checks
uses the same schema for caller validation and IDB authority.

The append hot path still reads only metadata and the exact journal key.
Writer, epoch, sequence and retry-payload comparisons remain inside the native
transaction. Success is returned only from transaction completion. A successful
put request followed by abort does not grant a receipt or advance metadata.

Journal ACK/rebase, cloud base, local import and checkpoint replacement commands
capture caller-owned state before yielding. This prevents checked values being
replaced while waiting for queued work. Existing business validation and cloud
head/sequence checks remain authoritative; no replay algorithm was replaced.

`storage-journal-authority.js` is strict checked with negative consumers and a
decoder-removal mutation. Native `runtime_journal_authority.py` covers all three
namespaces, malformed append/bootstrap/import, caller mutation and abort after
request success. This is selective checking of the authority boundary; the full
IDB orchestration and V2 runtime bodies are not yet strict checked.

Supplier search now uses one NFC/case normalization rule for DOM visibility and
model summaries, scopes supplier names consistently in all-supplier mode, and
refreshes the search index and totals after inline text edits. Stored text keeps
its original spelling and case.
