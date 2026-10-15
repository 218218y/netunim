# Release validation status, 2026-10-15

The four slices in this continuation close selected journal command authority,
cloud read evidence, repeated CPU startup measurements and a presentation
readability ratchet. Each branch must pass Full verification before merge; a
duplicate main run is not an extra release requirement.

| Evidence | Automated coverage | Remaining release proof |
| --- | --- | --- |
| Durable journal | Native Chromium/IDB malformed append/bootstrap/import, request-success followed by abort, checkpoint retirement, ACK/rebase/reload and account ownership tests | Physical process/device termination drills remain distinct from injected aborts |
| Server synchronization | PostgreSQL migration/authorization/idempotency and browser-to-PostgreSQL lost-ACK recovery | Two physical computers on the same account |
| Account/restore | Account replacement, A/B ownership, offline/online and controlled backup/restore suites | Operator-selected older real backup and real account A/B/A drill |
| Startup | Five isolated cold/cached/offline samples per app at native/4x CPU, raw timings and median/p95 in CI artifacts | Physical weak-device/network/disk/memory observation |
| Windows | Actual Windows deployment entrypoint and runner cleanup contracts; Bridge packaging/process tests | Installed Bridge update/shutdown on the target Windows machine |
| Bank/Credit | Provider fixtures, parsing, operation lifetime, lease/snapshot/write evidence and unknown-confirmation tests | Live provider runs under operator control |

The automated rows describe coverage, not execution of real devices/providers.
No production database, live provider account or installed Bridge was changed
by this continuation. Successful CI is required evidence but cannot certify
the remaining physical/provider release matrix.

Remaining static checking is selective: the new command/read decoders are
strict checked with negative consumers and implementation mutations. Entire
Journal/IDB/V2 orchestration bodies and every nested provider/business payload
are not claimed fully checked. The current backlog retains those distinctions.
