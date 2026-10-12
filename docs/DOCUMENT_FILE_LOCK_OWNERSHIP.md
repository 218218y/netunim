# Document Bridge file-lock ownership

## Evidence

A before-change regression executed the production `withFileLock` body against a
synthetic native directory. Its recorded PID was the still-live test process;
aging the directory past the expiry nevertheless replaced it, ran a competing
task and removed the original lock. Manual PDF maintenance has no overall time
limit, so age must not authorize takeover from a live owner.

The old release also swallowed unlink/rmdir errors and lacked a per-acquisition
identity. A late release therefore had no evidence that it was removing its own
metadata. The new owner has deterministic replacement/release-failure tests and
native processes that reproduce live exclusion, dead-owner recovery and ordered
successor entry.

## Owners and protocol

`file-lock-owner.mjs` has four explicit ports: filesystem operations, owner
identity/liveness, monotonic clock and bounded waiting. Its API is `run` and
`isHeld`. `file-lock-platform.mjs` implements native directory claims, owner JSON,
PID probing and nonrecursive cleanup within the application root. The server uses
the same coordinator for index transactions and maintenance ownership/status.

- Atomic mkdir grants a reservation. New metadata includes PID, startedAt and a
  fresh random token. Entry and release require the exact captured identity.
- A known live PID is never expired. Permission-denied liveness means live;
  only native ESRCH proves dead. Other probe/I/O errors propagate.
- Valid historical PID metadata is readable and can be reclaimed only after
  proven process death. Adding a token changes transient lock metadata, not
  persisted PDF index formats, Storage V2, SQL or browser protocol.
- Missing/malformed owner metadata is retained. No age-based deletion of an
  uncertain bootstrap reservation occurs. Status cannot claim that such an owner
  is actively working; it reports an explicit uncertainty error.
- Dead-owner reclamation is serialized by a sibling `.reclaim` directory. A
  winner observes the canonical owner afresh inside the gate. This prevents a
  stale second reaper from unlinking a replacement's owner record.
- Reaper gates are also scoped and released by their own token. An orphaned or
  unknown gate is not recursively reclaimed; explicit review is required.
- Started tasks are awaited, including durable writes. Cleanup cannot abort them
  or undo a commit already made. Task errors survive successful cleanup; cleanup
  failures are reported and retain the original error chain.
- No old finally removes a replacement with the same PID but another token.
  New claims use exclusive owner-file creation, and cleanup only removes the
  expected owner file and an empty directory. Out-of-root/nested targets and
  symlink lock directories are refused by the adapter.

The protocol assumes cooperating upgraded processes. It cannot stop an older
binary or an external actor that ignores these rules from moving/removing a live
directory. Activation must retire previous Bridge/maintenance workers before
using the upgraded staged runtime. PID reuse/uncertain probes conservatively
block rather than deleting an unproven lock.

## Failure and recovery

| Code | Meaning / handling |
| --- | --- |
| `FILE_LOCK_TIMEOUT` | A live owner was observed; work did not enter |
| `FILE_LOCK_OWNER_UNCERTAIN` | Missing/invalid metadata; preserve artifacts and inspect |
| `FILE_LOCK_RECLAIM_BLOCKED` | Dead-owner recovery could not be safely established, including a retained reaper gate |
| `FILE_LOCK_RELEASE_FAILED` | Task may already have committed; preserve both task/cleanup errors and reread durable files before retry |
| Native I/O/probe errors | Retain classification; do not substitute a free lock |

For uncertain/orphaned locks, preserve a private copy of the lock metadata and
the PDF snapshot/journal pair. Verify that the specific Bridge/maintenance
processes have stopped before repairing only their transient lock artifacts.
Do not remove a live owner's lock or modify the source document/business stores.
Do not blindly repeat a task whose write may have completed before cleanup failed.
Use the complete PDF index reader to establish retained state first.

## Verification and activation

Checked implementation/negative consumers cover typed observation, numeric wait,
asynchronous liveness/work settlement and preservation of generic task results.
The native adapter is linted and behavior-tested separately. Tests cover scoped
release, partial initialization, retained unknown owners/gates, fresh reaper
observation, error chains, 100 cycles, aged live PID metadata and two actual Node
processes contending after a previous process is killed. All files/processes are
synthetic and privately owned by the test.

Installer staging includes both modules before activation. Rerun the updated
`install_document_bridge.bat` on machines using Document Bridge; preserve its
normal rollback runtime. Full branch CI remains required before merge.
