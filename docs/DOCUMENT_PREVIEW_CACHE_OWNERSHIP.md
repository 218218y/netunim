# Document match-text cache ownership

## Before-change evidence

Two deterministic regressions exercised the actual private server helper bodies
through parsed declarations, without starting the installed listener, Everything
or provider processes. The loader read a synthetic native text file and a
controlled promise held its first result.

1. A read captured `old`; result-path invalidation ran; a fresh read cached `new`
   with the same file fingerprint. Releasing the old read overwrote the new cache.
   The next production read returned `old`; the regression failed.
2. Two simultaneous requests with the same path/fingerprint called the native
   text supplier twice. The expected shared-extraction assertion failed.

The first is cache publication after invalidation, not evidence of business-data
loss. The second is redundant extraction. A PDF index upgrade can invalidate
match text without changing file size/mtime, so file fingerprint checks alone
cannot confer publication authority on an older fill.

## Contract and owner

`preview-text-cache.mjs` owns path normalization, per-fill authority, pending
coalescing, LRU/TTL and terminal disposal. Its API is `read`, `invalidate`,
`dispose`; construction receives a clock and the existing 10-minute/24-entry
policy. No timer, global service locator or provider retry is introduced.

- Same path/fingerprint requests share the currently owned pending promise.
- Each fill has an entry identity. Invalidation, a different fingerprint or
  capacity eviction retires that identity. Success and error callbacks compare
  the live entry before caching or removing it.
- An old completion cannot insert itself again or delete the replacement.
- No result, rejection or unavailable outcome triggers an implicit second load.
  Failed/unavailable entries are removed so a later explicit request can retry.
- TTL begins at successful completion and refreshes on cache hits. The existing
  strict `age > ttl` expiry boundary and case-insensitive Windows keys remain.
  Successful completion and reads refresh LRU order.
- Capacity includes owned pending slots. Eviction does not cancel already-started
  extraction; it only withdraws cache publication authority. This is not a global
  worker-concurrency limit.
- Dispose is terminal and idempotent. A loader not yet entered is prevented from
  starting. Already-started work settles for its original callers, without
  repopulating the disposed cache or aborting index writes already underway.

`server.mjs` retains supplier policy and its captured size/mtime/PDF search and
geometry revision fingerprint. Direct text, Everything content and AcroForm
priority, match counts/snippets/anchors and opaque-result authorization are
unchanged. Existing PDF update and result-path invalidation sites call the new
owner. Shutdown disposes it before awaiting process teardown.

Invalidation is a cache boundary, not cancellation of an accepted request's
already-read result. Browser request/display ownership remains separate. This
slice does not redesign persistent PDF index/journal writes, enforce an atomic
filesystem snapshot, or claim every concurrent index publication has been audited.

## Verification and installation

Tests cover the two before-change native reproductions, actual production match
responses, changed versions, old errors, self-invalidation during PDF upgrade,
LRU/TTL, shared errors, missing content, retained form geometry, stopped loaders,
100 simultaneous readers and 100 replacement cycles. Controlled promises and an
injected clock replace timing sleeps.

The strict JS gate checks the cache implementation and negative consumers. A real
implementation mutation assigning formatted text to numeric expiry evidence must
fail. Native file suppliers and full PDF normalization remain separate contracts.
The installer stages the new module before activation; full branch CI includes
native Windows startup plus the existing Browser/IDB/PostgreSQL recovery gates.

Activate the installed-server update by rerunning the updated
`install_document_bridge.bat`. The staged installer preserves its previous
runtime for rollback. Wire version, site assets, SQL and persisted schemas remain
unchanged.
