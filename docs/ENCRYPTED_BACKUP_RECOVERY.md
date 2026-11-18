# External encrypted backup recovery

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

The November 18 rehearsal reopened the November 11 copy from the network
destination, matched its previously recorded archive SHA-256, restored 83
tables and verified the bytes and catalog identities of 52 Storage objects.

Retain the [service recovery instructions](SECURITY_CLOSEOUT_20261112_HE.md)
for OAuth and platform credentials. The drill checks database and object
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
  data and a separate encrypted export. For Orders, follow the existing
  [Journal recovery flow](ORDERS_CONCURRENT_ACK_RECOVERY.md#operator-runbook)
  when synchronization is fenced. Review pending operations and account scope
  before starting resynchronization.
