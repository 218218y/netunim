# Local supplier invoice extraction

## Evidence and scope — 2026-10-27

The supplied private folder contains 41 PDFs and 46 pages, including a six-page invoice. The existing pinned PDF.js 6.4.299 runtime extracted usable text from every document. A split was recorded before inspecting field contents: 12 development documents and 29 acceptance documents. Original PDFs, text items, expected business values and authenticated Morning responses remain in the ignored local `.work/local-invoice/` folder; they are not public regression fixtures or CI logs.

Nine suppliers occur in the development set. The original six are joined by Comfort Yesharim, Cocktail and K. Royal. Several use the same issuing software, so shared layout rules are preferable to nine copied parsers. Some Hebrew is split into individual glyphs and some values are overprinted twice. Text positions and original items are retained separately from reconstructed search views.

The new extractor was then run in an isolated native Chrome browser on all 41 private files using the actual shared browser core/worker: 46 pages, zero errors, 9,309 ms aggregate extraction time and 430 ms maximum per file on this machine. This measures text/geometry extraction, not field-recognition accuracy. Private full results remain local. Focused Node tests cover extraction ownership, cancellation, timeouts, encryption, corruption/limits, rotation, Hebrew fragments, source mappings and the existing viewer/corpus behavior.

An authenticated read-only Morning search found invoice 3383 with the expected document date and gross amount. Its search projection omitted supplier tax ID; the existing writer treats a relevant number/type/year match with unknown supplier identity conservatively instead of silently skipping duplicate evidence. No real document was uploaded or created during this investigation.

Five historical Roya records contain numeric invoice numbers with inconsistent leading zero handling. This is not a paired proof that the new document's `s` prefix must be removed. Preserve `rawNumber`, keep any alternative separate, and require explicit review until a supported normalization rule is verified. Never convert invoice identifiers to JavaScript numbers.

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
