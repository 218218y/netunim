# Finance hydration and Bank publication — 26 October 2026

The Kupa incident reported at 20:56:21 Asia/Jerusalem was investigated through Supabase logs, read-only document captures and isolated reproductions. No business records were changed during diagnosis. Private snapshots and record details are retained outside Git.

## Proven causes

1. The cloud Finance document was valid JSON. Both application credit normalizers recreated an enumerable `category: undefined` whenever an issuer transaction had no category. In the captured Finance revision 390 this introduced 744 invalid paths, including monthly transactions and their flattened aliases. The actual Kupa `applyFinanceOnlyRow` rejected that result with `storage_non_json_value` at `storage-json-codec.js:23`, before writing its checkpoint. A synthetic native Chromium/IndexedDB reproduction failed with the same error.
2. After a confirmed Bank save, Kupa assigned the candidate Bank snapshot directly to the visible model before the cloud read owner adopted its Main/Finance heads. The changed snapshot token and sequence made Main differ from its old base despite there being no pending journal operation. The actual poll then persisted `storage-v2-dirty-head`. This was reproduced using the real snapshot command, polling and adoption owners, and independently with native IndexedDB.

Supabase logs show successful Bank archive/snapshot RPCs before the incident. The codec correctly rejected the client-generated non-JSON value; weakening it or silently stripping arbitrary fields would hide the producer bug.

## Changes

Credit normalization now omits an absent optional category and preserves a meaningful category as text. The wire representation for previously absent categories remains the same as JSON serialization of the former model. IDs, amounts, pending status and monthly evidence are preserved in both applications.

Bank snapshot commands no longer publish their candidate directly into Main. The cloud read owner validates, checkpoints and publishes the returned heads. A read newer than the committed receipt remains authoritative; an older candidate cannot overwrite it. An unverified read leaves the prior local readout and an explicit warning, while the confirmed remote commit remains recorded. It does not trigger another financial write.

The existing guarded recovery for a clean `storage-v2-dirty-head` remains unchanged. It checks the durable journal and base before clearing that specific fence. No general conflict bypass, local-data deletion, bulk reset, new retry loop or database migration is introduced.

## Validation

Focused tests cover absent/blank/present categories, monthly/pending/unassigned transactions, strict JSON checkpoint validity and round trips. Native Chromium/IndexedDB covers independent Finance hydration, confirmed Bank readback, a newer returned head, repeated reads, fresh journal recovery, preservation of notes, and retirement of an old proven-clean fence. Existing receipt, stale-read, authority-loss, hydration and post-ACK tests remain applicable.

The morning Orders incident is separate. Supabase recorded an Orders journal conflict at 10:46:42 and its later `clean_verified` resolution. The immediately preceding cloud versions differ only in one note's content and update timestamp. The user reports one editing computer and has no original console/control evidence. A native repeated-typing/post-ACK scenario passed with all edits durable and no remaining conflict. These observations do not prove the cause of that historical incident, so no speculative Orders conflict logic was changed.
