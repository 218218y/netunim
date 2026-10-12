# Orders working-file ownership

The continuation audit proved three failures before the production change:

1. A held permission query on directory A could grant directory B after a
   selection change. Interactive permission lookup could also prompt B.
2. A working-file stream started on A could put its forced backup in B because
   later steps reread the global directory handle.
3. Restore safety snapshots bypassed the ordinary mirror queue, allowing two
   writable streams for the same working file at once.

`storage/folder-write-runtime.js` owns a single queue for mirrors, explicit
snapshots and before-connect preservation. It captures the selection identity
and a detached payload at submission. Adjacent unstarted mirrors may coalesce
to the latest snapshot and retain any forced-backup obligation. Explicit
snapshots are FIFO barriers; their safety-copy obligations never coalesce away.
Each caller receives the boolean completion of its own accepted command.

Before the first file effect, selection, generation and write authority must
still match. Started work finishes writing, verifying and making its forced
backup against the captured target. It cannot publish status or submit an
automatic backup through a newly selected directory. Cancellation discards
queued work and invalidates preflight publication; it does not abort a native
stream already accepted. Disposal is idempotent, rejects future commands and
supports drainage of accepted writes and standalone permission queries. Failed
writes report a failed receipt and require a subsequent explicit request; there
is no unowned zero-delay retry.

`storage/files.js` retains native I/O and a private preparation flag per selected
directory. Reselecting even the same handle creates a new identity and repeats
before-connect preservation. Preservation compares the existing working file
with the submitted snapshot, rather than another live model value. Contexts
keep the selected handle, permission and display error, and contain none of the
four retired file preparation/queue/promise fields.

Folder UI commands receive five focused ports. Native directory-picker calls
are isolated in `platform/folder-picker.js`; composition supplies selection,
primary authority, persistence and presentation. Every asynchronous UI step
checks its retained selection. Superseded picker results, old errors and old
successes cannot replace selection or alter the new folder's status.

Orders V2 source quiescence cancels the file queue, drains Main/Checks, cancels
again and drains file/permission work before the final automatic-backup drain.
The existing primary/writable/recovery/preparation authority gates new file
commands. Schemas, persisted formats, provider/RPC policies, historical readers
and Main/Shared journal semantics are unchanged.

## Evidence and scope

- Node regressions exercise held permission, held native-like streams, restore
  serialization, detached snapshots, per-selection preservation, coalescing,
  failed receipts, cancellation, disposal and reentrant receipt consumers.
- Strict checkJs covers the actual queue implementation and negative consumers;
  a mutation of the implementation's payload assignment must fail typechecking.
- `runtime_orders_folder_write_ownership.py` exercises the production composition
  with real OPFS files, writable streams, backup verification and fresh recovery.
  Only permission responses and close timing are controlled. It compares exact
  retained Main and Shared IDB records and recovers original note/check IDs and
  contents. It also exercises the production folder UI's stale-result fence.
- Architecture guards constrain collaborator counts and prevent context resource,
  native UI I/O and unowned file retry regressions. Generated service-worker
  assets are refreshed by the canonical generator.

This completes working-file queue and selection ownership. It does not certify
physical disk permission prompts, two-computer operation or live providers.
Broader Main sync/backup UI controller decomposition, remaining runtime resources
and Bridge boundaries remain separate completion stages.
