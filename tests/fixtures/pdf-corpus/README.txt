NETUNIM PDF.JS REGRESSION CORPUS

This directory is a fixed, checked-in PDF regression corpus.
It covers ordinary text, Hebrew AcroForm text, checkbox/choice controls, a 120-page PDF, an empty PDF, a malformed PDF and a password-protected PDF.

Do not regenerate these files as part of normal tests. tests/pdfjs_corpus.test.mjs verifies SHA-256 before opening any fixture.
When PDF.js is upgraded, run npm run pdfjs:check; the upgrade is not acceptable unless this corpus passes unchanged.
