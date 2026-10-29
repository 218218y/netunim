# Expense approval, progress and original-file recovery

## Proven findings

The approval dialog was delayed by local/OCR lookups, account duplicate searches and source hashing. These now run after a short general approval; validation that needs no network still rejects invalid input first. Material source conflicts retain a separate explicit review. The source/fields remain the place for verifying values.

The reported `ERR_ALPN_NEGOTIATION_FAILED` identifies a failed network protocol negotiation in [Chromium's error definitions](https://chromium.googlesource.com/chromium/src/net/+/refs/heads/main/base/net_error_list.h). It does not identify the failing network intermediary or prove a moved file. The old selection retained a disk-backed File. [File API](https://www.w3.org/TR/FileAPI/#file-error-read) permits read errors after file moves or modifications. Selection now fully reads and validates bounded bytes once and constructs an owned File before accepting it into the queue. Later disk changes cannot change that owned source. Bytes remain in memory, never in browser persistent storage.

## Delivery and recovery contract

Production source delivery uses the authenticated expense service with a binary body. The handler authenticates before consuming the body, limits actual streamed bytes to 20 MiB and keeps the existing 16 KiB JSON limit. The server verifies the source SHA-256, size/type, owner/environment, canonical expense identity and status, then uses the existing CAS preparation/ticket transitions to deliver the official signed multipart form. Browser-to-S3 TLS/CORS is no longer on the Production attachment path. The server uses fixed validated S3 endpoints, omitted credentials, rejected redirects, a timeout and file-last encoding. No PDF bytes are persisted in Supabase.

Financial verification, accepted source delivery and canonical source-byte verification remain distinct. Network/ack uncertainty never resends automatically. Source status still requires a canonical file and exact original hash/size. A mismatch stops advancement.

The user can explicitly retry source attachment to the **same existing expense** after the old preparation expires and a new canonical read still shows no file. The original bound hash/size/type and the old generation must match. CAS permits only one concurrent retry. Consent time, previous generation and retry count remain in `source_review`; no schema change is required. A late provider job can result in two deliveries of the identical bytes to the same expense; this action cannot create a financial record or attach a different source. The UI explains this before consent. It does not claim proof that an earlier transport error delivered nothing. Existing files are verified rather than replaced. Reported/deleted/changed expenses cannot receive a new source through this path.

## User feedback and document access

A progress surface shows checks, financial creation/readback, source delivery and source verification, with a running elapsed-time indicator and reduced-motion support. It owns and releases its timer on completion, failure, account change and disposal. The source remains viewable while work runs. Only fully verified work advances automatically; failures keep the existing operation and original file.

Both expense tables have an accessible source-document button in the number cell. It performs a read-authorized canonical lookup on demand and opens only the allowed Morning download origin/path. Signed URLs are not added to list data or persisted snapshots. The popup is opened in the user gesture, detached from its opener, and closed on failure or account cutover. Missing files are explained without changing the expense.

## Validation and deployment

Focused models cover authentication/stream size, bound bytes, server-only delivery, CAS races, expiry/generation gates, wrong source rejection, explicit retry audit, existing-source preservation, short immediate approval, owned bytes and temporary document links. Native desktop/mobile coverage holds duplicate checking while verifying that approval has already appeared and the progress timer remains live; it then exercises relay delivery, pending state and explicit same-expense retry without another financial POST. Existing VAT/P, queue, recognition, composition and recovery regressions remain required.

Use full CI for the exact revision, deploy `morning-expenses` with its new `relay.js` import, then deploy and verify both sites. Keep Production OCR creation/finalization disabled. No income-document connection or financial writer is changed. Existing source uncertainty is preserved; do not manually reset journals or recreate expenses. A rollback should restore client and function together while retaining financial/source journals.
