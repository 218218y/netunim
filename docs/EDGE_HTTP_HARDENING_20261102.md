# Edge HTTP hardening, 2026-11-02

Baseline: `04ed38b0` (main), clean checkout. This continuation changes HTTP
admission and provider receipts only; it changes no financial command, storage
protocol, migration, RLS policy, installed Bridge or production deployment.

## Stage 1: authenticated JSON admission

The three production entrypoints previously called `req.json()` without a byte
limit. The new entrypoint tests failed against that baseline: an oversized open
stream timed out in all three functions and malformed JSON became an unknown
action. Authentication still precedes all input reads.

`_shared/http-input.js` now limits actual streamed bytes, rejects malformed UTF-8,
non-object JSON and unsupported media types, and cancels/relinquishes readers on
failure. Missing and understated Content-Length do not bypass admission. An
oversized declared length can reject early. Cancellation cannot hold the response
open. JSON errors are 400, unsupported media types 415, excess bytes 413, with the
existing CORS/no-store response envelope.

OAuth requests have a 16 KiB limit; they carry action/return URL only. Morning
documents have 256 KiB of headroom for document metadata and at most twelve
payments. PDF bytes are returned by the provider, not uploaded to this endpoint;
the existing separate 20 MiB PDF limit is unchanged. Morning Expenses already
owns its JSON/binary limits and is unchanged. No speculative PDF hostname
allowlist is introduced: real signed URL/redirect samples remain NOT RUN without
an isolated provider account. Never record signed URLs or credentials as evidence.

Local evidence: entrypoint admission regressions, existing Morning issuance and
read-permission regressions, and strict checking of the actual helper pass.
Full branch CI remains required before merging. Revert this stage to roll back;
there is no persistent-state conversion.

## Operational acceptance boundary

The existing Windows physical-client, installed Bridge/PWA/ACL, live provider and
weak-hardware matrices remain NOT RUN pending an isolated environment. Existing
synthetic CI, staged Windows and disposable Supabase tests do not close those
items. Historical LevelDB corruption remains UNRESOLVED. Bank Origin stays opt-in.
Production schema/grants/RLS verification remains mandatory before deployment;
branch CI is not a production postflight receipt.

## Stage 2: Google provider deadlines

Both OAuth functions now use one strictly checked HTTP implementation. Each
token exchange, refresh, account verification or revoke has a 15 second deadline
covering headers and body consumption. Timeouts abort the request, cancel readers
and return 504 for refresh; network/HTTP/protocol failures return 502 with a safe
reason. Callback failures redirect with a classified code and never upsert a
connection. No automatic retry is introduced. Explicit later attempts remain
possible. Provider response bodies are capped at 2 MiB, including chunked bodies.

Disconnect preserves its existing local-unlink contract; an additive `revocation`
receipt distinguishes confirmed provider revocation from timeout/failure. An
unconfirmed provider action is never represented as confirmed. Logs carry only
failure categories, not tokens or provider response bodies.

Twelve deterministic tests cover pre-header/post-header/account/revoke stalls,
explicit later retry, network/HTTP/protocol classification, oversized responses,
late responses after deadline and resource disposal. Existing JSON admission and
Google source contracts also pass locally. No live provider receipt is claimed.

## Stage 3: verified OAuth receipts and grant preservation

New entrypoint tests reproduced HTTP 200 with an empty token, ignored rotation
storage errors, ignored invalid-grant cleanup errors, coerced Calendar identity
objects and revocation immediately after replacement. Nine of ten regression
cases failed before this stage; all now pass.

Token/account JSON stays unknown until the checked implementation validates it.
Token publication requires a nonempty string access token and a positive integer
expiry; optional refresh token, scope and token type cannot have malformed values.
Rotation and invalid-grant deletion errors are observed before reporting their
outcome. Failed verification or persistence preserves the previous connection.
Actual body type mutations and negative consumers enforce the decoded contracts.
An additional interleaving regression reproduced an old refresh overwriting (or
deleting on invalid-grant) replacement credentials. Both mutations now compare
the captured refresh token in the database statement and require a returned row;
a changed connection produces 409 rather than changing replacement credentials.
These checks add no migration and no second credential store.

