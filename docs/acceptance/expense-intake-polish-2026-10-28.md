# Intake polish and source-queue identity — 2026-10-28

This follows the verified recent-loading and recognition changes merged in #357 and #358.

- Invoice-number fields show only confidence status and source navigation. Raw/normalized numbers remain in source evidence, full review warnings and confirmation.
- Paired fields align at the top, so help text does not shift invoice/date or description/allocation controls. The save button precedes full source warnings.
- Allocation has a green not-required state when the dated threshold is not exceeded or there is no VAT. Missing allocation warns only when the existing applicability policy says to check business conditions. Exactly 5,000 ILS does not cross the current threshold; 5,000.01 does. January–May 2026 and 2025 retain their own dated thresholds. Separate P/credit treatment does not generate an ordinary missing-number warning. Invalid provided numbers remain reviewable; a printed/manual nine-digit number is never described as tax-authority verified.
- The local-recognition details disclosure was removed; status, retry, explicit refill, OCR recovery and defer controls remain. The source queue is a permanently visible section, including queued documents during source recovery.
- A memory-only queue manager validates files and compares SHA-256 content. Exact copies, including renamed copies and duplicates within a batch, are skipped with a persistent notice. Same name/size with different bytes remains distinct. Duplicate-only additions work at the quota ceiling. Selection is bounded to20 files; retained unique files remain bounded to20/100MB. The scope is checked after each await, and account reset clears the hash cache. Validation/quota failure commits no partial addition. Reselecting an original for an existing financial operation retains its original recovery path and quota checks.

The duplicate notice is separate from recognition status, so a later PDF result cannot erase it. Manual edits survive duplicate selections. No new financial write, database migration, Edge Function or OCR engine was introduced.

The authoritative allocation reference is the [Tax Authority December2025 instruction](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf) and its [service guidance](https://www.gov.il/he/service/request-assignment-number-for-tax-invoice). Applicability also depends on the document, VAT and business conditions; the existing policy's strict greater-than comparison is preserved.

Acceptance covers exact/renamed duplicates, distinct same-name bytes, atomic validation failure, resource ceilings, cache reset, account fencing, retained manual drafts, open queue, removed disclosure, compact number hints, save/warning order, actual paired-control geometry at1440/390px, zero VAT, credits and dated threshold boundaries. Existing creation, original-byte recovery, OCR separation and PDF ownership suites remain required. All browser financial effects are synthetic; live Morning acceptance still requires a specific approved unrecorded invoice.

Deploy the complete Orders frontend and generated service-worker/cache headers from the verified commit. No backend deployment is needed.
