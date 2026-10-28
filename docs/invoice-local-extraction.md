# Local supplier invoice extraction

## Evidence and scope — 2026-10-27

The supplied private folder contains 41 PDFs and 46 pages, including a six-page invoice. The existing pinned PDF.js 6.4.299 runtime extracted usable text from every document. A split was recorded before inspecting field contents: 12 development documents and 29 acceptance documents. Original PDFs, text items, expected business values and authenticated Morning responses remain in the ignored local `.work/local-invoice/` folder; they are not public regression fixtures or CI logs.

Nine suppliers occur in the development set. The original six are joined by Comfort Yesharim, Cocktail and K. Royal. Several use the same issuing software, so shared layout rules are preferable to nine copied parsers. Some Hebrew is split into individual glyphs and some values are overprinted twice. Text positions and original items are retained separately from reconstructed search views.

The new extractor was then run in an isolated native Chrome browser on all 41 private files using the actual shared browser core/worker: 46 pages, zero errors, 9,309 ms aggregate extraction time and 430 ms maximum per file on this machine. This measures text/geometry extraction, not field-recognition accuracy. Private full results remain local. Focused Node tests cover extraction ownership, cancellation, timeouts, encryption, corruption/limits, rotation, Hebrew fragments, source mappings and the existing viewer/corpus behavior.

An authenticated read-only Morning search found invoice 3383 with the expected document date and gross amount. Its search projection omitted supplier tax ID; the existing writer treats a relevant number/type/year match with unknown supplier identity conservatively instead of silently skipping duplicate evidence. No real document was uploaded or created during this investigation.

The initial historical Roya search alone showed inconsistent leading zero handling and could not prove how the source prefix should be normalized. The paired July–August comparison below subsequently verified a prefix-only rule. Invoice identifiers always remain strings.

### Reported July–August corpus and verified normalization

The additional private folder contains 74 PDFs and 81 pages. Native browser extraction completed in 12,372 ms aggregate with a 378 ms maximum per file. Five PDFs contain no text and require manual review or an explicitly chosen supported OCR route. The combined corpus is 115 files and 127 pages.

The first split was subsequently refined transparently: one initially unknown September–October layout and six July–August examples used to investigate missing fields, paired normalization and a trailing annex were moved to development. The final development set has 19 documents; the remaining 96 are acceptance documents. This is not a claim that failed cases remained untouched holdouts after rule changes.

Paired source PDFs and authenticated, read-only Morning records verified these rules: Roya removes exactly lowercase `s`; Gaber removes exactly `SI` or `CR`. Prefix rules apply only to that supplier profile. The original string remains in `rawNumber`, the proposal in `suggestedNumber`, and `effectiveNumber` remains unset until user review. Leading zeros are retained, as explicitly requested by the user. One historical Roya record omitted a zero; this is a duplicate-comparison discrepancy, not permission to trim zeros or rewrite historical records. Unverified alphabetic formats retain their original value and require review.

Ten profiles now share seven layout families. Public profiles contain business aliases and hashed issuer-tax fingerprints, not the source invoices, customer details or literal tax identifiers. Supplier identification checks issuer position, recurring recipient boundaries, name/template evidence and a known fingerprint. A logo-only Gaber template uses its explicitly labeled issuer footer and matching layout; the display name comes from the profile and remains a suggestion pending canonical supplier matching. SAP documents keep issuer and buyer columns separate.

Each field carries its original value, proposed value, method, page, item index, bounding box and `verified`/`review`/`missing` extraction status. This is not financial approval or Tax Authority validation. VAT rates are excluded from monetary candidates, and explicit source VAT is preserved. The last complete summary page is selected rather than assuming a physical last-page annex is a financial summary. Totals from different pages are not combined. Multiple document identifiers, inconsistent amounts and ambiguous allocations require review. Derived net is explicitly labeled.

### Acceptance measurements

Sanitized measurements: [invoice-local-recognition-2026-10-27.json](acceptance/invoice-local-recognition-2026-10-27.json).

| Reference group | Documents | Result |
| --- | ---: | --- |
| Original source holdout, independent PyMuPDF summary/word reference and operator-reviewed document families | 28 | Number, date, net, VAT, gross and allocation: 28/28 each; zero wrong values labeled verified in those comparisons |
| Reported holdout with canonical Morning records | 63 | Date, type, net, VAT and gross: 63/63 each |
| Reported holdout number formatting | 63 | 62 exact matches; one historical missing leading zero, preserved in the source-derived proposal |
| Image-only holdout | 5 | No guessed fields; manual/OCR review required |

Supplier canonical resolution remains a separate server read; allocation absence counts as correct only when the source reference is also empty. Two development Gaber invoices differ from historical Morning VAT by one cent. Their printed VAT was visually checked and is retained; no existing financial record was edited. The acceptance evidence separates source extraction from agreement with a historical entry. It does not imply coverage of every future supplier or legal scenario.

Public synthetic regressions cover all ten profile layouts with fake identities and new values, multi-page and trailing-annex summaries, mixed documents, fragmented text, percent/amount separation, source provenance, ambiguous allocations, supplier-versus-buyer identity and dated allocation boundaries. No private PDF or full invoice text is committed or emitted in CI.

