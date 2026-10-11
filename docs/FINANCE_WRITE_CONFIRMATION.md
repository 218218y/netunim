# Finance write confirmation

## Proven boundary defect

Baseline: `6b0faae67bad6e58918e973eaf89ae7785db2b05` (PR #121).
Its [full verification run](https://github.com/218218y/netunim/actions/runs/38141492579)
passed the eleven canonical jobs. That baseline did not cover malformed Finance
success responses; a green baseline is not evidence for this missing case.

Three production owners previously accepted HTTP success without a valid write
receipt: Kupa `cloud/transport.saveFinancePatch`, Orders Finance mutations, and
Orders' manual Kupa settings. Orders could invent a next Kupa revision or use
zero as the minimum Finance revision, then report successful saving. Kupa could
return `saved:true` without authoritative state and let Credit publish the sent
candidate. Native browser reproductions against the baseline code confirmed
false success in all three paths. There is no claim of production data loss.

## Ownership and evidence

| Fact | Owner and proof |
| --- | --- |
| Server commit confirmed | The writing owner validates the HTTP response against its captured base revision and exact sent JSON document |
| Authoritative state | The receipt contains an object document; the sent candidate is never a substitute for a missing server state |
| Display current | Orders' scoped readout must reach the receipt's Main or Finance revision; Kupa's Credit publication/follow-up keeps its separate contract |
| Main locally committed | The existing journal/transaction/checkpoint owner, not the Finance receipt |
| Shared Checks synced | The separate Shared Checks owner; Finance does not change this status |
| Additional backup completed | The backup owner; a valid Finance receipt proves no backup outcome |

`shared/finance-write-receipt.js` validates one response row, object JSON state,
numeric revision evidence and optional operation metadata. It delegates all
revision/no-op/replay decisions to `document-write-ack.js`. The current SQL
Finance v6 wrapper returns the same revision/state/operation fields; no new
revision policy, RPC, SQL or persisted schema is introduced.

Finance owners capture the exact outgoing JSON before the first RPC await.
Credit models have derived transaction accessors and `toJSON` serialization;
comparison must use the wire document, not a mutable runtime view. This preserves
the existing wire representation. Busy retries reuse that captured document and
operation ID. Existing bounded conflict retries reread and rebase as before.

No-op receipts can retain the base revision. Replay can return a later current
head with the original operation revision. Legacy receipts without operation
metadata retain the existing exact-state no-op rule. Numeric revision strings
remain readable; null/boolean/blank revisions, impossible cursors, multiple rows,
missing state and invalid JSON cannot authorize publication.

## Unknown confirmation and recovery

A malformed HTTP-success response throws `FINANCE_WRITE_RECEIPT_INVALID`,
`kind: confirmation_unknown`, `retryable: false`. Its message says the server
may already have saved the data. The validation catch is limited to synchronous
receipt decoding; it does not swallow network failures or authorization changes.
The existing live operation assertion runs before receipt handling and later
publication. An unconfirmed result does not advance the Finance cursor, request
success publication, create a replacement operation ID, reset pending work or
automatically repeat a provider scan. This is not a durable Finance outbox.

Operator instructions:

1. Preserve local data and any Main/Shared conflict/export workflow.
2. Reconnect the matching account if authorization changed. Read the current
   cloud data before another edit or scan. Kupa has **רענן מהענן** in settings;
   Orders' regular cloud/readout refresh is a read of Finance, not a new provider
   scan. A read failure leaves the result unconfirmed.
3. Compare the setting/result with the requested change. A recovered server
   effect needs no repeated write or provider action. If still uncertain, retain
   the error for diagnosis instead of resetting storage.
4. A valid receipt followed by an unavailable readout is a separate publication
   warning: the commit remains confirmed and needs a fresh read.

## Verification and rollout

- `finance_write_confirmation.test.mjs`: missing/malformed state/revisions,
  operation metadata, ambiguous envelopes, JSON safety, legacy/current no-op,
  replay and authoritative heads through all three owners. Unknown confirmation
  sends one write, retains the projection and permits read-only recovery.
- `runtime_finance_write_confirmation.py`: six disposable native browser/IDB
  profiles exercise production composition, auth, leases and HTTP body decoders.
  The synthetic server commits but returns null or invalid JSON. The original
  Main/Shared stores remain unchanged before recovery; authorized read recovery
  retains issuer IDs and note content without another write. A new document
  runtime recovers the same durable note. The baseline replay reproduced false
  success in all three owners before the change.
- Strict checkJs checks the canonical body, both generated copies and negative
  consumers. Existing ownership, post-commit warnings, Main/Shared ACK,
  Browser/PostgreSQL, offline/PWA, two-computer and Windows gates remain required.

The first wider CI pass exposed two old model assertions reading derived `txns`
directly from a wire snapshot, and a private decoder name colliding with native
`document` in the browser test probe. Identity assertions now use the existing
Credit decoder, and the private helper has an explicit Finance name. Native
event characterization and Morning recovery pass without removing assertions
or changing application DOM behavior. The final commit requires a new full gate.

These tests simulate Finance responses, not live issuer/bank effects or physical
machine crashes. Full CI must pass for the exact branch commit before merge.
Install the compatible generated site assets and refresh loaded tabs. Rollback
is the previous application revision; no migration, queue cleanup or data reset
is needed. Rollback also restores the old false-success exposure.

Remaining separate tracks include lease/RPC input contracts, broader unknown
outcome/product policy, full transaction typing, remaining capability APIs,
Bridge servers, SQL generation/compatibility inventory and measured UI work.
