# Morning issuance reliability audit — 08.09.2026

## Findings fixed

1. **False-positive success after create** — the previous Edge code marked an operation `created` even when the canonical `GET /documents/{id}` failed. The new flow stores the returned ID as `created_unverified`, blocks every re-POST, and reports success only after the GET matches the reserved document.
2. **No durable proof of verification** — `verified_at` is now required by a database check constraint for every `created` row. Existing unproven successes are conservatively converted to `created_unverified`.
3. **Document-claim race** — the previous application-side “already claimed?” lookup had no account-wide database constraint. A unique `(environment, document_id)` index now prevents the same Morning document from being claimed by two operations/users in the configured Morning environment.
4. **Ledger update could silently affect zero rows** — Edge updates now require the reserved operation row to still exist.
5. **Morning outage hid local issuance state** — status now returns the durable ledger row with `available:false` instead of losing the operation state behind a connectivity error. Issuance remains disabled while Morning is unavailable.
6. **Official PDF required a manual click** — after verified issuance the browser now automatically streams a fresh official PDF through the authenticated Edge Function and shows it in the existing preview iframe. PDF failure does not cause a second issuance; it only leaves the manual “צפה” retry available.
7. **Verified-success second-click duplicate path** — the same dialog previously became active again after a successful verified create and rotated to a fresh operation ID. It is now locked on “הופק ואומת” until the dialog is closed and opened again. Replays of the same `operation_id` return the already verified operation and never issue another POST.
8. **Cross-user unresolved-race gap** — the Edge Function has one Morning credential pair per environment, but the old uniqueness boundary included the Supabase owner. Unresolved fingerprint locks and document-ID uniqueness are now account-wide inside that Morning environment, so two authenticated app users cannot race the same in-flight/uncertain payload into two documents.
9. **Rate-limit / error semantics** — safe Morning calls use bounded `Retry-After` backoff for 429. `POST /documents` never auto-retries on 401, 429, timeout or any other response. A 401 invalidates only the cached token so the next explicit operation re-authenticates; it never resends the issuing POST automatically. HTTP 408 and every 5xx on issuance remain `needs_reconciliation` because creation may be ambiguous.
10. **User deletion could erase the duplicate guard** — `owner_id` previously referenced `auth.users` with `ON DELETE CASCADE`. Deleting an app user could therefore erase an unresolved issuance row while the Morning document still existed. The ledger now retains the initiator UUID without a cascading FK, so issuance/idempotency evidence survives account deletion.
11. **Response-shape drift** — canonical document reads, linked-document validation and download links now accept both direct API objects and the common API-v2 `{data: ...}` wrapper while applying the same strict document verification rules.
12. **Unbounded transient PDF buffering** — official PDF downloads and preview base64 are capped at 20 MB and checked for the `%PDF-` signature before display; bytes are still never persisted.
13. **Reservation-before-POST crash gap** — the old `pending` state covered both 'DB row reserved' and 'Morning POST may have started'. A crash between those moments could leave a harmless pre-POST row permanently ambiguous. Issuance now uses an atomic `reserved → pending` claim; only `pending` may call Morning, `issuance_started_at` anchors reconciliation, and stale `reserved` rows can be conditionally released because they prove no issuance POST began.

## Existing protections retained

- DB reservation is created before `POST /documents`.
- The create POST is never automatically retried.
- Network, HTTP 408 and any 5xx ambiguity is reconciled by search + full-document GET rather than by re-POSTing.
- Reserved, pending, unverified and ambiguous identical fingerprints are unique across app users within the configured Morning environment. Verified content is deliberately released from fingerprint uniqueness; exactly-once after success is keyed by `operation_id`, so legitimate later documents with identical business data are not silently blocked.
- PDF bytes and signed download URLs are not persisted.
- Browser roles cannot read or write the issuance ledger; the Edge Function validates the Supabase user explicitly.

## VAT compatibility checked

The existing gross-price behavior is intentionally retained: document-level `vatType: 0` maps to `DocumentVatType.DEFAULT`, while income-row `vatType: 1` maps to `IncomeVatType.INCLUDED` in the OAuth-compatible `green-invoice` 2.0.0 model. This matches the UI's gross-amount input. No accounting enum was changed merely because another example used the default/pre-VAT row mode. A real Sandbox preview/create remains the final deployment check for this business.

## Current compatibility boundary

Morning remains the document system of record. The app stores no PDF and no full document copy; its ledger stores only the minimum identifiers and verification/idempotency metadata needed to prevent duplicate issuance and recover from ambiguous network outcomes. The current public API documentation is Morning API 2.0.0 with OAuth 2.0 client credentials and separate Sandbox/Production environments. Connection health probes the current documents resource (`GET /documents/types?lang=he`) and does not depend on a business-profile endpoint.

The fingerprint includes the document date plus visible/business-significant request fields, but it is an **unresolved-operation guard**, not a permanent business-content uniqueness rule. While a request is pending, known-but-unverified or ambiguous, an identical fingerprint is blocked account-wide. After canonical Morning verification succeeds, the fingerprint lock is released; only replay of the same `operation_id` is idempotent. This avoids both dangerous re-POSTs after uncertainty and the opposite accounting bug of forbidding a legitimate later document merely because its customer, amount and description happen to be identical.
