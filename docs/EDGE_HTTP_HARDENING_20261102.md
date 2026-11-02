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
