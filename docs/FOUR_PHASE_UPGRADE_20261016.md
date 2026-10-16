# Four source-grounded upgrade phases, 2026-10-16

The new Bank status finding was confirmed in the code. Already-closed ACK, restore recovery and caller-input capture defects were not reopened as hypothetical refactoring work.

| Phase | Result | Verification evidence |
| --- | --- | --- |
| Bank transaction authority | One canonical decoder at Bridge, archive, snapshot and outgoing batch entrances; strict pending/completed enum; independent readback rejection; new SQL batch guard before current writer implementations | PR #209; full run [38869877251](https://github.com/218218y/netunim/actions/runs/38869877251), isolated PostgreSQL atomic rejection and native publication/retry |
| Nested Bank and Credit evidence | Typed cheque/document/settlement fields and SQL aliases; captured immutable Bank transactions; Credit v2 status validation before normalization, while historical saved feeds retain their existing compatibility reader | PR #210; full run [38870926031](https://github.com/218218y/netunim/actions/runs/38870926031), actual provider models, both app boundaries and native IDB rejection |
| Selective durable decisions | Strict install/initialize/ACK/adopt/reset/compact guards in the existing authority owner; transaction ordering, writer fences, recovery classification and error priority retained | PR #211; full run [38872147026](https://github.com/218218y/netunim/actions/runs/38872147026), six implementation mutations, eighteen native transition rejections, existing input-capture/abort coverage |
| Measurement completeness and readability | Current Credit replies cannot downgrade the v2 handshake by omitting a version, and both actual publication owners prove zero merge/write on missing status. Raw-sample summaries expose missing first-view/command-ready evidence; source/environment provenance and explicit physical evidence gate; three small Bank helpers expanded with identical program AST | This change adds production-owner protocol regressions plus seven measurement/CLI contracts to the canonical CI inventory, preserves repeated cold/cached/offline coverage, and records actual Actions evidence in docs/evidence/startup-completeness-20261016.json |

Each phase runs the complete workflow on its branch before merge. Redundant PR/Main runs are cancelled only after the verified branch tree is confirmed identical to the merged tree. The full branch results remain available; no verification group was removed or weakened.

Startup source/timing ceilings are unchanged. The eager count ceiling grew only by the three actual transaction/evidence modules. Final deterministic source observations are 1,730,824 bytes / 297 eager modules for Kupa and 2,350,205 bytes / 397 for Orders, within 1,735,000 and 2,361,000 byte limits. No extra lazy loading, bundling, large factory rewrite, general legacy deletion or formatter sweep was introduced. The targeted Bank readability change removes three >500-character lines and adds 221 bytes with an identical complete parsed program.

## Remaining release work

- Both `20261016120000_bank_transaction_status_authority.sql` and `20261016130000_bank_business_evidence_authority.sql` are required. Their deployed identities, exact statement hashes and eight active function bodies were verified read-only in Production on 2026-10-16; see the [current release matrix](RELEASE_AUTHORITY_MATRIX_20261016.md) for the observation and remaining gates. Deployment postflight must assert both identities before rollout. A stale saved receipt is not a reason to reapply them.
- Collect native interactive measurements on a weak physical Windows machine with the loaded business workload, cold/warm/offline samples, device/disk/network context and first-view/command-ready times. The fresh Kupa connection-screen report currently has five missing samples for both readiness metrics in each mode. CI and CPU emulation cannot close this item.
- Complete the existing operator matrix in [RELEASE_AUTHORITY_MATRIX_20261016.md](RELEASE_AUTHORITY_MATRIX_20261016.md): installed Bridge update/shutdown and controlled interruption, older backup/import/restore, A-B-A and two physical clients, and live Bank/Credit providers. Isolated PostgreSQL, native IndexedDB and Windows deployment contracts already run automatically; they do not certify those physical/live scenarios.

Architecture decomposition remains paused unless a concrete defect or comparable physical measurement justifies a new change. Readability and compatibility continue as targeted maintenance; current RPC names and immutable migration history remain intentional.

This document records the earlier implementation phases. The current backlog and
release status are owned by [ARCHITECTURE_REMAINING_WORK.md](ARCHITECTURE_REMAINING_WORK.md)
and its linked release matrix; do not maintain an independent deployment checklist here.
