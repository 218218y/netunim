# Morning OCR contract and release evidence

Verified 2026-10-27 against the [official bundled OpenAPI](https://developers.morning.co/docs/openapi.bundled.json).
Downloaded specification SHA-256: `3bef33e78e855b6fdecd9cdced0da409523dee4d3dfe1265b0d2c7911ecfc823`.

## Supported boundaries

| Operation | Evidence | Application policy |
| --- | --- | --- |
| Obtain upload form | `GET /file-upload/v1/url?context=expense&data={"source":5}` | Separate OCR opt-in; never an expense creation |
| Upload PDF/image | Signed S3 multipart POST, file last, 204 accepted | Acceptance proves receipt for asynchronous processing only |
| Read drafts | `POST /expenses/drafts/search`, creation-date range, 1-based provider pages | Bounded server search; do not infer order |
| Draft fields | `ExpenseDraft` and `DraftExpense` schemas; fresh Sandbox read of three existing synthetic drafts | Suggestions only; supplier identity requires canonical lookup |
| Parsing event | `expense-draft/parsed`, `WebhookExpenseDraftParsed` | Described by provider; not an authenticated application signal until webhook origin/signature and upload correlation are verified |
| Upload tracking | `uploadTrackingId` in parsed/declined event schema | No documented request parameter to choose this ID and no documented mapping from signed upload form to this field |
| Update/approve a draft | No corresponding public OpenAPI path | Blocked; expense close/open cannot substitute |
| Preserve source after approval | No supported approval contract found | Unverified; no separate expense creation from an OCR draft |

The upload form expires after 60 seconds. The application uses a shorter deadline, copies every signed field unchanged, and never retries delivered forms after an uncertain result.

## Actual Sandbox observation

On 2026-10-27 an isolated transport explicitly pinned to Sandbox read the three pre-existing synthetic PDF drafts and obtained a new unused upload form. It uploaded zero files and made zero financial writes. Production configuration and credentials were not changed.

The sanitized fixture is `tests/fixtures/morning-ocr-sandbox.json`. Its structure and numeric values came from canonical responses; IDs, names, classifications and private URLs were sanitized. Fields absent from a real response were not populated during sanitization.

Observed draft keys: `businessId`, `id`, `status`, `creationDate`, `lastUpdateDate`, `expense`, `reportingPeriod`, `hasDefaultValues`, `url`, `thumbnail`.

Observed expense fields relevant to mapping: `documentType`, `number`, `date` when present, `reportingDate`, `currency`, `currencyRate`, `amount`, `vat`, `description`, `supplier`, `accountingClassification`. Supplier tax ID was absent from these responses; the application must leave it unknown. `fileKey` and `fileHash` were also observed but are not part of the published `DraftExpense` schema. Their correlation with the uploaded source still requires an isolated acceptance test.

`hasDefaultValues` was both true and false among status-10 records. Neither flag is an authenticated completion event. `draftRecord` therefore always returns `parsingVerified:false`, `reviewRequired:true`, `approved:false`, and `supplier.verified:false`. It does not invent a PCN classification or replace source VAT with a percentage. Missing or invalid money remains unknown; net cents are derived only from an explicit valid gross/VAT pair.

## Outstanding provider questions

1. Which supported request/response field binds an upload operation to `uploadTrackingId` or a draft ID?
2. What authenticates parsed/failed/infected webhook deliveries, including replay detection?
3. Is there a supported read endpoint exposing parsing completion independent of status 10?
4. Can an existing draft be edited and approved through a documented API, and which ID identifies the final expense?
5. How does that operation retain the source file, and how are uncertain approvals reconciled without replay?
6. If approval is unavailable, what supported operation closes or resolves the source draft?

No message has been sent to Morning. Until these contracts are verified, OCR review must lead to manual completion in Morning and must never call the regular expense writer.

## Source correlation acceptance

A subsequent isolated Sandbox probe uploaded one new synthetic 790-byte PDF. S3 accepted it with 204. A later canonical draft search returned one draft with amount 118 and VAT 18. Its `fileKey` did not equal the resolved signed-upload key, and its 32-character `fileHash` did not equal the uploaded file's MD5. Using either of those as a content identity would have failed.

Downloading the source from the canonical draft URL returned HTTP 200 and exactly the original 790 bytes: both SHA-256 and MD5 matched. The application uses exact source size and SHA-256 for correlation, with a strict provider/environment URL allowlist, redirects disabled, no credentials, a streamed byte limit and a timeout through body consumption. It never exposes the source URL to the browser or trusts a browser-supplied URL. Candidate identity, status and apparent invoice contents alone are insufficient. Multiple content-identical candidates remain ambiguous.

This proves source-byte correlation for this synthetic PDF, not parsing completion, approval, complex/poor scans or the full OCR acceptance matrix. The new draft remains unapproved in Sandbox. Evidence: `docs/acceptance/morning-ocr-source-2026-10-27.json`.

## Deployment and rollback

Deploy the `morning-expenses` function to publish the additional read fields. No schema or credential change is required for the projection. Existing clients ignore additive fields; rollback can use the previous function version. The regular manual intake, P supplier protections, source attachment and income-document connection retain their existing contracts.
