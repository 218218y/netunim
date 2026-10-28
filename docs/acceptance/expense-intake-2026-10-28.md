# Expense intake completion review — 2026-10-28

## Verified causes and scope

- Recent-expense reading stopped after four pages per invocation. The controller now continues bounded batches from one click, keeps progress separate from form busy state, supports cancellation and a five-minute run limit, and publishes only after a second full stability pass. Total changes, duplicate/missing pages and same-count content changes are rejected. Creation time remains the sort key. The current base already used `tasks.run` for history/recent reads; the claim that those reads used the global form lock did not apply to this checkout.
- The local PDF review attempted filling proposals without usable fields and did not distinguish no-text, unknown supplier, partial recognition or technical errors. Empty results no longer fill. Local partial fills preserve existing manual entries; missing date/type in an untouched form do not inherit defaults.
- Source confidence existed mostly in a summary. Eight adjacent field descriptions now distinguish printed evidence, missing data, review and manual completion. Current draft values drive amount/allocation warnings. Supplier changes revoke confidence from the prior supplier; original/normalized numbers and leading zeros remain evidence.
- A delayed proposal fill could finish while financial saving was in progress. Its final check now includes the financial operation state, before draft mutation. Manual provenance for fields absent from an explicit partial refill is retained.
- Provider transport already retries safe 429 reads and honors Retry-After. Client retries do not multiply those provider attempts. A cancelled older read's timer cannot abort a newer read.

## User interface

Each supplier/date/type/number/net/VAT/gross/allocation field has adjacent text and color: green `זוהה במסמך`, amber `דורש בדיקה`, red `לא זוהה`, blue `הושלם ידנית`. Computed amounts explain the calculation. Source buttons navigate to PDF coordinates when available. Supplier combobox and individual date parts reference descriptions through `aria-describedby`. One review-navigation button advances through uncertain/missing fields, including composite date input; initial automatic focus does not steal active editing. Final accounting confirmation includes current manual/calculated/missing warnings. Allocation labels explicitly do not claim tax-authority verification.

PDF page extraction reports progress. JPG/PNG display a manual-entry notice. The existing raster preview, lazy PDF.js runtime, durable writer, duplicate checks, OCR separation, source fingerprints and attachment recovery remain in place.

## Reproducible acceptance

Focused Node selection: all `tests/invoice_*.test.mjs` and `tests/morning_expense*.test.mjs`. The one-click matrix covers 0, 20, 50, 199, 200, 201, 250, 278, 1,000 and 10,000 expenses; the service ceiling is 50,000 expenses, above which no partial result is published. Cancellation/resume, safe retry limits, provider cooldown, stale account, same-count mutation and cache invalidation have regression tests.

Browser acceptance is included in the existing full CI inventory:

- `runtime_morning_expenses.py`: one click across 278 rows while typing, retained focus, no partial results, history search and financial flow, desktop/mobile and both environments.
- `runtime_morning_expense_local.py`: missing core fields, source statuses, ARIA associations, manual edits/re-recognition, no-text/unknown/error/image paths, final review warnings and keyboard date navigation; desktop/mobile. Original financial/OCR and native PDF ownership tests remain.
- `runtime_morning_expense_drafts.py`: manual provenance survives file round trips and catalog refresh; account changes clear it.
- Existing writer/upload/source/ledger/permission suites retain exact monetary readback, durable intent, byte verification, no blind financial POST replay, protected P suppliers and OCR conflict checks.

Full GitHub verification (including PostgreSQL, disposable Supabase and Windows) must pass the exact candidate before merge. PR #357 contains recent loading; PR #358 contains recognition, field review and the follow-up safety audit. Duplicate/superseded CI runs may be cancelled; required scenarios are not skipped.

## Deployment and remaining acceptance

Changes are frontend JavaScript/CSS plus generated service-worker shell/cache headers and tests/docs. No schema migration, Edge Function or new OCR engine is required. Deploy the usual complete Orders site assets so the generated service-worker cache and headers match the same commit.

No live Morning financial write, live upload or production rollout was performed in this review. All new browser financial scenarios use synthetic providers and isolated accounts; PostgreSQL/Supabase CI uses disposable services. Prior live evidence in other release documents is not current acceptance of these changes.

For final live acceptance, obtain explicit approval for one specific unrecorded business invoice, confirm account/environment and duplicate absence, then select PDF → recognize → correct → confirm → create once → canonical readback → attach source → verify both link and original SHA-256 bytes. Do not infer financial or tax approval from file presence. The actual document/authorized live session is not supplied here.

The API does not supply a transactional snapshot in the current client contract. Two full equal passes detect observed changes, but cannot guarantee that an external update will not occur after the last read. Very large/slow accounts may require an explicit resume after a time limit; no four-page manual continuation remains. PDF image OCR is intentionally outside scope. Current official documentation was checked at https://developers.morning.co/api; no new creation-time ordering contract was established, so no unsupported sort parameter was added.
