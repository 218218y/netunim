# Storage and sync

## Durable owners

| Data | Owning path |
| --- | --- |
| Orders and Kupa Main documents | One typed IndexedDB journal and cloud sync coordinator per app. Main checkpoints use projection 2. |
| Shared checks and bank events | An independent Shared Checks journal and RPC path. Both apps compose this recovered state with Main. |
| Bank and credit snapshots | Finance sync owners, with provider evidence and a scoped server lease. See [Finance contracts](finance.md). |
| Calendar | Google Calendar and its dedicated mutation/confirmation owner. Browser projections are account-scoped. |
| Independent workbooks | Separate workbook documents and per-document revision/ACK handling. The existing v1 workbook RPCs are active. |

Startup verifies the IndexedDB owner binding, account marker, checkpoint and leadership before allowing edits. LocalStorage activation markers are routing caches. Cloud login authorizes requests. Owner transfer prepares and verifies a detached target before activation. Import, restore and cloud adoption use coordinated Main/Shared boundaries so partially completed replacement cannot become active.

## Save, acknowledge and recover

1. Decode the operation against the owning collection and capture its identity and scope. The IndexedDB transaction has to complete before the write becomes a durable receipt. Recover a coherent checkpoint and journal with emergency evidence captured before the asynchronous IndexedDB read.
2. Build an immutable cloud flight from the verified base and the pending operation sequence. Keep retries tied to the same flight and identity.
3. Validate the exact remote acknowledgement or authoritative read-back before advancing the base/ACK. Publish only while the captured account, writer and generation are still current. Rebase younger edits through the owner and leave any unverified work pending.
4. Classify unreadable records, ambiguous replacements and genuine conflicts. Keep recoverable evidence and fences until verified recovery is possible. Compaction must prove the checkpoint and journal identities agree before retiring covered rows.

[Operation decoding](../../shared/storage-operation.js), [journal recovery](../../shared/storage-journal.js) and [IndexedDB transactions](../../shared/storage-journal-idb.js) own the common contracts. The [compatibility inventory](compatibility.md) lists retained readers. The [recovery runbook](../operations/recovery.md#orders-concurrent-ack-recovery) describes operator review when automatic publication cannot proceed.

## Independent workbooks

The workbook store captures the complete structured clone or validated draft
patches before awaiting IndexedDB. The workbook model and sync owner decode the
raw persisted document and recovery records. Merge known draft entries without
overwriting unreadable evidence. Preserve historical optional timestamp and
generation fields. A failed bounded emergency write keeps the prior buffer and
reports failure so unload protection can remain active. RPC results and account
epoch checks gate publication and acknowledgement.

## Server authority

Main, Shared Checks and Finance use v6 writer RPCs. The minimum writer protocol and server-side writer scope guard direct writes. The [operation contract migration](../../supabase/migrations/20260929093000_storage_writer_operation_contract.sql) maps an operation to the domains it can change, including trigger effects. Finance verifies the lease and fence before opening writer scope.

- Stage restore changes Main metadata. Apply restore can write Main and Shared Checks in the same transaction.
- A complete bank archive snapshot can reconcile checks and therefore needs both Kupa and Shared Checks writer scope. A partial read cannot claim complete coverage or authorize that reconciliation.
- Change the operation map when an RPC or trigger begins writing a different protected domain. Verify wrong-lease rejection, replay, rollback and owner isolation in [the server contract suite](../../tests/storage_writer_protocol_server.py).

## Cross-device incidents

Sync incident reporting observes Main, Shared Checks, independent workbook and
Calendar state through their own owners. Unknown or unreadable state cannot
resolve an incident. Automatic resolution requires fresh proof that the same
installation, scope and generation are clean. A manual review records an
unverified operator decision. A quiet incident list describes reported issues
only. Use the affected device's journal and remote revision for recovery.
