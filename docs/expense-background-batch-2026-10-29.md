# Approved expenses and background source delivery — 2026-10-29

There is one financial creation/upload pipeline. Both a single background save
and “save all approved” schedule immutable reviewed snapshots through it. The
ordinary expense writer, ledger CAS, duplicate protection, P identities and
income-document integration remain in place.

## User workflow

- “Save expense and PDF, next” confirms the reviewed invoice, retains its own
  fields, original File and source-review evidence, and immediately loads the next
  editable PDF. The approved copy continues through financial verification,
  source upload and exact provider-byte verification in the background.
- “Mark approved and next” performs local required-field/amount checks and source
  compatibility review, records approval, and advances without a financial call.
  “Save all approved” submits only the marked records after one count/environment
  confirmation. Unapproved documents stay editable in their original queue order.
- A single serial worker finishes one complete expense/source verification before
  starting the next. Further reviewed files may join its queue while it runs.
  Each has a separate operation UUID. The currently edited document is never the
  data source of a job already accepted for delivery.
- An always-visible status dock shows background work and a link to detailed
  stages/counts. Failure stops later writes, raises a toast and leaves a persistent
  alert plus an entry with a recovery action. The next draft remains intact.

Editing revokes an unsent local approval. A reporting-period change revokes
approvals not yet queued; it cannot change the reporting period of a submitted
snapshot. Records already handed to the worker are not editable. Field/source
indicators are enlarged to 42 by 27 CSS pixels with colored borders, without
adding layout rows below the controls.

## Ownership, durability and recovery

Queue Files and reviewed fields remain private in memory within the existing
20-file/100-MiB aggregate limit, including active and pending jobs. Refresh/close
warns about unsaved work. The browser durably stores only per-operation UUID,
SHA-256, version and delivery state, scoped by owner and Morning environment.
Separate storage keys avoid replacing another window's queue. No filename,
invoice fields, OCR text or file bytes enter localStorage.

The worker records `sending` before any possible financial POST. Web Locks
coordinate background schedulers on the same origin/account/environment; the
server's independent invoice/source reservations remain the duplicate authority.
Unsupported browsers retain the existing immediate single-expense route.

After reload there is **no automatic replay**. Old records are shown for status
inspection. Existing expenses open the established read/reconciliation/source
completion route. If the server confirms an operation UUID does not exist,
explicit consent removes the old approval and returns an available File/draft
for fresh review; lost in-memory Files must be selected again. Queued work resumes
only after the uncertain record is resolved and the user chooses to continue.
Switching account/disposal stops later dispatches while retaining the original
account's recovery identifiers. An in-flight server request can still finish;
its ledger and identifier are checked rather than resent.

Financial verification and exact source-byte verification are separate. Merely
seeing a file URL, an opaque upload result or an accepted upload ticket never
marks a job complete. Normal background delivery makes at most one financial
creation call per job and never automatically retries an uncertain source upload.
The prior audited, identical-source retry path remains available during recovery.

## Required fields and accounting amounts

The same pure validator is shared by the UI and server. Supplier/category,
document type/number, valid invoice/reporting dates and exact cent totals must be
present before approval. For this business intake, an ordinary taxable supplier
invoice above the date-specific net threshold requires a nonzero nine-digit
allocation number before approval or creation. Credits, zero-VAT documents and
P documents keep their separate treatment. A nine-digit shape is **not** official
allocation validation. Explicit VAT is retained; no 16/18 percent recalculation
is introduced.

The threshold schedule is shared by recognition and validation rather than
duplicated: 20,000 NIS net in 2025, 10,000 from 2026-01-01 and 5,000 from
2026-06-01. The business-presence gate implements the user's requested intake
rule; it does not model every statutory exception. Official references:
[Tax Authority application](https://www.gov.il/he/service/request-assignment-number-for-tax-invoice),
[2026 implementation circular](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf).

## Validation and deployment

Node cases cover snapshot isolation, no writes on marking, sequential delivery,
partial selection, double clicks, failed metadata storage, lock contention,
failure/reload/account cutover, read-only recovery, exact money and server-side
allocation rejection before reservation. Native desktop/mobile scenarios hold
an upload while editing/queuing later PDFs, verify retained focus/caret/PDF
scroll, test partial/all approvals, force source failure, recover the same
expense, resume queued work, reload and change accounts.

Synthetic provider/browser tests are not evidence of a new live financial write.
Production acceptance for this release is read-only. Deploy the matching
`morning-expenses` function before static clients; its `backgroundQueue` capability
enables the new route. There is no schema migration. For rollback restore the
previous static release. The compatible server continues to recover existing
operations; do not clear browser/ledger recovery records or disable read access.