## Shared PDF runtime and resource ownership

`shared/document-search/domains/documents/pdfjs-core.js` loads only the pinned core and worker, checks exact version/build and current-browser features, and retries a failed load. The search viewer reuses this loader before loading viewer components/CSS. The invoice extractor does not import the search viewer or its UI.

`invoice-pdf.js` accepts an in-memory PDF Blob, with the existing 20 MiB ceiling, at most 60 pages, 100,000 text items and 1,000,000 text characters. It processes pages sequentially, yields between pages, fences account/file cancellation and timeouts, cleans each page and destroys the loading task/worker on every outcome. It reads text only, with JavaScript evaluation and XFA disabled. Password protection, corruption, empty text and limit failures remain explicit manual-review outcomes.

`invoice-pdf-layout.js` preserves page, original text, PDF transform, original X/Y, normalized position, dimensions, direction, font, order and end-of-line metadata. It normalizes the dominant page reading rotation, reconstructs Hebrew search views from positions, groups nearby cells, and removes duplicate overprint only from search views. Character mappings retain the original source item indices. This foundation does not infer invoice values or create a Morning draft/expense.

## Allocation policy sources

The [Tax Authority's official allocation service](https://www.gov.il/he/service/request-assignment-number-for-tax-invoice) and [implementation instruction 01/2025](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf) specify date-dependent 2026 thresholds before VAT: strictly above NIS 10,000 from January 1 and strictly above NIS 5,000 from June 1. The published conditions also include a VAT component, an authorized-business recipient and the recipient requesting allocation; zero-rated/exempt-only invoices differ. The site will present an eligibility/review warning, not claim legal applicability or Tax Authority validation solely from a nine-digit format. Credit notes and protected P records require their own treatment. Existing allocations below a threshold are retained.

## Delivery stages

1. Shared core, bounded geometry extraction and source evidence tests.
2. Shared recognition rules, supplier profiles, exact cents, provenance and private acceptance measurements, with sanitized synthetic public regression cases.
3. Default local recognition in the existing intake, explicit review, canonical supplier matching and preservation of the existing financial writer and Morning OCR boundary.

Morning OCR remains separate, explicitly confirmed and Sandbox-only. Local selection/extraction must perform no upload or financial write. An unresolved Morning OCR operation must continue blocking ordinary expense creation for that source.

## Intake integration and final acceptance

`morning-expense-local.js` owns the selected file's cancellable extraction and in-memory proposals. `morning-expense-intake.js` reuses its existing form, canonical supplier reader, reporting-period logic, financial confirmation, durable writer, receipt and file attachment. PDF selection starts local recognition by default; source details distinguish original/suggested invoice numbers, computed net, missing/ambiguous fields and page references. Exact tax identity must resolve to one active canonical Morning supplier before automatic selection. All financial fields remain editable. One final financial confirmation covers source review; there is no per-invoice source-review checkbox. Direct and keyboard save paths retain the same pending/source-OCR guards. Explicit refill cannot overwrite edits made during asynchronous canonical reads.

`morning-expense-pdf-preview.js` renders one bounded page image through the same pinned core, with previous/next controls. It does not run PDF actions, links, annotation scripts or forms. The native browser/plugin iframe is replaced by raster-only images. Each render releases its document/worker; file/account/disposal cancellation releases the current image URL too. Canvas allocation is capped at three million pixels and 4,096 pixels per side, with the same file/page limits and a 20-second processing timeout. This also displays image-only PDFs for manual reading without adding OCR.

`rawNumber` and `suggestedNumber` remain source evidence. The current string becomes `effectiveNumber` only after final financial confirmation, and editing invalidates it. Roya's leading zero is retained in the financial payload. A bounded read-only duplicate probe additionally checks the historical zero-less spelling only for the same recognized Roya tax identity. Invoice 3383 is also blocked by the normal exact identity/number/type/year checks. The server's existing financial deduplication and recovery mechanism is unchanged.

`ocr_lookup` reads the existing environment-scoped OCR journal by file SHA-256. It performs no reservation, revision change, upload, provider call or financial write. Owner-authorized recovery remains available with new scans disabled. Other owners' operations return only an existence flag. A known or uncertain OCR source blocks ordinary creation, including a deferred scan or a renamed file. The lookup is repeated before financial confirmation and immediately before dispatch. Selecting Morning OCR cancels local processing; it still requires its separate explicit confirmation. This check covers scans tracked by this application's journal, not drafts independently uploaded outside the application. Existing server invoice deduplication remains the final financial boundary.

The private native-browser UI acceptance processed all 115 files using the actual pinned PDF core/worker and recognizer, with canonical Morning responses previously read from the account replayed as a read-only provider fixture: 110 recognized digital files, 110 exact canonical supplier matches, zero mapped-field discrepancies, five image-only manual outcomes, and successful blocking of the already-recorded invoice. There were zero real upload/financial calls. This validates the complete source-to-form path; it is not a financial Production acceptance test. Public desktop/mobile regressions separately exercise synthetic save/attachment, deferred OCR re-entry, edit/file/account races, native unknown-PDF fallback and cleanup. Sanitized UI metrics are in the acceptance JSON.

### Deployment and rollback

1. Retain/apply the existing `20261027110000_morning_expense_ocr_operations.sql` migration using the normal migration manifest/preflight. This stage requires no new SQL schema or changes to financial ledgers.
2. Deploy the updated `morning-expenses` function first, with the existing environment, expense credentials and read/write/upload flags. Do not change income-document credentials or enable Production OCR. Confirm `capabilities.ocrFileGuard` and an authorized, environment-pinned `ocr_lookup` for an unused synthetic hash.
3. Publish the matching Orders static assets/service worker through the existing deployment workflow. An older function still allows local text review but blocks PDF-backed creation until the durable OCR-source guard is available. Ordinary manual intake without a PDF remains available.
4. Review a selected local source, canonical supplier, explicit VAT and preserved number. No live financial creation is required to verify extraction. Any actual expense is submitted only through the existing explicit financial confirmation and attachment/readback sequence.
5. For rollback, restore the previous matching static release and retain a compatible recovery-capable function and all OCR/financial journal rows. Pending/uncertain uploads are never cleared or replayed. Disable new Sandbox OCR separately if needed. Finish existing Morning drafts in Morning; local-only extraction has no remote state to undo.

The five image-only PDFs require manual entry or a separately authorized supported OCR path. No image OCR engine was added. Approval/editing of Morning drafts through API remains blocked pending the official contract and isolated acceptance; Production OCR remains hard disabled.

## Source comparison and deployment completion

The user subsequently confirmed two additional supplier-specific accounting number rules on 2026-10-27: remove exactly `SI` for Comfort Yesharim and exactly `CR` for Cocktail when followed solely by digits. The two supplied sources were checked directly: proposed numbers are `266013068` and `267000351`, respectively. Raw source strings remain intact and all leading zeroes remain strings. These rules are user-confirmed; they are not represented as a paired historical Morning proof. The user confirmed that these two documents have not been entered yet.

The source PDF appears above compact recognition details, aligned with the existing form. The queue and technical source details remain collapsible beneath the preview. There is no extra review checkbox. The prior disabled checkbox was caused by a confirmed deployment mismatch: Production function version 22 returned no OCR-source guard capability, and the OCR journal migration was absent. Source-OCR checks remain fail-closed; deploy the reviewed migration and matching function before publishing the final site.

Recognition now retains PDF-space glyph-run corners (including font ascent/descent). Raster overlays project those corners through the actual page viewport, preserving rotations/crop offsets. All located field values on a page receive a pale yellow marker; the current field has a stronger marker. Navigation follows supplier, document type, number, date, net, VAT, gross and allocation, automatically crossing pages and scrolling inside the source pane. Computed net highlights the gross/VAT source values instead of inventing a printed net location. Zoom preserves overlay alignment. Missing source geometry yields no guessed marker.

A pure integer-cent plausibility check compares explicit VAT with the existing 18% ordinary / 16% P estimate. Differences up to ten agorot are treated as small rounding differences. Larger differences are displayed beside the amounts and repeated in the existing final financial confirmation, including the estimate and difference. Mixed/exempt/atypical VAT is not overwritten or rejected solely for differing from that estimate. Net plus VAT must still equal gross exactly under the existing financial validation. Both historically observed one-cent discrepancies agree with the prior calculation from gross; printed source VAT remains authoritative.

Public tests cover source-corner projection under rotation/cropping, field order, computed-net source evidence, exact VAT estimates/tolerance, no redundant checkbox, native multi-page source overlays, result scrolling and zoom, cancellation and final-confirmation behavior. Full CI remains mandatory before publishing. Original invoices and screenshots remain private.


### Recognition and current-draft review (2026-10-28)

Local results distinguish `no_usable_text`, `unknown_supplier`, `partial_recognition`, `recognized` and technical `extraction_error`. Character count is only an extraction signal: invoice/credit identity plus numeric evidence, or monetary totals with invoice labels, distinguish usable invoice text from scan captions and page numbers. No image OCR engine was added. JPG/PNG explicitly require manual entry.

Empty proposals never fill the form. Re-recognition preserves manual changes; explicit refilling retains its existing confirmation. Partial local suggestions only copy present values. Source proposals retain raw and normalized document numbers, while a separate in-memory edit map records manual and calculated draft fields and survives file-draft restoration. Current draft supplier/date/amounts drive review and allocation notices; changing the supplier invalidates confidence in fields from the previous supplier. Nine-digit allocation numbers are never described as tax-authority verified.

All eight core fields have adjacent textual status (`זוהה במסמך`, `דורש בדיקה`, `לא זוהה`, `הושלם ידנית`) with `aria-describedby`, a source jump when coordinates exist, and keyboard review navigation. Amount dependencies are marked calculated, not manually verified. One final confirmation includes current review warnings. Native date parts and supplier combobox are included. Field-status updates do not recreate the form while typing; general re-renders restore field focus/selection and scroll. Multi-page extraction reports progress; the existing lazy PDF.js core is reused.

No database schema or financial write/attachment protocol changes are required.
