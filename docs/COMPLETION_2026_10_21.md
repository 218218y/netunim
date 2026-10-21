# Completion audit, 2026-10-21

Baseline: `7282658d` (includes the reviewed `4256a6a2`). No Storage V2
replacement or change to cleared-check policy is planned.

## Stage 1: supplier order merge

Reproduced three failing cases in `business_field_merge.test.mjs`: independent
births, concurrent same-card insertions and reorders in separate cards.
The old global topology guard rejected all three with `transactionOrder`.

`shared/business-field-merge.js` now compares surviving existing row order per
supplier. Content merging delegates numeric sequence allocation to an anchored
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
