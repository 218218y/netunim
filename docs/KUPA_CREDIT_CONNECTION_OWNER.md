# Kupa Credit local connection ownership

Baseline: `665d6245eca1d8500f5ba7ed689480f882a1f57b` (PR #161).

Ten before-change regressions proved actual boundary failures: late status/error
publication after Bridge pairing replacement, late clipboard/download results,
deletion through a replacement pairing after confirmation, late save effects,
out-of-order status, former-pairing provider publication, reset confirmation and
an accepted profile save closing a replacement form. The separate command
acceptance test also prevents introducing a microtask gap in the new owner.

## Current boundary

`domains/credit/connection-owner.js` owns local device status, profile lookup,
connection save/delete, diagnostic commands, accepted promises and read
generations. Six explicit ports supply pairing identity, Bridge transport,
presentation, native effects, current cloud-profile projection and canonical
protocol metadata. Construction
does not read storage, send requests or open UI. The owner acquires no browser,
network, timer or storage globals.

`commands`, `queries` and `runtime` are the only owner roles. A captured device
permit binds the observed pairing token and private generation; observing a
different token invalidates cached status and local-profile credential retention.
Only the latest started status observation may publish. Late results and errors
from a replaced pairing cannot download/copy, report private errors or update UI.
Accepted clipboard/network work remains drainable; disposal closes new work and
later effects without pretending an already accepted request was cancelled.

This is a local device boundary. It grants no authenticated Finance authority,
issuer lease, document confirmation or storage ACK. Financial refresh/reset
combine the device permit with their existing captured account/write guard.
Renewal/release retain their separate account authority and drain ordering.
Provider fallback/cooldown and document merge/publication policy are unchanged.

`composition/credit.js` creates and disposes/drains the private owner alongside
the controller and editor. The financial controller decreases from 17 to 16
collaborators and drops local status/profile fields and direct connection or
diagnostic Bridge calls. It retains provider/Finance/automation orchestration;
that remaining responsibility is not claimed as fully decomposed.

The native connection dialog owns successful modal closure. After saving it
checks its generation and exact form identity before closing. An old accepted
save may update the same device's read model, but cannot close a newer form.
The unused `closeModal` service port is removed from Finance-to-Credit binding.
The existing public UI commands remain current APIs; no old controller-input
facade is retained in production. A test-only helper constructs the real new
owners for older focused fixtures.

## Verification and limits

- Focused production capability/controller cases exercise pairing change,
  latest-read publication, cloud authority, reset/delete confirmations,
  accepted clipboard drain, disposal and exact form replacement.
- A native suite covers held status success/error, diagnostic, delete/reset
  confirmation and accepted form save. Actual production composition, HTTP
  decoding, DOM/anchor behavior and real Main/Shared IDB are exercised; retained
  note identity/content survives fresh-runtime reload.
- Existing native Credit capability, publication, lease and preference suites
  remain in the full gate. The new suite is in the canonical CI inventory.
- Strict checkJs compiles the actual owner body. Negative consumers reject
  numeric device identity, synchronous transport, nonboolean confirmation,
  async download effects, wrong projection shape, numeric profile IDs and
  synthetic Finance/durability receipts. An actual-body mutation from boolean
  local-profile evidence to display text fails compilation.
- Five immutable baseline hashes preserve canonical Bridge wire/fallback,
  Kupa pairing integration, issuer feed merge, Finance publication and credential
  input. Password spaces, leading zeros, provider policy and persisted fields
  are preserved. Budgets protect the six-port owner, 16-port controller and
  absence of direct platform I/O.

Complete provider payload/controller typing, Orders local connection ownership,
Bank orchestration and historical-reader retirement remain separate work. Full
GitHub push/PR verification is required; synthetic loopback fixtures do not
certify a live issuer or physical multi-computer environment.
