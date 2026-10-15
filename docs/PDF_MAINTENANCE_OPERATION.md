# PDF refresh operation and checkpoint admission

The Document Bridge's PDF refresh now has a strict seven-port operation for
index persistence/readout, inventory batches, extraction, maintenance metadata,
policy/limits, runtime and audit. The server retains composition and its existing
inventory reconciliation plan. A completed inventory returns its selected rows
as an internal batch; each operation owns that queue. The server-global backlog,
refresh promise and abort controller are retired.

The original private refresh API coalesced onto its inner work promise. Recorded
production-function tests prove that a second caller could fail before the first
finished failure-metadata writes, or throw ABORT_ERR while the first returned its
completed aborted result. The new flight covers the entire operation, including
failure/abort handling and timer cleanup. Disposal cancels and joins this same
flight; accepted checkpoint writes retain their completion authority.

Checkpoint bytes now cross an explicit native read and unknown-record decoder.
Only a missing file starts empty. Existing malformed JSON, invalid record shape
or unreadable bytes cannot silently turn into an empty writable checkpoint.
Native tests reproduce the old fallback overwriting malformed bytes and prove
the current boundary retains both metadata and raw index/journal files. Nullable
historical checkpoint fields, unknown extra metadata and historical textual
pending counts stay readable. A cleanup read failure retains the first operation
error and cannot invent a successful checkpoint.

## Preserved policies and evidence

- The original refresh, reconciliation and reader declarations were captured
  before editing. Executed old/current comparisons cover 720 combinations of
  force/due state, file/time limits, form/non-form, retry history, password and
  ordinary extraction errors and cancellation. Exact results, checkpoints,
  journal records, logs and cleared timers match for a single operation.
- The 300-file/15-minute scheduled budget, unlimited manual mode, daily/exponential
  retries and password delay, negative form caching, revision fields, bytes/CPU
  diagnostics and success/reconcile/incremental timestamps remain unchanged.
- Native journal failure preserves bytes, reports one storage failure without
  reclassifying it as an extraction error, and demonstrates full coalesced drain.
  Actual server inventory/operation/writer composition produces a replayable
  native index/checkpoint and joins held checkpoint publication during shutdown.
- Existing inventory cancellation/shrink guards, native append/compaction fault
  suites and installer static-dependency closure remain in place. Strict bodies,
  negative consumers and real-body mutations reject incomplete batches, text
  progress and disposal without cancellation/drain.

This slice does not change the PDF index schema, search/Bridge wire contract,
provider policies or historical index readers. Inventory planning/normalization,
on-demand PDF enrichment, scheduled-task diagnostics and installer/doctor
coordination remain visible work; live installed PDF/Everything/Preview Handler
certification remains separate from the synthetic native fixtures.
