# Remote cloud hydration and durable publication

This contract covers non-destructive Main reads in Kupa and Orders: startup,
polling, interactive account opening and the Orders refresh before Morning
recovery. It extends the [ACK contract](STORAGE_CLOUD_ACK_CONTRACT.md); a GET
does not acknowledge pending writes. Explicit user-directed discard/reset and
owner transfer retain their separate epoch-transition protocols.

## Evidence and ownership

The baseline is main `64205c8e`, after the production Kupa conflict fix. Nine
new behavior tests failed against that baseline. They showed that Kupa published
remote records/revisions before adoption committed, Orders could publish after
losing primary leadership, and the journal could discard an existing conflict
control during a read. These findings do not establish a new production data
loss incident or reconstruct the historical transient conflict trigger.

Main owns its cloud projection and journal. Shared Checks owns its separate
journal. Finance owns its remote revision; Kupa keeps a local Finance cache,
while bank adjustments and snapshot watermarks remain Main data. Publication
must preserve Shared Checks and any newer independent Finance data.

## Required ordering

1. Observe a clean local Main head and prepare a detached candidate. Capture the
   local generation, sequence and base revision associated with the read.
2. Clone the cloud projection, checkpoint and metadata before waiting for older
   commits. A caller's mutable object must never change the adopted checkpoint.
3. Recover the journal and reject pending work, flights or conflict controls.
   When supplied, the observed sequence/base revision must still match.
4. Atomically compare writer/owner/epoch, local sequence and checkpoint/base/
   control checksums, then store the checkpoint and base. Reject changed heads
   without changing their records. A remote revision cannot regress.
5. Before publishing, recheck primary ownership, account authorization, local
   generation and the adapter's refreshed head. An edit committed after adoption
   must not be hidden by returning only the earlier adoption receipt.
6. Publish records and the matching revision. Kupa queues required historical
   normalization through the existing journal/delete-intent path, then hydrates
   Shared Checks and refreshes secondary readouts. Optional local backups follow
   the durable Main commit. Their failure does not undo an adopted cloud head.

Kupa no longer waits for Shared network hydration before committing Main. A
required Shared failure still propagates to startup/readiness orchestration;
the already committed Main state and cursor remain valid. Polling retries the
secondary hydration without replaying a cloud write. A local edit after Main
publication is reported as pending rather than synchronized.

## Failure outcomes

| Failure | Preserved state | Next action |
| --- | --- | --- |
| GET unavailable/offline | Existing visible state, identities and journal | Existing bounded reconnect policy |
| IndexedDB adoption abort/quota | Previous checkpoint/base and visible model | Recover and retry the read |
| Local edit/control/checkpoint/base race before commit | The newer durable head and pending work | Reject the stale adoption; normal recovery/sync policy |
| Local edit during commit/publication | Adopted remote checkpoint plus the pending local journal; visible edit stays | Persist `concurrent-hydration`; stop publication/sends for review |
| Model publication exception after commit | Adopted checkpoint/base | Persist `cloud-publication-failed`; stop for recovery/review |
| Leadership/account changes | Data remains in its original owner namespace | No publication or control write from the former context |
| Shared hydration fails after Main commit | Committed Main data/revision, independent Shared journal | Keep Shared/readiness failure visible and retry separately |

A GET never retires a conflict control. An unchanged, expired network retry
control on a clean Shared head may be cleared by successful adoption; its exact
checksum is fenced so a new control cannot be cleared accidentally. The earlier
conditional dirty-head review remains limited to its separately proven condition.

## Verification

- `cloud_hydration_publication.test.mjs`: commit-before-publication, abort,
  concurrent edits, leadership/account loss, publication errors and independent
  Shared/Finance ownership across Kupa, Orders polling, Morning and account open.
- `storage_cloud_adoption.test.mjs`: immutable candidates, read cursor guards,
  durable control/checkpoint/base/sequence races and refreshed adapter heads.
- `runtime_storage.py`, `cloud-adoption-recovery`: real IndexedDB transaction
  races, writer fencing, abort atomicity, retry and fresh-runtime identity recovery.
- Existing ACK/offline/lost-response/rebase, normalization, Shared Checks and
  owner-transfer suites remain required, followed by the full branch CI matrix.

No persisted schema, serialization format, SQL, RPC, migration, credential
storage, or compatibility reader is changed by this slice.
