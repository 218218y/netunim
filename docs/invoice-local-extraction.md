# Local supplier invoice extraction

## Evidence and scope — 2026-10-27

The supplied private folder contains 41 PDFs and 46 pages, including a six-page invoice. The existing pinned PDF.js 6.4.299 runtime extracted usable text from every document. A split was recorded before inspecting field contents: 12 development documents and 29 acceptance documents. Original PDFs, text items, expected business values and authenticated Morning responses remain in the ignored local `.work/local-invoice/` folder; they are not public regression fixtures or CI logs.

Nine suppliers occur in the development set. The original six are joined by Comfort Yesharim, Cocktail and K. Royal. Several use the same issuing software, so shared layout rules are preferable to nine copied parsers. Some Hebrew is split into individual glyphs and some values are overprinted twice. Text positions and original items are retained separately from reconstructed search views.

The new extractor was then run in an isolated native Chrome browser on all 41 private files using the actual shared browser core/worker: 46 pages, zero errors, 9,309 ms aggregate extraction time and 430 ms maximum per file on this machine. This measures text/geometry extraction, not field-recognition accuracy. Private full results remain local. Focused Node tests cover extraction ownership, cancellation, timeouts, encryption, corruption/limits, rotation, Hebrew fragments, source mappings and the existing viewer/corpus behavior.

An authenticated read-only Morning search found invoice 3383 with the expected document date and gross amount. Its search projection omitted supplier tax ID; the existing writer treats a relevant number/type/year match with unknown supplier identity conservatively instead of silently skipping duplicate evidence. No real document was uploaded or created during this investigation.

Five historical Roya records contain numeric invoice numbers with inconsistent leading zero handling. This is not a paired proof that the new document's `s` prefix must be removed. Preserve `rawNumber`, keep any alternative separate, and require explicit review until a supported normalization rule is verified. Never convert invoice identifiers to JavaScript numbers.

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
