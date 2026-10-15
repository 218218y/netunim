# Cloud read evidence

Main, Shared Checks, cross-application readouts and Finance REST reads now pass
through explicit decoders before revisions or document state reach consumers.
The response must be an array containing zero or one row; only `[]` means
absence. A row proves its requested document name, positive safe integer
revision, ISO timestamp and JSON object state. HTTP-success malformed JSON,
`[null]`, duplicate rows and numeric-string revisions fail closed.

Finance additionally validates optional Bank/Credit sections, numeric balance,
snapshot sequence/token and section container shapes before overlay. Historical
absent/null sections remain absent/null. Provider-specific business rows retain
their existing decoders; this does not claim full static checking of transports.
Kupa core recovery preserves its independent Finance-unavailable policy.

Backup catalogs validate every ID, revision and timestamp. Selected points also
prove the requested ID and object state. Shared backup candidates must satisfy
the requested time boundary before sorting; malformed success cannot silently
become an empty catalog or select another backup.

Decoded results are detached. Existing authentication epoch and operation guards
remain before requests and after body parsing; the decoder does not replace
those lifetime fences. Existing Main/Shared ACK, Finance write receipt, Bank
snapshot and lease contracts remain the separate authority for writes.

Validation includes actual transport consumers, delayed body/account replacement,
malformed-but-plausible values, negative strict consumers and decoder-removal
mutation. `cloud-read-records.js` is strict checked; entire transport bodies and
all nested provider/business shapes are not claimed strict checked.
