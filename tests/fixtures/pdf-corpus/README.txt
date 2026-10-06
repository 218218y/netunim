NETUNIM PDF.JS REGRESSION CORPUS

This directory is a fixed, checked-in PDF regression corpus.
It covers ordinary text, Hebrew AcroForm text, checkbox/choice controls, a 120-page PDF, an empty PDF, a malformed PDF, a password-protected PDF and 400 highlight annotations across four pages.

The many-highlights fixture has explicit scan and Bridge extraction budgets in manifest.json. It can be regenerated deliberately with tools/generate-pdfjs-annotation-fixture.py; update its digest only after reviewing the new PDF.

Do not regenerate these files as part of normal tests. tests/pdfjs_corpus.test.mjs verifies SHA-256 before opening any fixture.
When PDF.js is upgraded, run npm run pdfjs:check; the upgrade is not acceptable unless this corpus passes unchanged.