The callback no longer revokes a replaced token. Google explicitly documents
that [revocation removes project-wide OAuth grants and invalidates issued tokens](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
Thus the previous cleanup could invalidate the newly connected credentials and
the sibling integration using this same client/project. Replacing the stored
credential does not call revoke; explicit disconnect retains the existing revoke
behavior. No old secret is retained in a second store. Live consent/revocation
acceptance remains NOT RUN; the regression proves request behavior with synthetic
credentials, not a new live Google grant.

## Stage 4: PDF body lifetime and native transport evidence

An additional read-only regression proved Morning's PDF deadline ended at response
headers, leaving a stalled body unbounded in time. Its existing timeout helper
now accepts a response consumer; the PDF path alone uses it to keep the existing
20 second deadline active through the 20 MiB bounded read. Failed/oversized reads
cancel the body and release its reader, even if the sender's cancellation promise
never settles. Valid PDF/no-store/size/error behavior remains covered. Both new
PDF cases failed before this stage and pass afterward. This changes neither
issuance/financial retries nor the provider hostname/redirect policy. Morning's
other JSON transport consumers retain their previous timeout behavior in this
slice; changing their post-header timeout needs financial uncertainty coverage.

Two additional tests exercise the Google helper against an actual loopback HTTP
server with the real native fetch implementation, before and after headers.
Both prove timeout rejection, connection close and timer disposal; they use no
provider account or business data. Local Node 24.21.0 on Windows passes these
cases. They join the full CI model inventory automatically.

## Stage 5: Morning JSON deadlines with uncertainty coverage

Follow-up tests reproduced the same header-only deadline in Morning token/read/
write JSON consumption. The existing response consumer now covers these reads
too, preserving the existing 20 second budget and interruption classification.
The preceding Stage 4 limitation is closed by this stage.

Three direct transport regressions and an additional real issuance-handler case
failed before the change. They now prove that a stalled create response becomes
durable `needs_reconciliation`, and an explicit replay remains blocked without
another POST. Existing reservation, exactly-once, reconciliation, cents and
provider rejection tests pass. Token failure cannot produce an access token.
No amount, journal, operation-state schema or financial retry rule changes.

## Stage 6: single-use OAuth admission and captured connection lifetime

The 2026-11-03 continuation adds twelve entrypoint regressions. Ten failed on
`d7bc1fed`: concurrent callbacks both consumed one state, a non-rotating refresh
published after disconnection/replacement, and a delayed disconnect deleted a
replacement connection. An absent connection also caused an unnecessary delete.
The fixture forces the callback read interleaving and models atomic database
mutations; this is deterministic synthetic evidence, not live Google acceptance.

Both callbacks now use one DELETE RETURNING receipt for state consumption before
contacting Google. Only the request that removed the row may continue. Refreshes
without rotation verify the captured credential still exists before publishing
an access token; verification errors fail closed. Disconnect compares the captured
refresh token in its DELETE and requires a returned row. A replacement yields
409/connection_changed instead of false success or deletion. No connection means
idempotent success without Google or a write. Storage errors remain observable.

Explicit disconnect still invokes Google's existing project-wide revocation.
The local comparison protects stored replacement credentials; it cannot guarantee
that a concurrent Google grant survives external revocation. No distributed lock,
second credential store or new schema is introduced. Live concurrent consent/
revocation remains NOT RUN. Revert this stage for code rollback; no data conversion
is needed. Full branch verification remains required before merge.

CI exposed a timing flaw in the preceding Morning issuance regression: fifty
event-loop turns could expire before worker-pool WebCrypto finished. The fixture
now observes the real POST entry with a bounded ten-second wait before injecting
the deadline. It retains the same durable-uncertainty/replay assertions and does
not change production issuance or extend its timeout.

## Stage 7: actual OAuth database/API acceptance

The required full Supabase job now probes the same Google tables through real
PostgREST with disposable service credentials. Two simultaneous DELETE RETURNING
requests must return exactly one consumed state, and replay must return no row.
After replacement, stale credential reads/rotation/deletion must each return no
row while the new credential remains; a current disconnect must return its row.
Anonymous, owning-browser and foreign-browser roles are denied before the fixture
is removed. No migration, grant or production configuration changes are made.

The existing request port gains only an opt-in return=representation preference;
destination validation, redirects, isolation preflight and per-request deadlines
are retained. Reports record booleans and service names, never token values or
signed URLs. These are actual local Supabase API receipts with synthetic secrets,
not provider or deployed Edge-runtime acceptance. Run only on the attested
disposable Linux CI stack, never the workstation or a linked project. This stage
is NOT RUN until its exact source passes that job; compilation and local safety
contracts alone cannot certify it. Revert the added probe to roll back.

## Stage 8: provider deadline fixture admission

The same bounded local WebCrypto-delay experiment exposed two more scheduling
assumptions in the existing Google account-timeout tests: two event-loop turns
could expire before state hashing and before the account deadline existed. Both
cases timed out under a 100-turn digest delay. They now await observed account
request entry before injecting expiry, with a ten-second test bound. The same
delayed-digest experiment then passes all twelve deadline cases. No runtime code,
provider timeout or expected outcome changes. This preserves deterministic failure
injection rather than retrying flaky tests. Full branch CI is required to merge.
