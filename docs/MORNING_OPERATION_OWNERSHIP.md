# Morning issuance, recovery and publication authority

## Evidence before the change

The preceding full baseline is main `9503e267599c847749a83d065d7d9b3cc11461a1`
([verification](https://github.com/218218y/netunim/actions/runs/37894408701)).
Test-only commit `393c69173715355611ebc647ed787d3b354015ce` reproduced the
authority gap before changing production code. In
[the diagnostic run](https://github.com/218218y/netunim/actions/runs/37898310569),
12 controlled Node cases and 12 native IndexedDB cases failed as expected.

The native drill used disposable synthetic Main journals A/B, with the same
debt ID but independent note identities. It paused response headers, JSON body,
Main refresh or completion after a rightful local append. An account switch,
same-user new login or primary loss occurred while paused. Before the fix,
recovery could append the A document to B's journal, or clear recovery and report
success under revoked authority. These are isolated test results, not evidence
that a production user's data was lost.

## Ownership contract

`core/morning-operation-scope.js` captures authenticated owner + login epoch.
The composition root supplies live storage owner, recovery/protocol readiness
and primary/write access. Write assertions require all of these throughout the
operation; readable secondary tabs can view authorized documents without issuing
or allocating them. Token refresh preserves the login epoch; a new login does not.

`integrations/morning.js` is the Orders-owned transport implementation, constructed
once in customer composition and passed as a small JSON/PDF request port. It
checks the same receipt before send, after headers and after JSON/blob consumption.
It passes `assertRequestScope` into Supabase's queue/session/401 handling and
retains `networkRetry:false`. A malformed JSON response cannot become an empty
successful object. Explicit server rejection retains its status/code/details.

The customer owner carries that receipt through confirmation, reservation,
persisted recovery, official create, verification, cloud refresh, synchronous
local allocation, recovery cleanup, bank notification and PDF/success publication.
`MORNING_OPERATION_SCOPE_CHANGED` stops the old continuation. It cannot publish,
clear recovery, abandon a reservation or issue again under the new login.

## Committed effects and recovery

Server issuance and local publication are distinct. A provider/server effect
that completed before authority changed is not rolled back. A started local
journal append can finish under its original owner; revoked completion cannot
claim success or erase recovery. Recovery retains the existing operation ID and
uses the owner's authoritative server ledger before applying anything locally.
Stable `MORNING:<operationId>:payment/invoice` event IDs keep replay idempotent.

Persisted recovery key and v1/v2 readers are unchanged. Historical recovery has
no embedded account field: the owner-filtered server ledger must verify the
exact operation, document type and cent amount before local allocation. A record
not visible to the current owner remains unresolved; it is not rebound or erased
because a different account's status read returned no operation.

If response delivery fails after official create, do not create again. Reopen
the original account, select **check issuance status**, and reconcile the same
operation. An explicit safe pre-POST reservation cancellation remains the existing
server decision. No new automatic issue retry, RPC, SQL, journal/ACK behavior,
schema or backup serialization is introduced.

## Runtime and display

The Morning lifetime owns interruption listeners, one recovery wakeup and
scope-specific in-flight joins. Disposal removes listeners, cancels future work
and revokes publication without discarding started durability work. A stale timer
or task's `finally` cannot remove a newer login's task. PDF/metadata publication
is fenced; the latest preview wins within an account and old account responses
cannot overwrite it. Capability disposal releases its Blob URLs.

Previously displayed content is not automatically cleared in every other tab
when auth changes. A cross-tab cached-display/privacy policy, remaining download
link cleanup and broader runtime resource inventory are separate completion
tracks. This slice does not claim a durable offline issuance outbox or live
provider verification.

## Verification

`morning_operation_ownership.test.mjs` retains recovery across all 12 races.
`morning_ports.test.mjs` covers captured write/read authority, JSON/PDF body races,
malformed responses, reservation failure, lost create response, task coalescing
and 100 resource cycles. Browser tests protect latest PDF publication/disposal.
Strict checkJs compiles the actual scope/transport bodies and negative consumers.

`runtime_morning_ownership.py` repeats 12 races with native IndexedDB, then resumes
the original account and proves exact event IDs/content after browser reload, retained notes and no
foreign-journal change or duplicate effect. Three additional cases exercise the
production customer composition, real login epochs and owner activation.
Existing Morning UI/audit/resolution, PostgreSQL ledger/idempotency, Main/Shared
recovery and Windows verification remain mandatory CI gates before merge.
