# Checked cloud transports — 2026-10-25

Both actual application `cloud/transport.js` implementations now join strict
checkJs. Injected HTTP requests return an explicit response whose `json()` is
`Promise<unknown>`; parsed text remains unknown too. Canonical Main/Shared,
Finance, bank archive/snapshot, lease and restore readers retain ownership of
admission. Selecting the first raw RPC value does not grant it record, revision,
ACK or local-commit authority. Protocol-state output stays unknown for its
existing protocol reader. Scoped request callbacks remain synchronous.

Cloud read and receipt-returning methods have explicit output contracts so
substitution of raw JSON cannot silently change their inferred API. A Finance
patch distinguishes skipped work from a saved result with a Finance receipt.
Main RPC envelope admission remains separate from the later sent-state/revision
ACK validation. The Main writer's measurement callback returns void; it supplies
no authorization evidence. No request names, payload fields, retries or provider
policies change.

The Kupa validator and shared notes normalizer are real dependencies of the
checked transport graph. Their source fields stay unknown until existing shape,
identity and workbook-parent checks run. Historical coercion, zero/missing
values, clipboard parsing and normalization are preserved: 1,434 local
input/output/error comparisons against `737e4ce7` matched. Snapshot rows retain
their original transaction data while exposing the array already validated by
the canonical bank reader. Generic error text and unknown RPC selection use the
existing response-evidence module, with no new eager module or declaration facade.

Validation: strict compilation, focused ESLint, 244 behavior/policy tests and the
first two new compiler tests pass locally. The other three actual-body mutations
remain in the required CI suite. Negative consumers reject raw RPC values used
as ACK/local admission, deferred authority, invalid document/group identity and
unread protocol evidence. Mutation cases replace decoded cloud, bank, Finance
and restore results with raw wire/display values.

There are 331 explicit roots (207 product implementations and 124 fixtures).
Eager graphs remain 310/406 modules and measure 1,857,762/2,481,790 source bytes
(Kupa/Orders). Source ceilings rise by 8,000 each for measured contract text and
small field guards; time/module ceilings remain unchanged.

The two broad Sync Document composition bodies are still outside strict roots.
The independently reproduced Morning reply race is repaired by its own stage;
this transport stage does not claim full coordinator, cashflow or Bridge
coverage. TypeScript remains pinned to 6.0.3.
