# Automatic expense source completion

## Confirmed cause

The client sent a signed multipart POST directly to Morning's S3 bucket using the default Fetch CORS mode, then required a readable HTTP 204 response. An Origin/POST OPTIONS probe against the actual Production bucket returned HTTP 403, `CORSResponse: This CORS request is not allowed`, and no `Access-Control-Allow-Origin` for the Orders origin. No file was submitted by that diagnostic. The user's console showed the same missing response header. A simple form POST can already have reached the bucket when the browser rejects access to its response; therefore a Fetch error does not justify resending it.

The earlier live acceptance used authenticated Node transport and did not reproduce browser CORS enforcement. Native Chromium coverage now exercises the actual Fetch boundary with a synthetic HTTP 204 response lacking CORS headers, supplied by CDP interception before any external connection. The expected browser result is opaque and unconfirmed, rather than a fabricated acceptance receipt. [Fetch CORS behavior](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#making_cross-origin_requests) and [S3 signed browser POST forms](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTForms.html) explain the transport distinction.

## Resulting workflow

One reviewed financial confirmation creates and reads back the expense, sends its existing signed upload form once, then polls canonical source status. The signed form uses write-only browser delivery, exact approved endpoints, omitted credentials, no custom headers and file-last encoding. Redirect form policies and non-204 success policies are rejected before delivery. Native Fetch requires `redirect:follow` for `no-cors` even without a redirect; the site's existing `connect-src` restrictions remain in effect. This browser requirement is covered by native transport testing and the [Fetch Standard](https://fetch.spec.whatwg.org/#main-fetch). An opaque response does not call the accepted-upload acknowledgement. A lost response is reconciled without replay. Completion still requires the server's bounded canonical download, SHA-256 and size comparison against the source intention already reserved before financial dispatch.

Only verified financial and source outcomes release the current file and start recognition of the next queued PDF. Advancement waits until the current busy task finishes so next-file recognition can fill normally. A separate completion notice survives subsequent recognition messages. Manual intake without a file needs no artificial attachment step. A pending or conflicting source remains selected, retains durable recovery and explains what to do. Reads have ten bounded attempts with increasing delays (89 seconds of pauses plus request time); long provider processing remains recoverable from the same operation. Account/screen disposal fences every stage and interrupts the polling pauses within 250 milliseconds.

The old upload/check-source buttons are replaced by one recovery continuation when required. Opening a server pending row starts status reconciliation. Reselecting its original file automatically checks its bound hash before any upload preparation. Trying to open another row while one is unresolved now explains the blocking operation rather than showing an inert disabled control. Ordinary completion no longer requires opening the pending-source list or clicking Next.

## Scope and evidence

- Focused models cover opaque acceptance semantics, delayed proof, lost responses, mismatch, bounded pending results, no financial replay, preparation failures and account cancellation.
- Native desktop/mobile tests cover one confirmation, double-click fencing, one upload, delayed proof, automatic next-file filling, pending stop and read-only recovery. The native transport test intercepts every synthetic S3 POST; it makes no real upload or financial creation.
- Existing manual/VAT, local extraction, OCR separation, source recovery, work-draft and account-isolation regressions remain required.
- Readback of the two user-reported operations found both financial intents verified and both source files linked with exact hashes. Status reconciliation updated their existing journals; it created no expenses and uploaded no files. Their private identifiers and original documents are excluded from Git.
- `card-injection.js` cannot be attributed from the supplied stack alone. The S3 CORS defect is independently reproduced; no extension behavior is assumed as its cause.

No schema, financial writer, income-document connection or OCR Production activation is changed. The currently deployed source-verification service supports this client workflow. Deployment requires full CI for the exact revision, existing schema/function guards and live asset comparison. Rollback can restore the previous frontend without deleting journals or resending ambiguous requests.
