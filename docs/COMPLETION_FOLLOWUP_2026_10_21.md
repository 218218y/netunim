# Follow-up audit after 686bc668, 2026-10-21

## Stage 1: certify the working-folder mirror

Confirmed the reported gap. Four regression cases failed on the original code:
rejected/unconfirmed receipts still submitted a folder write, and an earlier
receipt could submit the newer pending visible generation. The revised tests
pass after the change; the negative cloud-receipt mutation test is retained.

`storage/save-publication.js` now submits optional folder work only after the
captured receipt confirms true, is current, matches the visible generation and
has no failed Main admission. It still never joins native folder I/O.

All ordinary mirror triggers (including ACK, polling, shared checks and manual
folder backup) also go through `storage/files.js` and the V2 coordinator's
`captureFolderState`. This reads detached Main and Shared durable recoveries,
checks current generation, both commit promises, storage/account identity,
readiness and durability risks, and compares the result with the visible data.
The returned evidence is checked again synchronously at file submission.
Unknown/mismatched evidence returns false without opening a writable stream.
The existing external-workbook Main projection is used; workbook state retains
its separate durable owner. No optimistic state is admitted by making a backup.

Proof/preflight work belongs to the existing file owner's drain. Payload cloning,
target fencing, verified writes, coalescing and explicit snapshot barriers remain
with the original serialized writer. Started native effects finish on their
captured target; source cutover continues to join accepted file operations.
Explicit restore safety snapshots and deliberate JSON draft export retain their
existing contracts. There is no added state store, queue or schema change.

Local evidence: 44 focused Node tests, module graph, ESLint, typecheck and existing
startup budgets passed. Native folder ownership (21 assertions) and independent
Main/Shared scheduling (53 assertions) passed. The production admission browser
test now starts with an actual OPFS working file, injects synchronous failure or
an actual IDB abort with unavailable emergency storage, checks exact original
file bytes, checks visible draft export, then reloads the durable original row.
It also checks authentication fencing and same-generation unadmitted changes.
Full CI and tested/merged commit evidence belong to the stage PR.

Limits: browser tests use actual IndexedDB and OPFS with controlled fault points;
cloud CAS is simulated by the existing suites. No physical removable drive,
live bank provider or two physical devices were used. A failed local edit remains
an explicit exportable draft; it is not claimed durable across a crash.
