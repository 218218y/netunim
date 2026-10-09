# Atomic Bank confirmation and readout freshness

## Evidence and scope

Baseline: main `9201cd905d99366cf7a898f2b7d8f9d2f26564cf`, PR #107.
Its full branch CI run `37907027327` passed the eight verification groups,
Windows verification and aggregate gate. This is the prior baseline, not proof
of this change or a live provider run.

Before the fix, the actual Kupa and Orders transports accepted HTTP 200 with
empty, malformed, null, empty/multiple-row or structurally invalid Bank RPC
responses. Both controllers reported success and published the candidate.
The regression had 22 failures and four passing valid-receipt controls.
Kupa also treated a readout below either committed head as verified. Four
additional pre-publication freshness tests failed before that fix.
A further failing regression proved that a fresh first GET did not certify
publication when the subsequent cloud poll failed to reach both live heads.

These are reproduced confirmation/publication failures, not demonstrated loss
of production data. The supplied audit's already completed ACK, owner and
recovery work remains intact.

## Authoritative contract

`save_bank_sync_snapshot_v6` returns `finance_revision`, `kupa_revision`, and
`updated_at`. The underlying published implementation creates Finance at
revision 1 or increments it, and increments the existing Main document in the
same transaction. Both returned heads are positive integers. They are distinct
document heads; a generic `revision` is not this RPC's receipt.

`shared/bank-snapshot-receipt.js` validates the actual implementation's two
heads as positive safe integers, without numeric coercion. It accepts a scalar
object or exactly one PostgREST row and retains optional metadata. A malformed
200 reply produces `BANK_SNAPSHOT_RECEIPT_INVALID`, kind
`confirmation_unknown`, with `retryable: false`. A valid receipt does not grant
a Main/Shared journal ACK, nor assert that a subsequent readout is current.

Both transport adapters decode the untrusted JSON after their existing live
scope check. Controllers validate their injected port result too, before
publishing a Bank candidate. Orders passes both decoded heads into its existing
minimum-head readout contract. Kupa passes them into its Finance read port,
which refuses an older/malformed head before invoking cloud publication, and
checks the result again before clearing the readout warning. The confirmed
remote commit remains successful when its follow-up read is stale.
Kupa also checks its live published heads after the separate poll: a fresh
first GET alone cannot certify a display whose adoption was blocked or stale.

SQL, migrations, serialization, RPC arguments, leases, provider retries,
Shared Checks reconciliation, journal and ACK policy are unchanged.

## Operator recovery

- Unknown confirmation: the server may have committed. The previous display
  remains authoritative until an authorized cloud read confirms the remote
  head. The error instructs the operator to refresh from cloud before another
  scan; it does not claim an offline outbox or automatically rescan/rewrite.
- Valid commit with stale readout: the server commit remains confirmed, with
  an independent refresh warning. Refresh from cloud to obtain the current
  display; failure of that read cannot roll back the confirmed server effect.
- Existing owner/login/primary guards apply throughout. Reconnecting or reading
  under a replacement account cannot authorize publication from the old scope.

## Verification and limits

`bank_snapshot_confirmation.test.mjs` connects both actual adapters to their
controllers, covering invalid/valid receipts and the separate head floors.
`kupa_finance_cloud_ports.test.mjs` proves a stale read never reaches cloud
publication. Ownership/body/lease and Finance behavior regressions remain gates.
The decoder's actual JavaScript and negative consumers are in strict checkJs.

`runtime_bank_snapshot_confirmation.py` uses disposable browser profiles and
real IndexedDB for both applications. The simulated server commits once but
returns a null or multiple-row response through the production auth transport.
The test verifies visible unknown outcome, unchanged Main/Shared raw stores at
failure, retained Last Known Good, authorized read recovery, exact Bank
transaction ID/content, no duplicate provider/write effect, and note recovery
after a fresh-runtime reload. A read may legitimately advance checkpoint
metadata; Shared business content must remain identical.

Provider and server effects are controlled test ports. This drill is not a live
bank login or a production PostgreSQL transaction. Full branch CI retains its
Browser/PostgreSQL, two-computer, deployment, Windows and recovery gates.

Rollback uses the prior site revision; no persisted format changed and no
durable records are deleted or rewritten to an empty state by the decoder.
