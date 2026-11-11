# Orders ACK recovery investigation, 2026-11-11

## Observed incident

All times below are Israel time (UTC+02:00). The private recovery export was
inspected locally and was not added to Git or to CI.

- At 17:21:54.469950 the server accepted revision 2459, following revision 2458.
- The local cloud base acknowledged sequence 1000. At 17:21:55.544 the client
  persisted a `concurrent-ack` fence with `publication_stale_generation`, then
  `journal_read_failed`, both at attempt 0.
- The recovery export at 18:19:26 retained sequences 1001–1061: 53 note edits
  followed by eight further operations. It retained its authoritative base,
  checkpoint and full pending journal; no immutable flight remained.
- Production recorded one Orders Main incident, first reported at 17:21:58.501.
  Revision 2460 was saved at 18:20:48.181651 and the incident was resolved with
  `clean_verified` at 18:20:56.004985.
- A fresh read of revision 2460 matched all 16 business fields of the exported
  local state, including every collection and its order. Comparison used
  deterministic content digests after normalizing equivalent ISO timestamps;
  export metadata and the separately owned Shared Checks document were excluded.

## Root defect reproduced

`storage-journal.recover()` previously loaded an asynchronous IndexedDB snapshot
and only then read the synchronous emergency journal. While that IDB read was
in progress, a local operation could commit and retire its emergency copy, and
another keystroke could leave a subsequent operation in emergency storage. The
old IDB snapshot plus only the later emergency operation creates an artificial
`storage_journal_gap_or_duplicate`, despite a completely healthy actual journal.

A deterministic regression test reproduces exactly that interleaving: IDB
snapshot at sequence 0; sequence 1 commits and retires its emergency copy;
sequence 2 remains in emergency storage. Before the fix the test throws a gap
error. After the fix it returns the coherent earlier snapshot, and a subsequent
read recovers both operations. Generation checks prevent the older observation
from being published over new edits.

There was a second recovery weakness: the explicit temporary condition
`storage_cloud_recovery_undurable` immediately ended post-ACK recovery and
created a persistent review fence, instead of using the existing bounded retry
budget. Both weaknesses affect the shared engine used by Orders and Kupa.

The incident export records `journal_read_failed` without the original exception
code. Therefore the specific thrown read error in this incident cannot be proven
from the retained evidence. The reproduced read race is consistent with that
trace and the rapid note edits. A concurrent server/business-record change was
not demonstrated by the export or by the available database evidence.

## Correction

1. Capture emergency evidence synchronously **before** starting the IDB read.
   A commit can then be represented by its captured emergency copy, the later
   IDB snapshot, or both. The existing identity/deduplication checks still apply.
2. Retry only the explicit undurable-read condition inside the existing bounded
   post-ACK recovery lifetime. Diagnose it as `journal_read_undurable`.
3. Keep checksum, missing-sequence, replay, business-conflict, owner, epoch,
   generation, head-CAS and leadership checks. Unknown read errors still retain
   pending work for review. No new remote ACK or operation is manufactured.
4. Synchronize shared sources and release/cache identifiers for both apps.

No production schema or business-data rewrite is needed for this client defect.

## Verification and limits

- Before the fix: the deterministic snapshot race and both apps' temporary-read
  recovery regressions fail. After the fix: all three pass.
- 45 focused ACK/review/recovery tests and 165 journal/authority/storage tests
  pass locally; targeted ESLint and the repository typecheck pass.
- The native-IDB acceptance suite includes `read-race` for both apps, verifies
  all pending edits reach the fake server exactly once, and reloads the isolated
  browser to verify persisted state. Full browser/PostgreSQL/Supabase coverage
  runs in the repository's GitHub verification workflow.
- Local system events in the incident/recovery window contain no disk/filesystem
  warnings or errors; drive C had about 100 GiB available during inspection.
- Supabase health advisories were empty. Available PostgreSQL logs for
  17:20–17:24 did not report an error explaining this client fence.
- The database's unrelated security/performance advisories were reviewed; they
  are not evidence of this failure and were not changed as part of the fix.
- Direct inspection of the user's Chrome tab was unavailable because the
  computer-use tool could not establish the current URL. No live browser
  storage was altered. The local native-browser acceptance attempt was deferred
  to CI because this Python environment lacks `websocket-client`.

The fix prevents the reproduced race, not every possible future synchronization
failure. Real conflicting edits and storage failures must continue to stop for
review rather than silently overwrite data.
