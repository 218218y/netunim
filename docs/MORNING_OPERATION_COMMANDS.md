# Morning operation commands and reconciliation

## Evidence before the change

Main `93950d9bce818260a404b8c2803432071e728c44` had scoped JSON transport,
accepted-work drain and separate debt application. Successful operation JSON
still entered business decisions after only an object check.

Six focused regressions failed before this change. A reservation with a foreign
or missing operation ID could persist recovery and enter create. Recovery could
clear the current local operation when a status response identified a different
failed/reserved operation, or certified creation with an invalid date or a
boolean amount. These are controlled synthetic failures, not a claim of observed
production data loss.

## Authority boundary

`morning-operation-commands.js` exposes exactly status, reserve, create and
abandonReservation. Issuance and recovery consume this capability instead of an
arbitrary action/backend callback. Captured authority is asserted before send
and after response delivery; expected identity is captured before awaiting JSON.
`morning-operation-evidence.js` accepts unknown data and builds selected typed
results only after validation.

Ledger and reservation replies must identify the exact requested operation.
Created ledger rows need a real document identity, supported type, positive cent
amount and parseable verification time. Official create replies must match the
submitted type and amount. Abandonment can clear recovery only with literal true
and a matching failed ledger row. Optional confirmation flags must be boolean;
Bank operation/document evidence must agree with the enclosing response.

Failure envelopes also carry authority: HTTP status, uncertainty, duplicate
prevention and adopted operation identity affect cleanup/retry. Malformed error
details lose that authority and are reported as an invalid operation response,
without a supposedly safely retryable status. Valid explicit rejections and
deduplication replies keep their established meanings. A deduplication response
may intentionally identify an earlier operation and is not forced to the new ID.

SQL decimal amount strings and historical textual document identities remain
supported after validation. The recovery v1/v2 readers, persisted key, provider
request, SQL, journal/ACK protocol and backup format are unchanged. The browser's
PDF/search request capability remains separate.

## Reconciliation capability

`morning-recovery.js` receives five ports: lifetime, commands, recovery,
application and publication. It owns the reconciliation decision sequence and
joins the existing scoped flight. It has no DOM, raw debt model, arbitrary JSON
transport, local persistence API or timer implementation. The controller supplies
the existing recovery storage/state adapters and terminal cleanup policy.

The actual extracted recovery function reconstructs the immutable pre-media AST
from main `4d97e2a007ba5eed3db636ce3a900a57439392c5`. Financial allocation,
decision confirmation, settlement, request-loss/retry policy and wake delays are
preserved for valid responses. Invalid evidence is stopped before these rules
can receive authority.

## Verification and remaining work

Focused tests cover the six reproduced gaps, current states, unknown envelopes,
decimal/historical reads, Bank consistency, valid duplicate errors and retained
recovery after a malformed post-create rejection. Strict checkJs checks the actual
decoder, command, issuance and recovery implementations; negative consumers and
four body mutations reject invented identity, unvalidated result, textual issue
completion and fabricated recovery success.

The native browser fixture exercises seven malformed-response cases through real
transport/controller/recovery code. Its 42 assertions retain exact recovery and
native Main/Shared journals, prevent extra mutation requests, then resume the
original operation after valid evidence. The existing wake fixture now uses the
producer's actual `pending` state in place of its test-only `creating` label.
Full Git CI with PostgreSQL, native browser/IDB and Windows remains the merge gate.

Issuance form/presentation, status display coordination, customer composition
width and complete search/metadata/provider payload decoding remain open. This
slice does not claim live-provider verification or complete application typing.
