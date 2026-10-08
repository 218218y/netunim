# Orders Finance operation ownership and publication

## Evidence

The original Orders controller continued Bank/Credit work after logout, account
change, same-user relogin and primary-tab loss. Thirty-six controlled regressions
failed before the change. Production browser composition/auth/logout/owner
transfer and real IndexedDB also reproduced successful Bank refresh after logout
while the provider response was pending. This proves stale success/publication;
it does not prove loss of production data.

Separate regressions proved an older parallel read replacing a newer Main/Finance
readout, archive publication before a failed Bank snapshot, a background archive
read bypassing snapshot confirmation, and missed memoized-view invalidation after
incident acknowledgement. Controlled resource tests also proved preflight lease
entry after stop, missing explicit logout/offline/disposal cleanup, and old
operation completion stopping an explicitly restarted new-login scheduler.

The publication review proved silent success on Credit readout failure and
successful deferred diagnostics reporting after their save failed. These paths
now distinguish confirmed remote commit, read-model publication and operator
warning. A readout behind the acknowledged Main/Finance revision cannot confirm
publication. No ACK, journal, SQL, serialization or network-retry policy changes
are involved.

## Ownership

The composition root supplies the existing canonical
`createFinanceOperationScope`. It captures connection mode, durable storage
owner, authenticated account and login epoch. Readiness/recovery and a matching
account owner are required. Writes also require the primary tab; archive/image
reads remain available in an authorized secondary tab. Main conflicts do not
block independently owned Finance data. Ordinary access-token refresh preserves
the epoch; an explicit logout/relogin changes it.

Bank/Credit preflight, lease claim/renewal, Shared Checks preparation, provider
result, archive/image transport, Finance/Kupa mutation, rebase, response body and
publication all retain the originating operation guard. Authenticated requests
carry it through the existing per-request retry guard. A former authorization
cannot renew/release its lease using a replacement account. The remote lease then
expires under its existing TTL. Scope errors cannot become optional image warnings
or cause structured provider diagnostics to be written under new authorization.

Manual card order/mapping, settlement-warning acknowledgement, cashflow settings,
credit reset and Bank incident/handled operations use the same ownership contract.
Local Bridge configuration/status is computer-owned and remains separate.
Morning orchestration and its callbacks remain a distinct owner requiring review.

## Read-model publication

Bank archive rows obtained during refresh remain a candidate until the scoped
snapshot and readout succeed. Starting Bank refresh invalidates an older display
query's publication permit and defers background archive publication. A failed
snapshot preserves the Last Known Good archive and readout.

Cache entries retain read authorization, rather than a temporary writer lease.
Coalescing requires both live authorization and matching account/feed targets.
The memoized projection includes an authorization/cache epoch. An older query
cannot replace a newer query or a committed snapshot; incident acknowledgements
invalidate the projection after confirmation.

Main and Finance readout revisions cannot regress within one publication owner.
A new authorization must read before reusing metadata fast paths. Post-commit
readout receives minimum Main/Finance revisions from the corresponding receipt.
If it cannot confirm them, the remote write remains committed, the old display is
retained and the operator receives a refresh warning. The controller's `true`
means the operation was confirmed remotely (or skipped because data was already
fresh or the provider was explicitly deferred by its existing cooldown); it is not evidence that Main/Shared journals are clean. A failed or
unconfirmed write returns `false`; no artificial ACK or rollback is performed.

## Automatic resources

`domains/finance/automation.js` owns future Bank/Credit starts through five ports:
access, preferences, last-sync query, commands and timers. It preserves four-hour
Bank freshness, daily Credit freshness and existing failure cooldowns. It observes
async timer failures, coalesces timer ownership, fences cancelled callbacks and
provides start/stop without starting a provider twice.

Logout, offline and connectivity disposal explicitly stop future starts.
Foreground/reconnect and verified login explicitly resume. A provider session
already started may drain its commit while its independent authorization remains
valid. Its `finally` cannot resurrect a stopped scheduler, and an old scope error
cannot stop a new scheduler that was explicitly started under a new login.

## Verification and limits

- `tests/orders_finance_operation_ownership.test.mjs`: 74 controlled regressions
  and contracts covering ownership, readout/cache races, manual settings,
  scheduler lifetime, stale body/pagination, revision confirmation, lost-response
  recovery and record identity.
- `tests/runtime_orders_finance_ownership.py`: Bank and Credit each run logout,
  account change, same-user relogin, secondary-tab loss, auth change during commit,
  network failure and server-commit/lost-response recovery in a disposable
  browser. Production auth/owner/recovery and Main/Shared IndexedDB are real;
  provider/Finance IO is injected. Each scenario checks Main journal equality,
  retained note ID/content and recovery after a fresh runtime. Lost-response
  recovery preserves Finance record IDs without another commit.
- Existing Finance models/settings/derivations, connectivity readiness, Bank
  security/deployment contracts, lint, graph and generated assets remain gates.
- Full CI includes Browser/PostgreSQL, two-tab/two-computer, offline/PWA,
  Main/Shared recovery and Windows verification. They complement the injected
  Finance scenarios; this is not a claim of live bank/issuer or production testing.

## Operator recovery

On authorization change, reconnect the matching storage account and refresh;
the prior result was not published under replacement authorization. On a lost
response, preserve the local data and explicitly refresh Finance before another
provider run: the server may already have committed the result. A post-commit
refresh warning means the remote commit is confirmed but the view needs another
read. Main/Shared conflicts retain their independent recovery/export workflow.
