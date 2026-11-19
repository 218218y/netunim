# Recovery

## External encrypted backup

The independent archive covers the PostgreSQL application, Auth, Storage and
migration schemas, the bytes of objects in the saved Storage catalog, role
names, and Google key material. The source archive records the reviewed Git
revision used to package the migrations and Edge source. It does not identify
the currently deployed source of each service.

## Verify and rehearse recovery

Run the verifier on a known Netunim archive and its separately held recovery
key. PostgreSQL 18 client and server tools are required for `--drill`.

```powershell
python -m pip install -r tests/requirements-ci.txt
python tools/verify_encrypted_backup.py --backup $backupPath --recovery-key $recoveryKeyPath --project $projectRef --drill
```

The verifier authenticates the AES-256-GCM envelope before opening the archive.
It verifies the PostgreSQL dump and every Storage object's size and SHA-256 and
checks the complete member inventory. The drill restores the database in a
disposable loopback cluster, verifies the restored table counts and matches
every restored Storage catalog entry to a verified object. The report includes
only aggregate counts, the archive hash and the source revision. Run drills
on a trusted machine with private temporary storage. Keep the recovery key
outside the backup share and keep an independent copy off the backup computer.

Retain a separate record of platform credentials, project configuration and
[Google OAuth configuration](../integrations/google.md). The drill checks database and object
recoverability. A fresh Supabase project still needs a separate test of Auth
and MFA, service roles and grants, Storage uploads, Edge deployment and the
separately held provider configuration. Object downloads follow the database
snapshot, so they may fail if an object is removed during capture.

## Operating targets

- Target one verified external copy every 24 hours and keep 30 daily copies.
  Review retention manually until the destination and recovery process have
  been accepted. Confirm the latest copy can be opened before expiring an
  older copy.
- Alert the operator on a failed run or when the newest verified copy is older
  than 24 hours. Record the archive hash, restored counts, elapsed time and the
  restore date without business data, access tokens or recovery keys.
- Rehearse recovery on isolated infrastructure after changes to schema,
  storage or service configuration and at least quarterly. An initial target
  is four hours for restoring and checking the database and Storage files.
  Measure a full platform restore separately before assigning it a deadline.
- Before any restore that could reach the active sites, preserve pending work
  from both apps on each affected browser profile. Keep the original browser
  data and a separate encrypted export. For Orders, follow the
  [Journal recovery flow](#orders-concurrent-ack-recovery)
  when synchronization is fenced. Review pending operations and account scope
  before starting resynchronization.


## Orders concurrent ACK recovery

On a blocked computer, **בדיקה וחידוש סנכרון** can review a concurrent ACK fence
when the retained base still matches the remote and no flight or retry remains.
The review captures the local and remote state and pending journal. Confirming
uses the exact reviewed scope and checkpoint. If the remote has advanced or
local proof fails, keep the export and investigate before proceeding.

1. Preserve both the original export and the full read-only IndexedDB capture.
   Avoid edits on other computers during the short review/resume window.
2. Deploy the verified website version. On the affected computer, close extra
   Orders tabs and reload the remaining tab without clearing site storage.
3. Open Settings and select **בדיקה וחידוש סנכרון**. Check the downloaded
   `orders-sync-recovery_*.json` is present before proceeding.
4. Review the revision, pending count and business differences. Approve only
   intended additions/changes/deletions with **הגיבוי נשמר — חדש סנכרון**.
5. If the action refuses the scope, journal, remote or review context, preserve
   the new backup and obtain a fresh read-only diagnostic. Do not reset,
   discard local work, import over the cloud or clear controls in DevTools.
6. Verify no pending/control/flight remains, and a fresh remote read plus the
   other computer shows the same IDs/content. A revision may increase normally
   for remaining pending work; do not rely on a green pill or counts alone.


## Credit version restore

Use the app's **גרסאות וגיבוי אשראי** flow. Export the verified version and review
both transaction and settings differences, including the simulated billing
effect at the same reference date. An export hash proves byte integrity.
Restore additionally checks semantic content, account scope, MFA, current
revision and a reason, and records the previous version. The restore is Credit
scoped and preserves the Bank snapshot. Malformed archives remain available for
export and investigation.

## Isolate a client failure

Use the [test lab](../development/test-lab.md) for synthetic abort and native
process-crash investigation. Preserve stopped profile bytes and operation,
revision and ACK evidence before replay. Reopen a disposable copy first.
