# Morning historical debt metadata: local confirmation and retry

## Evidence and scope

Baseline: main `c2bd3507766485cf80f885a338f81964c093deb9` (PR #113), containing
tested head `5c5a5f7774f27b3cbbf92e400e2d9f0736c0a13e`. Its
[full branch verification](https://github.com/218218y/netunim/actions/runs/38105681464)
passed all 11 jobs and 1,895 Node tests.

Three new Node regressions failed before production changes. The old metadata
callback mutated the debt, returned a synchronous staging result and skipped a
subsequent attempt when the same metadata was already in memory. Hydration
ignored that result and removed `data-morning-debt-operation` unconditionally.

The native UI reproduction held delivery of a real journal transaction's
completion. The actual composed browser removed its marker before the caller
received that completion. `runtime_morning_metadata.py --baseline` reproduces
`metadata completed before native commit receipt` in a disposable copy. This is
premature local completion and missing retry evidence, not proof of a lost
Morning document or duplicate provider issuance.

## Local commit port

`storagePersistence.commitSave(message, options)` keeps `scheduleSave`'s existing
API. It observes the generation produced by that call and captures its current
commit promise synchronously. It requires a nonempty explicit operations contract
before staging; the architecture gate covers this new mutation port as well.
A rejected primary action cannot confirm an older
promise. A failed synchronous emergency write can succeed through the actual
IDB-only commit. The promise must resolve `true` and the generation must no
longer be undurable; false, undefined, missing or rejected receipts cannot confirm.

This proves **this local save**, not remote ACK, projection freshness or absence
of newer work. The caller retains its account/operation fence across the await.
The existing emergency journal, IDB engine, owner fences and serialized formats
are unchanged. No failed generation is artificially acknowledged or cleared.

## Metadata ownership

`morning-metadata-persistence.js` owns four small ports: model, operation scope,
mutation policy and confirmed local save. It validates complete verified metadata,
stages through the existing debt save path and joins only the same debt,
operation/signature and valid login scope. Completed confirmations are cached
separately from staged values. Unchanged **unconfirmed** metadata is re-persisted;
an in-memory equality check cannot stand in for durability.

After commit it rechecks the original login/write authority, current debt object
and metadata signature. An old completion cannot publish for a new login, clear
its newer task or bind a replacement/deleted debt. The existing mutable model is
retained: concurrent edits include the staged link and a late completion does not
replace a whole debt from an obsolete snapshot.

## Operator state and recovery

Hydration awaits the local result and checks scope and button identity again.
Only confirmed completion removes the recovery marker. An authoritative provider
document remains viewable when local persistence fails, with **לא נשמר בחוב**
on its label and a title distinguishing Morning verification from local storage.
Both the table and debt-progress dialog retain pending/failed markers on rerender.
An explicit refresh/render retries the existing local link; status reads are
cached under the original scope. This never invokes reserve/create or rescans a
provider and is not a new automatic retry loop.

If storage failed, keep the window open and restore storage availability. The
existing journal recovery can reopen the original owner; refreshing the link can
then persist the same operation/document ID. Inspect the existing unsaved warning
and a verified journal recovery before reloading. A successful metadata retry
does **not** erase other failed local generations or claim the entire Main head
is saved. The unload guard may conservatively remain until reload/recovery;
the native abort test explicitly preserves that guard.

No server ledger, issuance/allocation policy, debt payment/invoice totals, event
IDs, SQL, RPC/ACK, Shared Checks or persisted schema change. The original Morning
operation remains the read-based recovery identity after a restart.

## Verification and remaining work

- Node: failure/retry, delayed commit, account epoch change, concurrent hydration,
  rejection observation, deleted/replaced button, rerendered warning, mutation
  policy, old/new login overlap; local receipt true/false/undefined/rejection,
  IDB-only write, rejected secondary action and promise replacement.
- Native Chromium through actual composition/editor/modal/IDB: completion delivery
  held, transaction abort plus controlled emergency QuotaExceededError, relogin.
  The aborted Main stores remain byte-identical; explicit recovery/retry retains
  operation/document IDs and payment progress, independent note and raw Shared.
  A fresh runtime reload reads the confirmed metadata and original note.
- Morning/token authority is synthetic; only read-only status is answered.
  No live Morning/provider operation or physical disk exhaustion is certified.
- Full branch CI remains required: contracts, models/typecheck, Browser real IDB,
  recovery/two-runtime sync, PostgreSQL and Windows deployment contracts.

Rollback restores a compatible site without deleting a journal or migrating DB.
General Bank/customer edits before durable commit, full business command typing,
cross-tab cached display/privacy and resource disposal remain separate reviews.
