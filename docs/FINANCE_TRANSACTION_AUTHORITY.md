# Finance transaction authority

`shared/finance-lease-transport.js` is the checked request/response boundary used
by both real cloud transports. Requests retain the SQL lease names, token,
bounded TTL, retry flag and captured request scope. Responses start as `unknown`.
Claims use the existing strict receipt decoder. Releases accept only a literal
boolean or the supported literal `released` object, with a single-row envelope;
ambiguous HTTP success fails with unknown confirmation, never success.

Captured account authority is checked before the request, after the response,
after reading its body, and on rejected request/body promises. This closes the
previous Kupa release-body gap and prevents late transport errors from borrowing
a replacement account's authority. A release is not a document write receipt.

`shared/finance-fence.js` now strictly checks its real operation-scope, fence
payload and manual queue implementations. A manual callback receives only an
acquired credit lease with its exact requested token and a safe positive numeric
fence, or an explicit local grant. Mixed local/cloud evidence, truthy acquired
flags, foreign tokens and malformed epochs cannot run the mutation, wait blindly
or release a lease. A literal refusal may wait using the existing bounded queue.
The queue still serializes edits, rebases inside its callback and preserves a
confirmed save when cleanup fails. Scope loss leaves the old account's lease to
expire instead of releasing through a new login.

The strict fixture imports canonical and both generated implementations. It
rejects asynchronous authority, wrong lease names, response bodies masquerading
as grants, invalid fence fields and lost generic command result types. Four
implementation mutations verify that the checker sees real bodies; a behavioral
mutation verifies that removing token comparison changes the forbidden outcome.
Both native app compositions also pass a valid-grant/provider-failure scenario
with retained journal data. Existing malformed-claim, renewal, ownership,
publication, contention and write-confirmation scenarios remain active.

This slice covers lease RPCs and manual edit authorization. It does not claim
full static coverage of every business RPC, journal/IDB caller or provider row.
