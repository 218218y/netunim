# OCR review delivery and rollout

Implementation date: 2026-10-27. API findings and provider questions: [contract](morning-ocr-contract.md).

## Delivered behavior

The existing expense intake can upload its selected PDF to Morning OCR, show durable status, verify the source bytes, and fill the existing review form. The original preview and file queue remain available. No OCR text, invoice fields, file name or hash is persisted in browser storage: recovery retains only the version, application owner, environment and operation UUID. Data is fetched again from the server after reopening.

The active OCR operation blocks both the ordinary save button and direct/keyboard save commands. Editing suggested values does not update a Morning draft. The UI explains that final edits and approval must be completed in Morning. Explicitly deferring a document records it as pending, advances the local queue and clears all invoice values from the next form. The latest 20 operations can be reopened from server history; knowing the operation UUID also permits recovery of older records. A known file restores its original owner-scoped operation instead of receiving a second upload form.

Supplier selection requires an exact tax identity and a unique active canonical supplier, with matching OCR supplier ID when present. Similar names do not establish identity. In the observed Sandbox drafts tax IDs were absent, so supplier selection remains manual. Classification is filled only when its ID already exists in the site's canonical expense-derived suggestions. The current bimonthly reporting period is retained; OCR VAT is copied as explicit cents and never recalculated as 18%.

## Durable lifecycle and limits

`morning_expense_ocr_operations` is a separate service-role table. It stores operation/owner/environment, source SHA-256 and size, state/revision, provider business ID, ticket timestamp, a distinct `draft_id`, exact-source verification timestamp, bounded polling and explicit deferral. It stores no final `expense_id`, and neither deferral nor source verification claims accounting approval.

Each ticket issuance uses compare-and-swap. A delivered or uncertain form stays blocked, including after expiry, a missing upload ACK, browser restart or disabling OCR. Only a failure before delivery may release its own still-current issuance. Reservations for the same file are unique across users in the same provider environment; another owner's identity is not disclosed.

Each status check reads at most four draft pages, verifies stable totals/unique IDs, and considers at most three candidates in the original business and upload time window. Source downloads allow only the verified provider URL pattern, omit credentials, refuse redirects, enforce exact size and SHA-256, and time out through streamed body consumption. There are at most 20 checks per operation and a five-second server cooldown. The UI uses explicit checks and creates no background timer or webhook listener. Multiple source-identical drafts, changed pages, download failure, an exhausted search/poll budget or an unknown upload result require manual investigation; no second upload or financial POST follows.

`status:10` and `hasDefaultValues` do not establish parsing completion. Even a source-verified draft returns `parsingVerified:false`, `reviewRequired:true`, `supplier.verified:false` and `approved:false`. Partial suggestions can be reviewed, but missing fields are identified. A mismatched locally selected PDF blocks filling the form.

## Release status

| Path | Status |
| --- | --- |
| Existing manual intake, explicit VAT, protected P suppliers, source attachment | Retained; existing permission/write controls |
| OCR read projection and exact-source verifier | Implemented; synthetic Sandbox source evidence recorded |
| Durable OCR upload and review UI | Implemented; Node, isolated PostgreSQL and native browser acceptance cover it |
| New OCR scans in isolated Sandbox | Available only with a separate explicit flag and dedicated Sandbox expense credentials |
| New OCR scans in Production | Hard blocked in this version |
| Recovery/status after disabling scans | Available to the original authorized owner |
| Parsing-completion webhook | Not enabled; authentication/correlation contract remains unverified |
| Editing/approving a Morning OCR draft via API | Blocked pending a documented supported API |
| Separate final expense created from OCR values | Blocked to prevent an unresolved source draft and duplicate invoice |

## Deployment

1. Apply `20261027110000_morning_expense_ocr_operations.sql` through the normal reviewed Supabase migration process. The canonical manifest includes its LF-normalized SQL hash. Keep the journal across releases and account deletion.
2. Deploy `morning-expenses` and the matching Orders static site. The function adds capabilities and `ocr_*` actions; the site hides OCR against older functions. Income-document configuration is untouched.
3. On an isolated Staging/Sandbox deployment only, configure a complete dedicated expense credential pair, `MORNING_EXPENSE_ENV=sandbox`, `MORNING_EXPENSE_SANDBOX_OCR=true`, and server-owned read/write grants. Reusing either income credential fails closed. Do not switch the live expense deployment away from Production for a test.
4. Complete the outstanding acceptance matrix before a Production OCR rollout: poor/multipage scans, unknown suppliers, actual concurrent uploads, all P/credit/atypical-VAT variants, and the official parsing/correlation/approval contract. Production OCR cannot be activated by the Sandbox flag.
5. Existing production intake uses its existing flags. This change does not require a financial test on the live business account.

## Rollback

Disable `MORNING_EXPENSE_SANDBOX_OCR` first to stop new OCR forms. Recovery, source checks, history and explicit deferral remain accessible. A form already delivered to a browser can still be consumed until its provider expiry; do not delete/reset its journal row or treat expiry as proof that nothing was uploaded.

Revert the matching function/site pair if necessary, retain the new table and all pending records, and finish unresolved drafts in Morning. The manual intake and its separate write/upload flags remain available. Downgrading to a function without `ocr_*` removes in-site recovery; retain a compatible recovery-capable function while operations remain pending.

The isolated SQL and browser tests exercise actual local services/UI with synthetic provider responses. Provider evidence is separately labeled; passing mocked responses is not evidence of provider approval support or a completed Production rollout.

The [application Sandbox acceptance](acceptance/morning-ocr-application-2026-10-27.json) additionally exercised the actual OCR handler, S3 upload and source verifier against Morning using a persistent local JSON fixture journal. It deliberately omitted the upload ACK, restarted the process, disabled new scans and still obtained one exact-source draft link. A second ticket was rejected with 409; zero financial creation calls were made. This is not a deployed PostgreSQL/Staging end-to-end test. Two synthetic drafts were uploaded across the direct contract and application probes; neither was approved as an expense.
