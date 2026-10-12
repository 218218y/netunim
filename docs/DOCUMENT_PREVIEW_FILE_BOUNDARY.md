# Document preview policy and bounded file reads

## Evidence and scope

Before this change, `readBinaryPreview` checked the size returned by opaque-result
resolution, then independently called `fs.readFile(path)`. A deterministic test
using the production function and a synthetic native file captured a small stat,
grew the file to 64 MiB + 1 byte and received the entire file instead of
`PREVIEW_TOO_LARGE`. This proves an unenforced preview budget; it is not evidence
of business-data loss or an incident in an operator's files.

## Owners

- `preview-content.mjs`: format/source policy, text decoding/character budget,
  typed preview responses and three explicit ports: opaque resolution, file
  reads, indexed text. Office filename/content routing retains its prior order.
- `preview-file-platform.mjs`: read-only native filesystem access and handle
  lifetime. Each request opens one handle, checks its own stat, reads in bounded
  chunks and closes the handle in `finally`.
- `server.mjs`: opaque result authorization, normalized metadata and existing
  Office kind classifiers; Everything/PDF extraction and match cache remain
  independent owners. HTTP continues to check Origin/token before routing.

## Read contract

Binary PDF/image/structured Office reads retain the existing 64 MiB limit and
MIME/filename/error contract. The opened file must be regular and its stat must
fit the budget. Reads also stop at the budget plus one lookahead byte: growth
after stat or between reads is rejected, never returned as partial success.
Empty and exact-limit files succeed. Short reads are accumulated until EOF.

Text reads use the opened handle rather than stale search size, return at most
the existing 1 MiB prefix and 600,000 decoded characters, and disclose truncation.
UTF-8/UTF-16 BOMs, Windows-1255 fallback and null removal remain supported.
The lookahead byte is never decoded or returned. Files are never modified.

These bounds do not make a file being rewritten in place an atomic snapshot,
nor do they refresh cached search metadata or redesign index invalidation.
Preview metadata can become stale; the binary fetch still enforces its own limit.
No fallback, provider scan, business write, retry or durable ACK is introduced.

## Verification and deployment

Tests cover before-change native growth, growth after handle stat/between short
reads, shrinking, exact/empty EOF, classified I/O failures, closed handles and
100 failure/success/rename cycles. An isolated ephemeral HTTP listener exercises
actual native files through the production policy, routes/access handler and
canonical browser client, including oversize and opaque-ID/token rejection.

The strict JS gate checks the actual policy/codec body and negative consumers;
an implementation mutation that substitutes text for binary bytes must fail.
The Node filesystem adapter is behavior-tested and linted, not statically
covered by this contract slice. Static installer dependency checks and the staged
Windows Bridge startup exercise both new runtime modules before activation.

This is an installed-server update: rerun the updated
`install_document_bridge.bat` on a machine using Document Bridge to activate it.
The staged installer retains the previous runtime until verification succeeds.
No site asset, wire version, SQL or persisted schema change is required.
