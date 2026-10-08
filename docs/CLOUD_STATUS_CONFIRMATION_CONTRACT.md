# Main and Shared cloud status confirmation

## Evidence and scope

Baseline: main `a91552d5`, full verification run `37756701410` passed. Ten
controlled regressions nevertheless reproduced false positive sync status:
Orders meta/row fast paths after a local edit, and both apps after leadership,
account eligibility, connectivity or journal control changed during the GET.
This proves a status/return-value defect; it does not prove data overwrite.

`cloudPoll() === true` confirms that Main's current scoped, acknowledged head
was still clean at the final check. It does not mean merely that a GET succeeded,
or acknowledge Shared Checks/Finance work. Those domains retain their separate
sync owners and status/error policy. The ongoing Orders header now aggregates
Main and Shared Checks, with Finance remaining an independent readout.

## Confirmation boundary

The canonical `shared/storage-cloud-status.js` predicate receives a scoped,
validated journal read or committed ACK receipt. It requires:

- an existing cloud base, `pending === false`, no flight and no control;
- a safe local sequence equal to the base ACK sequence;
- a safe base revision equal to the app's current cloud revision;
- when checking a GET observation, unchanged sequence, owner and epoch.

The app also checks current primary leadership, online/connection eligibility,
preparation/capability guards and the local generation. Orders checks its pending
request/work predicate and captured Main projection. Kupa verifies authenticated
account ownership and compares its Main projection with the validated base.
These checks supplement the infrastructure's owner/writer/epoch fences; the pure
predicate does not authenticate accounts or validate persisted records itself.

Orders captures the generation/projection before the first journal await.
Meta/row fast paths and successful adoption all pass the same final confirmation
after independent Shared/Finance reads. Kupa similarly confirms its completed
poll against the original scoped head after independent reads. A late generation,
flight, control or owner transition cannot be authorized by an earlier GET.

Orders no-flight save status rechecks the journal. Post-ACK status uses the
committed receipt and the generation captured for publication, so an edit during
the optional folder backup cannot confirm an earlier generation. Optional cache
read failure after ACK does not replay a committed write; existing receipt/cache
and publication contracts are preserved.

## What status does not do

An unsuccessful confirmation returns false and preserves pending records,
flights, controls, IDs and ACK/revision state. It does not clear a request to make
the UI green, perform an ACK, retire a conflict, or create a retry/restore policy.
Current offline/waiting/conflict indications remain applicable. A secondary or
ineligible account cannot publish a new status from this old poll.

The ACK and hydration protocols remain defined in
[the ACK contract](STORAGE_CLOUD_ACK_CONTRACT.md) and
[the hydration contract](STORAGE_CLOUD_HYDRATION_CONTRACT.md). No SQL, schema,
serialization, credential or RPC behavior changes in this slice.

## Source ownership and Shared confirmation

Baseline for this extension: main `c4a16a84`, full verification `37772871012`
passed. Eighteen controlled regressions exposed stale startup status overwriting
a live Main error, Shared conflicts missing from the Orders header, and Shared
success despite pending work or a late edit/logout. Four additional regressions
proved that Main and Shared local appends left an old success visible until the
scheduled cloud send started. These are status defects; they do not prove data
overwrite.

Orders `setCloud` owns the Main slot; `setChecksCloud` owns the Shared slot.
Startup records supply a fallback only until that capability publishes a live
outcome. A late Finance startup completion and timestamp refresh cannot replace
a live document outcome. Main logout clears the ledger and pins the inactive
header until Main publishes again. Finance remains outside this header, with its
existing independent view/error policy. Kupa keeps its existing separate Main
and Shared slots; check persistence now uses the Shared save/cloud ports.

Both applications publish pending status synchronously when a local append is
accepted, including an IDB-only commit still in progress. Offline indication
remains offline. This event never clears a journal, flight, conflict or ACK.

The canonical `shared/shared-checks-status.js` confirmation requires a clean,
acknowledged scoped head, `hasLocalWork === false`, and the normalized visible
checks equal to the acknowledged checks. App adapters additionally recheck the
authenticated account, primary leadership and connection eligibility after
awaits. The scoped sequence/owner/epoch observed after sync must still match the
final receipt. Optional backup receives updated Shared metadata in the existing
order; after its await the adapter reads and validates the head again. A raw
`runtime.sync() === true` is insufficient. Shared sync returns true only for
this confirmed document, without implying Main or Finance success.

Local commit failure retains the existing undurable-work guard and reports the
owning save source. A late Shared cloud error/result cannot publish against a
different authenticated account. No ACK, merge, serialization or network retry
policy changes are needed to enforce this presentation boundary.

## Verification

`cloud_poll_status_races.test.mjs` exercises controlled meta/row/journal/Shared
awaits, leadership/account/network loss, sequence/owner/epoch changes, flight and
retry/conflict controls, and unchanged clean confirmation without modifying ACK.
Orders save tests cover an edit during the optional post-ACK folder backup.
Existing Kupa isolation tests retain independent Finance progress while Main is
blocked and prevent Shared success from clearing Main conflict.

The new real-browser IndexedDB fixture in `runtime_storage.py` journals an edit
during meta GET, holds ACK after RPC success, verifies no positive status before
commit, accepts a valid no-op ACK, and recovers the exact note ID/content and
clean sequence/revision from a fresh runtime. The full CI gate additionally
checks real PostgreSQL, two-tab/two-computer, offline/PWA, restore and Windows
deployment contracts.

`cloud_document_status.test.mjs` covers source ownership, pending/flight/control,
sequence and visible-state mismatches, delayed durable reads, optional backups,
account/leadership/network changes and immediate local pending events. The Shared
fixtures in `runtime_storage.py` exercise both actual application adapters with
real IndexedDB: lost RPC response, exact immutable replay after restart, newer
offline edits, held ACK, backup-time edits, retained Main conflict and logout.
They assert original check IDs, durable sequences/revisions and no duplicate
remote commit. Only the network/ACK scheduling boundary is controlled.
