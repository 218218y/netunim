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
