# Orders Bank refresh operation

The Orders Finance controller now submits a Bank refresh command and presents
its observations. `domains/finance/bank-refresh.js` owns the accepted operation:
cloud freshness, lease acquisition, freshness recheck, supported Bridge status,
Checks preparation, Finance head/history selection, provider scan, existing
snapshot publication and joined lease cleanup.

Its six required APIs are account authority, cloud reads/freshness, paired
device, leases, snapshot publication and automatic scheduling policy. The body
has strict checkJs contracts. Finance rows and provider results remain unknown;
the existing balance/publication decoder supplies financial authority. Passive
device status, a lease grant or runtime drain cannot supply a snapshot ACK.
Synchronous presentation callbacks observe start, denial, confirmed publication
and failure; they do not supply financial confirmation.

Bank has its own instance of the existing lease owner, rather than borrowing
Credit's instance. The refresh owner tracks the complete command, including
preflight before a lease exists. Disposal stops renewal immediately, fences late
completion and retains every accepted request for drain. Cleanup runs only after
the accepted provider/publication work settles, joins a pending renewal and
releases under the captured account authority. Pairing changes and disposal
retain same-account cleanup; account/login/leadership replacement leaves the
former grant to server TTL. Late rejected provider details are replaced by the
current scope error before presentation.

The private Finance composition binds all six APIs without reading startup
state. Its three scheduler/readout queries remain private to composition, and
the existing last-sync projection remains canonical in the controller. The
controller keeps admission/busy policy, archive display pause/resume and UI
messages. It no longer calls Bank providers, owns a Bank lease session or calls
the snapshot publication owner directly. Credit and manual financial edits
retain their existing independent policies.

## Preservation and verification

- An immutable full `refreshBank` AST was captured from main
  `cc99ff2456dd900202eb85fced0df514acdc7945`. Tests recompose the actual owner and
  actual controller callbacks and compare the original algorithm, reversing
  only explicit port substitutions and the added owner lifetime guard. The
  older lease and publication fixtures remain immutable and still pass.
- Characterization rejects altered automatic freshness, interactive/history
  scope, archive publication authority and unawaited cleanup. The policy still
  selects 365 days only for a manual uninitialized archive, otherwise 30 days;
  post-lease automatic freshness may skip a scan without repeating a provider.
- Focused owner tests hold eight asynchronous stages, replace account/pairing,
  join accepted renewal and cleanup, deny leases and retain private error
  fencing. Strict negative consumers and implementation mutations reject
  deferred authority, local-only cloud grants and fabricated publication.
- The registered native Bank lifecycle suite now holds preflight, acquisition,
  status and provider in addition to transactions, archive, Checks and atomic
  publication. All eight phases exercise pairing/account/disposal, exact real
  Main/Shared IndexedDB retention and fresh-runtime recovery. The existing
  full CI remains required, including PostgreSQL and Windows.

This completes Orders Bank provider coordination for the existing refresh path.
Orders Credit and Kupa Bank/Credit provider coordination, broad Finance command
validation, Calendar/Customers and the remaining Bridge packages stay open.
There are no RPC, persisted data, migration, retry/fallback, issuer or Bridge
protocol/version changes. Live bank access remains a separate rollout drill.
