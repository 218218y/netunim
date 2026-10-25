# Checked Main synchronization coordinators

Both actual Sync Document implementations now participate in strict checkJs,
along with their save admission, immutable flight/rebase, ACK publication,
remote adoption, polling and confirmation owners. Their contracts reuse
CloudSnapshot, StoredCloudFlight, CloudRecovery, CloudWriteScope and canonical
Transport return types. Raw RPC row data remains unknown until the existing
document ACK reader validates it. Local checkpoint receipts cannot be replaced
by remote ACKs; asynchronous view publication remains forbidden.

Required dependency selections describe the existing composition ports; they
do not substitute declarations for implementation bodies. Kupa's record merger,
state projection, both value utilities and the shared business-field merge,
HTML and post-ACK recovery bodies are checked too. Nullable recovered heads and
base revisions are inspected/captured before callbacks. Unknown conflict fields
are deeply validated as JSON at the durable-control boundary. Normalized bank
objects are shape-checked before merging independent Finance. Internal cache
generics do not certify raw network replies.

Retry scheduling reads only identity and next-attempt information. Its previous
full-Outbox signature incorrectly demanded unrelated snapshot fields from V2
callers; the shared contract now describes those actual reads and checks the
resumption result before observing a promise. No retry count or delay changes.

Validation: 995 focused cloud/sync/ACK/hydration/ownership/rebase tests pass,
strict compilation and focused ESLint pass. Two local actual-body mutations
reject treating raw RPC data as an ACK and async view publication; all six
actual-body mutations and negative consumers run in CI. The frozen historical
Main policy fixture stays unchanged. Seven explicitly reviewed normalized
before/after digests cover added null/JSON guards and captured revisions. All
other historical policy tokens retain their original comparison.

The root inventory is 365 (237 product modules, 128 fixtures). Eager module counts
stay 310/406 and timing gates are unchanged. Measured graph source is
1,876,286/2,497,741 bytes; the annotation/guard allowances increase by 8,000/5,000
bytes, with less than 1 KB headroom. Canonical assets are synchronized. Runtime
behavior for valid data is retained; malformed non-JSON conflict/normalization
evidence now fails earlier at its boundary. Static types still cannot prove that
every awaited continuation checks ownership: race tests remain essential.
