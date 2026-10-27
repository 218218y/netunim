# Expense intake stability follow-up

## Verified defects and retained guarantees

The current queue called `selectNextFile()` on a source change and reset the form. The first PDF attachment also reset an already-entered manual invoice. This was reproduced by native browser tests, independently of provider writes. Work drafts now retain all fields, manual amount overrides, reporting period, canonical selections and local source evidence per queue entry, in account-scoped memory only. Returning to the same unchanged file rechecks its OCR guard and restores the draft without applying recognition over it. Catalog refresh also preserves edits. Removing an edited draft requires confirmation. Refresh/close warns about unsaved work; disposal/account changes release all drafts and source resources.

Local removal is explicitly labeled removal without saving. It creates neither an expense nor a durable follow-up task. The source file and financial recovery journals remain separate concerns.

The existing server already blocks matching supplier, invoice number, document type and source year, including changed dates/amounts inside that identity. This stronger accounting boundary must be retained. Financial operation IDs, unique ledger identities, CAS dispatch, no replay after uncertainty, protected P identities and income-document isolation are unchanged by the work-draft stage.

## Acceptance evidence

`runtime_morning_expense_drafts.py` exercises desktop/mobile round trips with distinct manual invoice numbers, dates, reporting months, net/VAT/gross values, allocation and canonical classifications; attaching a first PDF to manual input; catalog refresh; cancelled/confirmed draft removal; unload warning; no persistent invoice text; and account isolation. It performs zero real provider or financial writes. Existing PDF/OCR/manual regression suites remain required in full CI.

## Durable source and duplicate stage

`20261027150000_morning_expense_source_intent.sql` adds source SHA-256, byte size, type, source-review outcome and explicit exception timestamps/reasons to the existing financial journal. No PDF bytes or invoice text are persisted in browser storage. The source intention is reserved before financial dispatch. Owner-scoped, paged pending-source reads recover work even if the local operation pointer was lost. An unverified source blocks completion until byte verification or an explicit audited exception. Legacy operations with a requested upload remain visible without falsely claiming source verification.

`source.js` verifies the exact bounded source bytes read from the canonical provider download URL. File presence, accepted upload, source-byte match, financial-field readback and accounting/reporting approval remain separate facts. A wrong reselected file cannot replace a bound source. Previously delivered or uncertain upload tickets cannot be replayed. Manual semantic source checks are explicit and recorded; automatic text extraction is evidence for comparison, not a guarantee of accounting correctness.

The additive database trigger serializes OCR and financial reservations under the same environment/source hash. Accounting reservations also compare canonical supplier/type/source-year/number against legacy journal payloads. Comparison aliases preserve submitted strings, apply only reviewed supplier prefix policies and P/Roya zero aliases, and do not globally remove letters or zeroes. The provider search resolves supplier identities and blocks identical supplier/number/type/date/amount/VAT records before confirmation and again before dispatch; the existing stronger identity boundary remains intact. This coordinates this application's workers; it cannot atomically lock unrelated writes in Morning's own UI.

Material local recognition warnings and computed values appear above Save and in the final confirmation. Supplier-specific raw and suggested numbers remain visible. Reporting years from 2010 through the current year can be selected without changing the invoice date or bypassing server reporting validation. The current bimonth remains the default.

## Validation and deployment

Focused Node tests cover durable source intent through lost responses, exact source hashes, source-review validation, supplier disambiguation, alias scoping, unavailable pagination, read-only duplicate checks and upload uncertainty. Native desktop/mobile browser tests cover recovery from the server list after pointer loss, wrong-source rejection before any upload form, one-time upload, explicit exceptions, visible computed-value warnings and earlier-year reporting. PostgreSQL tests use separate real connections to race both reservation directions and legacy accounting aliases. Synthetic browser/provider tests are not live Morning acceptance.

Before publication, require the full CI for the precise tested revision, canonical migration postflight, deployment of `morning-expenses` with all relative source imports, and both sites' release verification. Keep Production OCR creation disabled. Roll back the frontend/function together if required; retain the additive migration and journals to preserve recovery. New creation/upload switches may be disabled independently of status, source verification, pending-source reads and explicit exception handling. No income-document connection is changed.

A real business invoice still needs a reviewed final financial confirmation and provider readback/source attachment acceptance. Do not claim a real financial write from mock results or perform an unreviewed production experiment.

The filtered [acceptance receipt](acceptance/expense-source-recovery-2026-10-27.json) records the private 115-file replay and actual isolated Morning Sandbox source-byte verification, including an earlier explicitly retired harness failure. Business PDFs, extracted text, provider identifiers and credentials are excluded from the repository.

## Production download origin correction

The post-merge read-only source check exposed a verified environment difference: the canonical Production expense response returned `https://www.greeninvoice.co.il/api/v1/expenses/download`, while the verifier allowed only the API origin. A temporary authenticated inspection, restricted to the existing pilot and operation owner and performing no financial POST, file upload or journal update, fetched that exact canonical URL and proved the original PDF's SHA-256 and 107,679-byte size. The previously approved source and the supplied folder PDF had the same hash; no replacement or re-entry was needed. The temporary inspection function was removed after diagnosis.

The final verifier allows precisely the observed HTTPS `www` origin alongside the existing Production API origin, retaining the exact download path, environment separation, no credentials/cookies, redirect rejection, size limit, timeout and byte hash check. Unavailable downloads now return a distinct retry/status error rather than being presented as a proven source mismatch. No signed URL, query token or source contents are returned. Public regressions cover both legitimate origins, lookalike domains, wrong paths/environments, credentials and redirects. Vendor identity is corroborated by [Morning's official site](https://www.greeninvoice.co.il/); the exact download behavior was proved against the account's canonical response, not inferred from its homepage.
