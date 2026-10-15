# Morning read catalog and metadata evidence

Starting point: `9560ebd1d459d82368ea1cc572814fac91c49434`.

`morning-catalog.js` owns search caching and operation metadata flights through
three explicit ports: captured read authority, the existing request boundary and
a clock. It exposes search, document detail, fresh download link and verified
operation metadata queries. It cannot issue documents, allocate debt, inspect
DOM or commit storage. Accepted requests remain drainable after disposal; account
changes fence both cache reuse and late completions. Invalidation cannot allow an
older in-flight search to repopulate the cache. A nonterminal/null metadata result
is evicted so a later explicit read can observe verification.

`morning-catalog-evidence.js` decodes unknown search pages, document details,
operation metadata and HTTPS download links. Counts, monetary scalars and provider
codes cannot be coerced from text. Document details must match the requested ID;
metadata must match the requested operation before it can invoke the existing
single-writer metadata persistence capability. Verified metadata with missing
number/type still obtains details on demand. Historical textual document IDs stay
readable. Download links are still fetched afresh and never persisted.

The browser keeps query/filter/picker and mounted publication ownership, while
cache/read orchestration moves out. The existing 90-day window, 25-row page,
90-second sliding TTL and 20-query bound remain; results, allocation labels,
invoice selection and the accepted financial/issuance policies are unchanged.
The generated Service Worker includes both modules.

## Evidence

- Before editing production, `morning-catalog-policy.json` recorded eight
  original declarations with token digests. Unchanged presentation/query functions
  match semantic ASTs. Executed old/current metadata fixtures preserve successful
  cache and detail-fallback policy; existing immutable media/issuance/debt fixtures
  retain their original digests. Stronger identity validation and retryable null
  metadata are explicit behavior changes, covered independently.
- A real browser regression with the original browser module fails because a
  status for another operation authorizes a local debt link. The current UI
  rejects it without a journal write, then rereads and commits only exact verified
  metadata. Other native cases reject malformed search rows and foreign details,
  retaining Main/Shared records, financial progress and an unrelated note through
  reload.
- Model tests cover TTL/eviction, invalidation, account replacement, joined reads,
  pending metadata recovery, unknown payloads and disposal/drain. Strict actual
  bodies, negative consumers and implementation mutations protect the boundary.
  Existing metadata abort/relogin/commit-receipt tests remain in the full gate.

Synthetic metadata fixtures now include the real ledger operation identity;
the legacy detail fixture supplies the normalized amount/date returned by the
Edge Function. Assertions about durable receipts and financial effects are kept.
No RPC/SQL/issuance/retry policy or stored format changes. General form validation,
broader customer presentation and media status identity are separate work.
