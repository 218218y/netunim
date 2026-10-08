# Kupa cloud conflict review and independent Finance hydration

## Incident evidence

The read-only production report from 2026-10-08 contained a
`storage-v2-dirty-head` fence created on 2026-10-07. Main revision was 479,
local sequence and acknowledged sequence were both 2, and no flight existed.
The recovered Main projection, its acknowledged base, and the exported visible
business data matched. Record checksums were valid. The retained journal entries
were already acknowledged; their presence alone did not mean pending work.

The report does not retain the transient visible projection that originally
triggered the fence. Its historical difference cannot be reconstructed from
this report. The current failure is reproducible: the poll stopped permanently
at the retained fence without reviewing its condition, also skipped independent
Finance reads, and a successful Shared Checks poll repainted the global header
as synchronized. Private production exports are not repository fixtures.

## Ownership and recovery policy

- Main and Shared Checks publish separate status outcomes. A success in either
  document cannot clear a conflict or a pending/error indicator in the other.
- Only Kupa's `storage-v2-dirty-head` fence can be reviewed automatically. The
  visible Main projection must equal its acknowledged base, with no pending
  sequence or flight. ACK/publication/entity conflicts remain explicit fences.
- The journal independently recovers and validates its durable projection.
  Only the exact expected sequence, base revision and conflict kind qualify.
  Retry state prevents automatic retirement.
- The IndexedDB transaction checks writer/epoch, sequence, flight absence, and
  checkpoint/base/control fingerprints before deleting the reviewed control.
  A changed head, writer fence or aborted transaction retains the evidence.
- Review does not write business data, advance ACK/revision, delete journal
  entries, reset the storage epoch, or send a cloud write. After successful
  review, normal polling reads the current remote document and rechecks local
  advancement before adopting it.
- Main conflict/pending work permits an independent read of
  `finance_sync_documents`. It cannot apply a new Main document or change the
  Main cursor, immutable flight, pending operations or conflict evidence.
- Finance hydration preserves Main-owned fields, manual bank values,
  adjustments and snapshot watermarks. It commits the candidate checkpoint
  with its captured local sequence before publishing the visible result or
  Finance revision. New edits/leadership changes prevent stale publication.
  Failed reads or checkpoint writes keep the previous visible data/revision.

## Verification

`kupa_cloud_poll_isolation.test.mjs` reproduces the original status overwrite and
blocked Finance read, then covers review, real conflicts, offline mode, quota,
network failure, concurrent edits and manual bank ownership.
`storage_clean_conflict_review.test.mjs` covers the durable preconditions and
checkpoint/control/edit races. `runtime_storage.py` also runs the real IndexedDB
transaction guards, writer fencing, independent Finance projection and abort/
retry scenarios. Existing browser/database/two-computer suites remain release
gates; no serialization format, SQL migration or RPC payload is changed.
