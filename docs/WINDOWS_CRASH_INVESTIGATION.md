# Bounded Windows crash investigation, 2026-10-25

Status: **UNRESOLVED**. Native LevelDB corruption was observed; the cause is not
established and no Storage V2, checksum, Journal, ACK or recovery algorithm is
changed. A later passing job does not resolve a previous lost database.

## Preserved historical evidence

The original GitHub job logs are retained byte-for-byte under
`docs/evidence/crash-history/`, with SHA-256 digests and source/job identities in
its manifest. These logs use disposable synthetic profiles, not business data.
The original failing raw LevelDB files were not retained by those executions;
therefore the original physical damage cannot be independently inspected.

| Run / job | Application / phase | Observation |
| --- | --- | --- |
| 40194893068 / 121173505840 | Orders / prepared | Profile marker survived, fixture DB disappeared, Chromium reported LevelDB checksum mismatch and recovery by deletion |
| 40207694658 / 121215728994 | Kupa / prepared | Same marker/fixture/LevelDB pattern; the independent normal application databases still appeared in the list |

Both jobs used Windows-2025 runners and Chrome 156.0.8078.48. A separate PR #325
attempt failed during module loading with no JavaScript error; that is a browser
load failure, not the checksum event. No preserved log proves an orphan storage
process, a NETUNIM record checksum error, or the cause of native LevelDB damage.
The production journal already requests strict durability; transaction completion
is still required and that browser hint does not establish hardware guarantees.

## Reproduction and controls

`tests/investigate_restore_process.py` reuses the existing native paired-restore
fixture and process owner. It takes 1..3 independent repetitions at each selected
prepared/shared-applied/main-applied barrier, either a hard kill or a clean
restart. Each sample has a fresh owned profile; failed samples remain failures,
and later samples are separate observations rather than retries of that sample.
The diagnostic workflow fixes two repetitions per phase and application for each
restart mode: 24 cases total, at most two diagnostic Windows jobs at a time.

Before Chromium reopens the stopped profile, an optional harness callback copies
only that owned profile's IndexedDB bytes to a ZIP and records per-file/archive
hashes. The process tree has been joined first; no live database is copied.
This closes the previous evidence gap where Chromium could delete a broken
backing store before evidence capture. No profile bytes are replayed or repaired.
Artifacts use synthetic contents only and survive ordinary scratch cleanup.

Each sample retains source/platform/browser identity, crash/control mode,
pre-restart/post-open/completed/stable-restart snapshots, stored rows and hashes.
Opening must preserve the complete recovered records, journal sequence/epoch,
checkpoint checksum, cloud heads/flight evidence and boundary before resume.
Writer-fencing metadata may change independently; raw snapshots are retained.
After resume, both revisions (9/12), the exact synthetic records and boundary ID
are asserted, then another clean restart must reproduce the completed result.

```text
python tests/investigate_restore_process.py --app orders --restart crash --repetitions 2 --report-dir .work/restore-orders-crash
python tests/investigate_restore_process.py --app orders --restart graceful --repetitions 2 --report-dir .work/restore-orders-control
```

One local Windows 11 clean prepared-phase control passed, including byte capture,
identical pre/post-open recovery digest and stable completed restart. This is a
local synthetic control, not a physical-machine or installed-provider acceptance.
The dedicated workflow preserves all phase results and stopped DB archives,
including failures, separately from the unchanged full verification gate.

The first complete campaign, run `40212617727`, passed **24/24 independent cases**
on Windows Server 2025 10.0.26100 with Chrome 156.0.8078.48. There were twelve hard
kills and twelve clean controls, covering both apps and all three phases twice.
Every pre/post-open recovery digest and completed/stable-restart digest matched.
Downloaded stopped archives were checked against their reported byte hashes.
The source-bound [24-case result](evidence/restore-investigation-20261025.json)
retains per-case digests, browser/Windows identity and artifact IDs/hashes; the
full snapshots and ZIPs remain in the original diagnostic artifacts/local copies.
This is a bounded non-reproduction result, not an explanation of the original
checksum incidents. The original issue remains **UNRESOLVED**.

## Classification and reopening conditions

- A Chromium LevelDB checksum/deletion message is `native-leveldb-corruption`.
- A physically readable database rejected by NETUNIM record validation is
  `application-record-validation`; inspect the retained row and receipt first.
- Browser module-load/DevTools failure is `browser-startup-or-load`.
- A missing fixture/marker without native diagnostics remains unclassified
  missing persistence. It cannot be relabeled corruption or success.

Keep the issue unresolved even if the bounded matrix does not reproduce it.
Reopen implementation work when a repeatable defect links an accepted receipt
to missing/invalid stored evidence, a reproducible process ownership defect, or
inspectable native bytes locate an upstream backend fault. Preserve those bytes
and the exact browser/OS/phase. Physical two-machine and installed-service
acceptance remain NOT RUN until a separate safe environment exists. Never test
against working profiles, delete a damaged DB, add silent retries or relax gates.
