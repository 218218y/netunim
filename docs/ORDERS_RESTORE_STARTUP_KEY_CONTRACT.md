# Orders startup: server restore key admission

## Confirmed cause

For an online, signed-in primary Orders tab, startup checks for server-only
restore recovery even when no local restore exists. `loadServerPending(owner)`
produced `orders.restore.group.v1:current:server:<owner>`, while the actual Orders
storage adapter admitted only the exact `:current` key or `:archive:<id>` keys.
It threw `storage_restore_group_key_required` before reading IndexedDB or listing
server groups. Lifecycle correctly kept editing blocked and displayed restore
pending because recovery could not be verified.

The mismatch is reproducible with no restore database and no SQL connection.
The adapter admission predates server-only recovery: the former was introduced
in `0c41e8103`, while the server key was added in `551b32c83`. SQL deployment does
not resolve this client-side contract mismatch.

## Correction

`shared/restore-group-keys.js` now owns the app namespaces, all three key builders
and storage admission. The restore store, Orders adapter and both composition
roots use that contract. Existing current, archived and account-scoped server
keys retain exactly the same bytes. Business outboxes, foreign namespaces and
incomplete keys remain rejected before opening a database.

Restore-record decoding, account/recovery guards, paired Main/Shared adoption and
the startup write lock are retained. No record is deleted or hidden to make startup
continue; a malformed real pending record still raises its recovery error.
No new SQL migration or storage reset is needed for this correction.

## Evidence

- The Node regression connects the actual restore store to the actual Orders
  adapter and proves empty server-pending lookup returns null without creating
  a database; invalid read/write/delete keys still fail before IDB access.
- The startup regression runs the real Orders lifecycle, backup/restore owner,
  store and adapter together for a signed-in account and verifies render/readiness.
- The native server-recovery test now uses each application's actual storage
  adapter and production namespace. It covers empty signed-in Orders recovery,
  malformed record retention, account isolation, interruption after server commit,
  fresh writer retry and paired authoritative adoption.
- `python tests/runtime_restore_server_recovery.py --app orders --baseline`
  reinstates only the old adapter gate in the disposable browser site. It fails
  with the reported `storage_restore_group_key_required`; the corrected Orders
  and Kupa cases pass. Prior tests missed the integration because their pending
  records used a separate permissive test key/value adapter.

The generated site copies and Service Worker shell include the new module. Eager
module ceilings increase only by that one shared contract (298/398); source-byte
and timing ceilings are unchanged. The fix requires publishing the complete updated
site assets. Merging Git alone does not update an already deployed site or tab.
