# Committed ACK, later local work, and guarded Orders recovery

## Incident evidence (2026-10-11)

Read-only captures from the affected primary computer and the remote document
proved the following. Private exports and record contents are kept outside Git.

| Evidence | Result |
| --- | --- |
| Durable metadata and checkpoint sequence | 160; matching journal epoch |
| Authoritative local base and remote document | revision 1575; equal business content |
| Committed local ACK | sequence 126 |
| Pending journal | 34 contiguous operations, 127 through 160 |
| Flight / retry / emergency draft | none |
| Review control | `concurrent-ack`, base 1574, current remote 1575 |
| Durable recovery vs portable export | equal IDs and full business content |
| Pending replay from base vs recovered checkpoint | equal IDs and full business content |
| Business differences from remote | 3 added supplier transactions, 18 changed transactions, 1 added customer debt, 1 added customer order; no removed records |

The recovered state contains 676 transactions, 58 debts and 19 customer orders.
Counts alone are insufficient: comparison uses normalized records and IDs.
The original diagnostic incorrectly treated metadata as a sealed `data` record.
Metadata is stored directly; its null sequence/epoch report was a decoder error.

Captured deployed sources match the earlier `99ca5607` lineage. They already
contain the fixed `expectedSeq` ACK fence, but predate the live account scope
guards merged in PR 125. This is not a second expected-sequence defect.

The control proves that ACK committed and its subsequent visible publication
was rejected. Historical telemetry does not identify which generation/sequence/
primary predicate changed. It does not prove production data loss. The full
capture proves that all reported local differences remain recoverable.

## Prevention: distinguish durable ACK from safe publication

Both applications preserve the existing atomic ACK, original flight operation
ID, expected candidate sequence and owner/epoch/writer fences. After a committed
ACK, a late edit may invalidate publication while leaving that ACK valid.

`cloud-post-ack-recovery.js` permits at most two immediate recovery attempts:

1. Require the same live account/login epoch, journal owner/epoch and primary.
2. Read and validate the durable checkpoint, base, controls and contiguous journal.
3. Prove that replaying post-candidate operations onto the pre-ACK visible state
   explains every current visible business edit. Unjournaled drafts do not qualify.
4. Require the exact authoritative ACK base/revision/ackSeq, no flight/control,
   and a conflict-free three-way merge of that delta with the committed candidate.
5. CAS the resulting checkpoint against scope, sequence and all three sealed
   head checksums inside the existing writer-fenced IndexedDB transaction.
6. Publish only while the captured account, generation and visible state remain
   current; drain later pending operations through the ordinary cloud owner.

This checkpoint CAS never advances ACK, changes the cloud base, deletes journal
rows or resends the old ACK as a new operation. Kupa preserves its independent
Finance projection; Main does not acquire Shared Checks ownership.

Real merge conflicts, undurable edits, storage errors, foreign scopes or
continuous writes exceeding the two-attempt budget remain pending/fenced for
review. Scope loss cannot write a control or start a follow-up for the new login.

## Existing blocked computer: explicit review, backup, and CAS

The new Orders settings action **בדיקה וחידוש סנכרון** does not automatically
clear historical controls. It supports only `concurrent-ack`, with no flight or
retry, and only while the remote revision/content exactly equals the retained
authoritative base. If the remote advanced, stop for three-way review.

Preparation is read-only. It validates the full journal, proves recovery equals
the displayed business state, and separately replays every pending operation
from the authoritative base to prove the checkpoint is explained by the journal.
It exports a combined private backup of local state, remote state and the raw
Main protocol stores. A plaintext review lists changed records/fields and warns
when detail is truncated; the complete data remains in the downloaded file.

After the operator verifies the backup and approves the differences, the action
re-reads the remote and checks the one-use review context. An atomic CAS writes
the verified checkpoint and retires only the exact reviewed concurrent-ACK
control. Sequence, epoch, writer, base/ACK, raw journal and existing IDs stay
unchanged. The normal pending-flight/RPC/ACK path then saves the remaining work.

The healthy computer and production data are never modified by local fault
injection. A fake remote revision reached during a disposable replay is not a
production commit.

## Operator runbook

1. Preserve both the original export and the full read-only IndexedDB capture.
   Avoid edits on other computers during the short review/resume window.
2. Deploy the verified website version. On the affected computer, close extra
   Orders tabs and reload the remaining tab without clearing site storage.
3. Open Settings and select **בדיקה וחידוש סנכרון**. Check the downloaded
   `orders-sync-recovery_*.json` is present before proceeding.
4. Review the revision, pending count and business differences. Approve only
   intended additions/changes/deletions with **הגיבוי נשמר — חדש סנכרון**.
5. If the action refuses the scope, journal, remote or review context, preserve
   the new backup and obtain a fresh read-only diagnostic. Do not reset,
   discard local work, import over the cloud or clear controls in DevTools.
6. Verify no pending/control/flight remains, and a fresh remote read plus the
   other computer shows the same IDs/content. A revision may increase normally
   for remaining pending work; do not rely on a green pill or counts alone.

## Verification and limits

Failing-before-fix Node and native-IDB regressions reproduce permanent fencing
after a benign edit. Tests cover remote additions, explicit deletions, conflicts,
unjournaled drafts, CAS races, bounded retries and login/leadership loss.
Review tests cover advanced/changed remote, stale local/head/control/review,
aborted transactions and unexplained checksum-valid checkpoint content.
The native UI test downloads the actual combined backup, cancels without writes,
then approves through the production confirmation UI. Business text is displayed
as text, not HTML. Fresh-page recovery compares full business content and IDs.

An operator-only `runtime_post_ack_recovery.py --app orders --phase review
--private-snapshot PATH` replay uses a disposable native-IDB profile and fake RPC.
It sends no data to Supabase. The affected capture passed this replay with all
34 operations retained and acknowledged in simulation, and fresh-page content
equal to the original export. Actual production recovery requires the operator
steps above. Full branch CI retains Browser/PostgreSQL, multitab, simulated
two-browser-device, offline/PWA and Windows gates. These do not claim live bank
provider, physical OS crash or physical two-computer validation.

## Rollback

No persisted schema/version, RPC, SQL or provider retry policy changed. Older
code can still read the same records. If deployment is rolled back, keep the
combined backups and journal; an older site may retain the conservative review
fence. Rollback never clears storage or synthesizes an ACK.
