# Morning recovery wake ownership

## Evidence and baseline

The baseline is main `899f2a8a2db62c2b13b6821aada0a4482f7b984f`, with
[full verification 37936370112](https://github.com/218218y/netunim/actions/runs/37936370112).
The audit's timer defect was reproduced before changing production code:

1. A retained issuance has a future recovery timer.
2. A's server ledger becomes terminal `failed`; recovery clears A's context.
3. B starts under the **same authenticated owner/login epoch**. Its create
   response is lost; the original B operation ID remains in recovery storage.
4. B's status read requests a recovery wake. A's still-authorized timer suppresses
   it. On delivery, A's callback sees a different pending ID and returns.

Two added Node regressions failed on this baseline. The native browser test also
failed at `operation B lost its recovery wake ...`, using production
`documents.js`, actual modal forms/customer editor/persistence, native Main/Shared
IndexedDB and activated account ownership. The server ledger and provider effect
are synthetic; this does not prove a live provider failure or data loss.

## Contract

A queued recovery wake belongs to the captured authorization **and operation ID**.
Repeated scheduling for the same still-authorized operation coalesces. A request
for a different pending operation cancels/replaces the old queued timer, even
within the same login. Revoked-scope replacement retains the existing behavior.

The identity check on callback delivery remains mandatory: a canceled callback
delivered late cannot clear/run the new wake. Delivery also checks current scope
and pending ID before recovery. Disposal cancels future wakes and revokes
publication; it does not cancel a durability/server commit that already began.

Scheduling is a **read/reconciliation wake**, never permission to create another
document. Existing 15/30/60/90-second delays, error handling, manual recovery,
scope-aware in-flight joins and ledger idempotency are unchanged. No change to
RPCs, SQL, persisted context, Journal, Flight, ACK, provider retry or serialization.

## Verification and recovery

- `morning_ports.test.mjs`: A -> B within one login, same-B coalescing, forced
  late A delivery, 100 operation replacements/disposal, existing 100 scope and
  listener cycles, old-finally/new-login joins and response authority races.
- `runtime_morning_recovery_timer.py` (`browser-morning`): actual issuance/status
  sequence above, one B wake, no additional create/reserve, original
  `MORNING:<B>:payment/invoice` identities and document binding, unchanged A and
  Shared journal, retained independent note, fresh-page IDB recovery.
- `--baseline` replaces only `morning-lifetime.js` in the disposable site with
  the recorded baseline, and must fail at the operation-B wake assertion.
- Full CI still includes PostgreSQL ledger, Morning UI/resolution, account
  changes, offline/recovery, two-tab/two-computer simulations and Windows gates.

If confirmation is unknown, preserve the original context and select **check
issuance status** under the original account. Do not create again or remove the
context. The old timer bug delayed automatic read recovery; the stored context
and manual recovery remained available. An older compatible website can be
restored without a data migration; never clear recovery/IDB to roll back this fix.

Cross-tab cached display privacy, Calendar multi-tab confirmation, staged model
durability warnings, remaining runtime resources, broader typing, server Bridge
decomposition and SQL inventory are separate workstreams. Live-provider and
physical two-computer drills remain operator verification requirements.
