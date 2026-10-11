# Kupa local Bank snapshot: confirmation, disclosure and safe retry

## Evidence and baseline

Baseline: main `d37d0caa75ca0da23145066840fbfc432943beff`, full branch CI
`38107135648` passed all eleven jobs before PR #114 was merged.

Two new Node regressions failed before this change: a healthy Bridge status
erased a failed local Bank write, and a declined manual snapshot had no separate
operator error. A disposable native Chromium replay through the production Bank
composition also failed: an aborted journal transaction plus unavailable emergency
storage preserved the old Main records, but a subsequent healthy `/status`
response made the Bank headline say "הצליח" for the staged balance.

This proves false success in a local read model. It does not prove production
data loss, an unsafe cloud ACK or a duplicate provider action.

## Owner and proof

`domains/bank/local-snapshot.js` owns the original staged Bank object, its exact
signature, stable snapshot token, captured operation authority and one save task.
Its four ports are model, save, non-destructive local recovery and render.

| Observation | What it proves |
| --- | --- |
| Provider response or healthy Bridge status | Retrieval/availability only |
| New balance in the model | Temporary projection, pending confirmation |
| Literal `true` from the scoped existing save path, unchanged target | That snapshot's existing save contract completed |
| `false`, exception, changed projection or lost authority | No confirmation; do not claim success or replace pending work |

The existing persistence path may reject file export after the journal committed.
The wording is therefore **"צילום הבנק לא אושר לשמירה"**, not a claim that every
underlying store lost the edit. The Bank page and dashboard disclose temporary
balances/cashflow independently of Bridge diagnostics. A fresh status read cannot
remove that disclosure. The cloud Bank dual-head commit path is unchanged.

## Explicit retry and fences

"נסה לשמור את הצילום הקיים" is a guarded mutation, available only while the exact
projection and original write authority remain current. The command joins an
existing retry. It first invokes the established local journal recovery through
the persistence port; the recovery must return a valid ready head under the same
authority. It does not publish that recovered state over other in-memory edits.
Authority and exact projection are rechecked before the typed Bank `set` write,
after its completion and before disclosure is cleared.

The same snapshot token and transaction IDs are used. No new provider scrape,
Finance patch, archive merge, Shared Checks write or artificial ACK is invoked
by retry. Pending local confirmation gates new manual/automatic Bank scans;
existing automatic scheduling may resume after confirmation under its original
due-time policy. Stopping automation still does not cancel an in-flight commit.

An old task cannot clear or repaint a replacement task. Replacement of the Bank
projection releases its old runtime disclosure; mutation of that same object
disables obsolete replay. Account/primary changes block retry. Journal corruption
or failed recovery preserves the draft and stored records without reset/cleanup.

## Operator recovery and limits

Keep the page open after a failed write. Restore storage/file access and use the
existing-snapshot retry; do not rescan the bank to repair a local save failure.
If the projection or authorization changed, inspect storage under the current
account and use the established export/recovery flow rather than replaying an old
snapshot. An unsaved generation's unload guard is retained: confirmation of this
Bank record cannot acknowledge unrelated previously failed work.

This is an in-memory staged projection, not a new durable offline outbox. A draft
whose journal and emergency writes both failed cannot be recovered from storage
after the operator ignores the warning and closes the page. File/backup-specific
result separation, general optimistic edits and cross-tab privacy remain separate
workstreams. Rollback to the baseline requires no data migration or storage reset;
retain exports/journals and avoid relying on its old false-success disclosure.

## Verification

- `kupa_bank_operation_ownership.test.mjs`: failing-before-fix status regressions.
- `kupa_bank_local_snapshot.test.mjs`: exact-ID retry/join, false/undefined/exception,
  failed recovery, changed authority/content, old-task completion and UI disclosure.
- Strict checkJs compiles the actual snapshot owner and negative consumer fixture;
  the whole Bank controller and persisted Bank schema are not newly typechecked.
- `runtime_bank_local_publication.py` in browser-lifecycle: actual delegated retry,
  native IDB abort, emergency quota injection, Bridge status reread, dashboard
  disclosure, primary loss, one provider retrieval, unchanged raw Shared, independent
  note and exact snapshot/transaction recovery after fresh reload.
- `--baseline` replaces the former Bank controller/view only in the disposable
  site and must reproduce false success. `--phase` limits local runs.

Provider replies, quota faults and file handles are controlled test fixtures.
Native IndexedDB and app composition are real; live bank login, physical disk
exhaustion and production credentials are not exercised by these tests. Full
branch CI, including Browser/PostgreSQL/recovery/Windows, is required for merge.
