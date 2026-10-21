# Completion audit, 2026-10-21

Baseline: `7282658d` (includes the reviewed `4256a6a2`). No Storage V2
replacement or change to cleared-check policy is planned.

## Stage 1: supplier order merge

Reproduced three failing cases in `business_field_merge.test.mjs`: independent
births, concurrent same-card insertions and reorders in separate cards.
The old global topology guard rejected all three with `transactionOrder`.

The Orders merge owner now compares surviving existing row order per supplier.
The shared business field module retains only the common content policy.
Content merging delegates numeric sequence allocation to an anchored
order graph. Both insertion chains are retained; ties use stable ID ordering;
accepted changed cards receive contiguous unique sequences. Incompatible
reorders, cyclic anchors, monetary conflicts and delete/edit conflicts remain
blocked for review. A complete order plan is checked before renumbering.

The two-profile browser suite exercises real order merging, IndexedDB flight
recovery, rebase, ACK and reload with same/different-supplier additions.
It relays a simulated remote CAS head, without contacting a live bank/service.

Focused validation: 34 merge/post-ACK tests passed. Full CI and merge evidence
are recorded in the stage PR. Generated site copies and release hashes use
`tools/sync-assets.py`; no manual Service Worker namespace change.

Next stages: detach optional backup from cloud/ACK; make failed mutation
admission explicit across both applications; align shared-check retry and
fault-test incident monitoring before deciding whether it needs a change.

## Stage 2: optional file I/O outside cloud progress

Three fault-injection regressions failed before the change: Orders publication
and both applications' post-ACK completion waited indefinitely for a folder.
They now pass, including a second durable flight while the original backup is
still held and revoked permission after ACK. The native Orders scheduling
suite also holds the folder while real IndexedDB commits and cloud wakeups drain.

Publication submits directly to existing file/automatic-backup owners, observes
rejections, and does not join their completion. Their captured targets, detached
inputs, serialization, verification, coalescing and cutover drains remain owned
by the existing runtimes. Polling, cloud opening and shared-check confirmation
have the same separation. Kupa backup verification failures now have an explicit
folder error and a deduplicated notice; verified recovery clears that error.

A folder copy never clears an IDB durability risk. Manual import/restore and
explicit file-mode saves retain their file confirmation requirements. Storage
cutover still joins accepted native file operations before changing ownership;
this stage changes ordinary cloud progress, not the cutover protocol.

Focused validation: 65 owner/backup/shared-check tests passed; targeted ESLint
and contract typecheck passed. Full CI evidence belongs to the stage PR.

The Orders static source cap moves from 2.43 MB to 2.44 MB to budget this added
correctness logic (measured 2,430,570 bytes at this stage). Eager module count
remains 405 and all latency budgets are unchanged. Kupa retains both original
source/module caps; Orders topology stays with its existing merge owner so Kupa
does not eagerly load Orders-only code.

## Stage 3: explicit optimistic mutation admission

Mapped supplier status/text/editor/reorder/bulk mutations and Kupa cash, rights,
expenses, record commands and notes through their existing Main save owners.
Those handlers already mutate the visible model optimistically. The shared
`local-mutation-admission.js` now captures each synchronous submission and its
exact commit receipt: proposed -> durable-pending -> durable, or rejected/failed.
Cloud-pending and cloud-acknowledged remain owned by the existing V2 flight.

No rollback is performed. A rejected draft stays visible with a persistent
"not saved" warning and the existing beforeunload risk. The production JSON
export includes that visible draft. A later successful generation cannot clear
another failed generation. Cloud publication, remote adoption, ACK model
publication and source/account transfer cannot silently replace that draft.
The user can export it, reload the durable source, then deliberately reapply or
import it. There is no automatic retry of an operation with unknown admission.

Focused tests cover pre-receipt exceptions, rejected/false commit results,
50 interleaved receipts with one failure, replacement-account fencing, actual
save owners in both apps, and failed drafts during ACK. The native browser
suite injects a synchronous rejection or an actual IndexedDB transaction abort
with emergency storage unavailable, checks production JSON export and verifies
the original durable row on reload. This distinguishes failed drafts from data
that was actually journaled; it does not claim that an unadmitted edit survives
a crash.

There is one new shared admission module: module budgets become 310/406 for
Kupa/Orders. Kupa's source cap becomes 1.82 MB for this explicit contract;
Orders remains within the stage-2 2.44 MB cap. Runtime latency budgets stay
unchanged. The old AST freeze of Kupa's admission body is replaced by behavioral
fault/restart coverage; delete-intent and publication policy freezes remain.
