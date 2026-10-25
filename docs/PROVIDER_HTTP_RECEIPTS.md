# Provider HTTP receipt boundary, 2026-10-25

CAL and MAX receive an untrusted serialized receipt from a page execution context.
Previously that transport coerced the status and body: a string `"200"`, a
fractional status, an array body or object Retry-After could reach successful JSON
handling. In particular an empty array body became an empty string and then null.
This is a reproduced validation gap, not evidence of corrupted financial records
from a real provider.

The existing pure `credit-http-policy.mjs` now decodes an unknown receipt into an
integer HTTP status (100..599), textual body and textual Retry-After. A missing
optional header remains empty. Invalid receipts raise a bounded schema error,
retain no raw payload, and do not trigger a second provider request. Both actual
browser consumers call the decoder before coercion/JSON parsing. CAL's original
fallback remains available only when page execution itself failed without a
receipt; an authoritative browser rejection/invalid receipt cannot authorize it.

The actual policy/decoder is strict checked. JSON parsing returns `unknown`, not
a typed account, amount, transaction or coverage proof. Provider-specific
validators retain that responsibility. Negative consumers reject treating decoded
JSON as money, invented error fields and wrong reference-clock types. Mutations
of the actual decoder/error bodies reject textual status and failure metadata.

Focused behavioral tests cover malformed receipts, valid JSON/arrays/204 bodies,
MAX network errors, real local HTTP body timeout/disconnection and preserved
403/429/HTML/invalid-JSON behavior. Existing connector/month/coverage/cooldown
tests remain mandatory. No provider login, monthly financial algorithm, cache,
new transport, output document or application startup module is added.

The wider `credit-http.mjs` browser/native adapter and the full CAL/MAX/Isracard
provider models remain selectively checked; this change does not claim full
provider coverage or official sandbox acceptance.
