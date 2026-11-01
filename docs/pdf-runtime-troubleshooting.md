# PDF runtime diagnostics

PDF.js remains pinned to the version and integrity in
`tools/pdfjs-runtime-lock.json`. Its worker, ICC profiles and WASM decoders stay
in the verified, lazy vendor tree. Network filtering does not change their
paths, bypass release integrity or authorize caching an error response.

## Internal PDF name warnings

`Name token is longer than allowed by the spec: 1111` comes from PDF.js's PDF
lexer. It reports a PDF **Name object** exceeding its 127-byte limit, not the
Windows filename, directory length or browser URL. The reported order document
reproduced eight such warnings when supplied as bytes, with no filename passed
to PDF.js; all three pages rendered. Renaming the document cannot fix its
internal syntax. Keep these library diagnostics visible rather than hiding
warnings or rewriting customer documents.

## WASM and Content Security Policy

PDF.js uses WASM for image decoding, ICC color conversion and supported
PostScript functions. Both applications allow `'wasm-unsafe-eval'` in
`script-src`; JavaScript `'unsafe-eval'` and inline script remain prohibited.
The viewer also explicitly supplies `isEvalSupported: false`.

The native regression renders a synthetic CMYK ICC and Type 4 PostScript PDF,
checks rendered colors and compiles the four pinned WASM modules. Negative
JavaScript evaluation checks explicitly disable CDP's default CSP exemption.
The same render/policy probe runs against actual production chunks in CI.

## HTTP access denial

The reported `qcms_bg.wasm?__netunim_vendor=...` request returned **418 Blocked
by NetFree**. An independent live audit verified that the published WASM bytes
exist and match the pinned runtime. This is separate from CSP compilation.

HTTP 401/403/418/451 now produces an access-blocked notice with the status and
public vendor path. Such responses never enter the release cache. The next
document opening retries the same SHA-bound URL after normal access is restored.
Network filtering must be resolved with the filtering provider for each site's
`/assets/vendor/pdfjs/wasm/` resources, including the query-bearing URL actually
blocked. Refreshing tabs or resetting application data cannot remove a filter's
denial. No alternate host, renamed resource or embedded copy bypasses the filter.

Run `python tests/runtime_pdf_wasm.py` for the real source-viewer 418/retry,
color, CSP and internal-name regressions. `tests/runtime_production_build.py`
includes the emitted-bundle color/CSP probe in the existing full build suite.
