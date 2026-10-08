# Main cloud status confirmation

## Evidence and scope

Baseline: main `a91552d5`, full verification run `37756701410` passed. Ten
controlled regressions nevertheless reproduced false positive sync status:
Orders meta/row fast paths after a local edit, and both apps after leadership,
account eligibility, connectivity or journal control changed during the GET.
This proves a status/return-value defect; it does not prove data overwrite.

`cloudPoll() === true` confirms that Main's current scoped, acknowledged head
was still clean at the final check. It does not mean merely that a GET succeeded,
or acknowledge Shared Checks/Finance work. Those domains retain their separate
sync owners and status/error policy. Full ongoing header aggregation across all
Orders domains remains a separate review.

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
