# Finance lease confirmation

## Evidence and boundary

Before this change, both browser transports treated HTTP 200 plus
`acquired: true` as permission to start a provider. Missing `lease_token` was
replaced with the requested token and a missing `fence_epoch` became `null`.
A foreign token could also be adopted. A malformed body instead looked like
ordinary contention, allowing the manual queue to wait and claim repeatedly.

The regression first failed against the original transports. Native Chromium
reproductions through the actual Kupa and Orders Bank/Credit compositions also
reached a simulated provider request with the incomplete grant. Provider
requests deliberately fail before any side effect. This is evidence of an
authorization boundary defect, not evidence of production duplication or data
loss. No live bank, issuer or production account is used by these tests.

## Authority remains in the server

The existing `claim_finance_sync_lease` RPC returns a single row containing
`acquired`, `leased_until`, `lease_token` and `fence_epoch`. Its successful claim
retains the requested token; an unexpired renewal retains the epoch. A refusal
can correctly report the other holder's token and epoch. The server checks the
live token, epoch and deadline again on each fenced write.

`shared/finance-lease-receipt.js` now decodes this existing response once for
both transports:

| Evidence | Result |
| --- | --- |
| One object/one-row envelope, boolean flag, nonempty bounded token, positive safe epoch and zoned timestamp | Structurally valid receipt |
| Valid grant whose token equals the captured request token | Authorized grant; receipt is immutable |
| Valid refusal, including another device's token | Normal contention; no provider entry |
| Missing/foreign granted token, invalid epoch/deadline/flag, empty or multiple rows, malformed JSON | `FINANCE_LEASE_RECEIPT_INVALID`, `kind: confirmation_unknown`, `retryable: false` |
| Authorization changes during response-body consumption | Scope failure takes precedence; no grant returned |

Numeric string epochs from the existing bigint response are accepted only as
positive safe integers. The deadline is validated as server metadata; the
decoder does not compare it to the client clock or introduce a clock-skew or
expiry policy. Extra server fields remain compatible. No lease identity is
invented from a missing response field.

The heartbeat calls this same transport. A malformed or foreign-token renewal
therefore records failure, schedules no next heartbeat and causes its running
operation's existing assertion to fail. A changed epoch is still rejected by
the existing heartbeat policy. Neither renewal nor the decoder adopts a
takeover fence.

The manual queue receives an exception for unknown confirmation, rather than
performing its contention wait/reclaim loop. It neither starts the edit nor
releases a guessed lease. Genuine refusals retain the existing bounded wait.
The deliberate computer-local `localOnly` port is separate from the remote RPC
and retains its existing behavior.

## Operator and recovery

An invalid grant stops this invocation before bank/issuer login or document
mutation. The UI reports that the cloud lease was not confirmed and no provider
entry was opened. Check connectivity, authentication and server compatibility
before another manual attempt. A successful claim whose response was unreadable
may still exist in the server until expiry; do not clear server leases or invent
a token/fence to force progress. Existing same-token authenticated network
retries and server expiry rules are unchanged.

This receipt proves permission to begin an operation; it is not a Finance
document write receipt, a Main/Shared ACK, evidence of a refreshed read model or
proof that a provider action succeeded. No changes are made to SQL, migrations,
Storage V2 bytes, provider retry/cooldown, release RPC or persisted queues.

## Verification and rollback

`finance_lease_confirmation.test.mjs` exercises both real transports with
negative responses, authentic refusals, response-body logout, malformed renewal
and manual-queue behavior. `finance_fencing.test.mjs` retains unchanged-epoch
renewal and takeover rejection. The strict JS gate compiles the real canonical
decoder and negative consumers of both generated copies.

`runtime_finance_lease_confirmation.py` runs twelve native browser profiles:
Kupa/Orders × Bank/Credit × incomplete grant/refusal/valid grant. It verifies
provider entry counts, one claim, no foreign release, visible errors, unchanged
Main/Shared stores and projection, plus fresh-document recovery of the same
note ID/content. A valid grant reaches exactly one simulated failing provider
request and releases its own lease. Existing Finance write-receipt fixtures
now return the actual requested token and complete SQL-shaped lease metadata.
The suite is part of the full browser-lifecycle CI gate.

Rollback uses the previous site revision; this change contains no data
migration, deletes no records and needs no storage reset. Keep the failing
receipt available as redacted diagnostics (field presence/type, error code),
without copying tokens, credentials or business payloads into logs. Live
provider login and physical two-computer behavior remain release drills, not
claims made by these simulated-server tests.
