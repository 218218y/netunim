# Orders Bank snapshot publication ownership

Current update: archive execution and four model callbacks now belong to the
canonical shared Bank reconciliation capability. This publication owner has
five required ports; its verified algorithm and Orders readout policy are
unchanged. See [path alignment audit](BANK_PATH_ALIGNMENT.md). The following
record describes the original seven-port extraction.

Provider entry, automatic freshness and lease acquisition/cleanup subsequently
moved to the strict [Bank refresh operation](ORDERS_BANK_REFRESH_OWNER.md).
The historical controller scope below describes the original extraction stage.

The former Finance controller mixed provider/lease entry, archive reconciliation,
checks synchronization, financial model construction and durable publication.
The accepted provider-result sequence now belongs to
`domains/finance/bank-snapshot-publication.js`. Its seven required ports are
Checks, transactions, cheque images, archive read/publication, atomic snapshot
publication, the private financial policy and readable authority.

The two commands prepare Shared Checks and publish a Bank result. The owner
decodes both balances before archive writes, reconciles business then home,
awaits cheque image handling, joins the actual archive read owner, verifies source
coverage, prepares Checks again, builds the financial candidate and invokes the
existing atomic document command once. Only boolean readout confirmation grants
archive display publication. A confirmed commit with an unverified readout keeps
the existing warning; it does not repeat a provider scan or write.

The canonical task owner tracks preparation and the entire publication from
acceptance. Disposal is idempotent, rejects new commands and fences later stages
without abandoning accepted durable work. The captured lease guard combines
account, paired device and heartbeat authority; the publication owner adds its
own lifetime to the guard passed to transaction/document ports. Finance joins
its pending work and drain alongside connection, archive and presentation owners.
The controller still owns provider entry, automatic freshness, lease acquisition,
heartbeat/release and operator feedback. Its collaborator count is 18, down from
22. This slice does not complete financial provider orchestration.

`bank-snapshot-policy.js` retains account/feed/coverage, recurring debit history,
exact backfill audit, partial home retention and Checks sequence policies. It
cannot call providers, acquire leases or publish documents. The immutable
before-extraction fixture is from `3d8b29d9fe5f6b2461308c3b6e8f656757927997`.
Tests reconstruct the actual controller/model/publication AST and compare it to
that full original workflow; deliberate reconciliation, backfill and publication
mutations fail. The older financial/issuer preservation fixture remains intact.

Strict checkJs checks the actual execution owner, its seven ports, Bank-only
lease input, synchronous guards, numeric sequence, boolean publication and
asynchronous drain. Negative consumers and actual implementation mutations
protect those contracts. Complete RPC/transaction payloads and the retained
financial policy are not yet a full strict type proof; they remain covered by
the immutable algorithms, production document decoders and behavior tests.

Focused models exercise accepted work and scope/disposal at six stages, partial
home results, unknown confirmation, image warning and Checks barriers. Twelve
registered native browser scenarios change device/account or dispose during
reconciliation, archive read, the final Checks read and atomic publication.
They join accepted work, preserve both real Main/Shared IndexedDB journals and
recover the exact note through a fresh runtime. Existing full CI also covers
real PostgreSQL, lost ACK, lease renewal and archive sibling failures.

The controller's flat Checks, transaction and image publication dependencies,
their silent defaults, embedded model helpers and direct atomic publication
are retired. No forwarding compatibility facade remains. Active persisted
record/backup readers and deployed migrations remain unchanged; using the
current executable does not prove historical stored records are obsolete.

There are no schema, persisted format, RPC, provider, retry/fallback, Bridge
version or installer changes in this slice.
