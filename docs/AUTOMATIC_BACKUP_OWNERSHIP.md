# Automatic backup target and resource ownership

## Evidence and scope

Three pre-change application tests reproduced concrete errors:

- Kupa and Orders queued a detached payload, then read the live selected folder
  when the timeout fired. Selecting another folder could write the old payload
  into that new folder.
- Kupa allocated a backup in folder A, but verification failure after selecting
  folder B removed the same-named file in B. The incomplete A file remained.

The fix concerns optional local backup scheduling and verified backup file
ownership. Main/Shared authoritative storage, restore formats, SQL/migrations,
cloud ACK rules, provider policy and existing backup retention are unchanged.

## Owner and adapters

Canonical `shared/automatic-backup-runtime.js` owns one latest detached payload,
its exact target object, one replaceable wakeup and a serialized accepted-work
queue. Both apps consume generated copies of the same checked implementation.
Its five ports describe target reading, cloning, writing, timers and errors.

The existing debounced owner now accepts an optional numeric per-call wait,
retaining its default behavior for save/search callers. Backup waits retain the
one-second minimum; long waits are bounded by native timer limits and the app
policy rechecks the remaining interval on wakeup. This does not shorten the
backup interval or change content comparison policy.

An unstarted job runs only while it is the current job and still targets the
selected folder. Unstarted inputs coalesce to the latest request. Once an
adapter enters a file operation, it reads, writes, verifies and prunes only its
captured directory. An older completion cannot cancel a newer wakeup. The input
snapshot is cloned at submission, so later model mutation cannot change it.
Deferred work that becomes ready during a held write waits for that write.

Kupa retains its validated-directory fast path and avoids repeated scans before
the existing interval. Cache entries are attributed to their captured directory.
Its backup catalog is published only if that directory is still selected after
the read. Verified failure cleanup uses the directory that allocated the file.
Orders retains its existing comparison, naming, interval and retention policy.
Manual verified backups capture their directory and payload and have a separate
accepted-operation owner; internal naming/latest/pruning helpers are private
after confirming no external consumers.

## Quiescence and contexts

Each storage backup adapter exposes `runtime.cancelPending/isPending/drain/dispose`.
Cancellation invalidates unstarted wakeups; idempotent disposal also closes new
submissions. Neither aborts file writes already inside the adapter. Drain waits
for started automatic and manual commands. Cancel or dispose first when full
quiescence is required; drain does not wait for a future twelve-hour deadline.

Both V2 coordinators receive the backup runtime explicitly. Local birth and
owner-transfer settlement cancel backups, drain accepted Main/Checks work,
cancel any backup wakeup submitted by that completion, then drain backup work
before reading the settled source boundary. Kupa uses one shared quiescence
function for both paths.

`files.autoBackupTimer` and `files.pendingAutoBackupPayload` are removed from
both contexts. The unrelated Kupa `session.startupLocalServicesPromise` alias is
also removed: the existing startup task already owns/coalesces that promise,
and lifecycle awaits its start directly. Architecture checks prohibit these
resource fields and direct scheduling in the backup adapters.

## Verification and remaining work

Focused Node cases cover the original errors, original-target writes, detached
input, newer obligations, serialized/coalesced work, deadline validation and
disposal/drain. The actual generic runtime and negative consumers are checked
with strict checkJs; a compiler mutation rejects a timestamp as a payload.
The default and overridden debounce behavior remain covered.

`runtime_automatic_backup_ownership.py` uses the actual application adapters,
native OPFS directory/file handles, native writable streams and timers. It
checks folder changes, read-back failure cleanup, started write drainage,
closed submissions, exact Main/Shared IDB record retention and fresh read-only
recovery of the original note/check IDs/content. These disposable test folders
do not exercise a user's external filesystem permissions. Existing native Main
owner-transfer/recovery tests also run against the new coordinator wiring.
The full browser suite inventory includes this test.

Orders working-file write coordination, broad backup/restore UI capabilities,
folder-picker/permission ownership, tab lock releases, Calendar resources and
remaining startup/import resources are subsequent reviews. This stage does not
claim their lifecycle contracts are complete.
