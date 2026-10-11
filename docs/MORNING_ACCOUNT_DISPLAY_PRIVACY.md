# Morning account display privacy

## Reproduced failure and boundary

Baseline `4053039dd2217dd7fb7e16c0135e36ecd2c113e4` already fenced late
Morning JSON/PDF results and issuance against account/login changes. It did not
invalidate completed displays. A native browser regression opened the actual
customer form and a Blob PDF, logged out through the actual auth store, and
failed because the former-account form remained mounted.

The customer capability now explicitly receives the existing auth subscription.
Its two presentation owners cover the issuance form, invoice picker/document
browser, details, standalone PDF, download fallback links, and unaccepted
issuance confirmation. Local logout, account replacement and login epoch changes
invalidate them; real same-origin auth storage events and focus/visibility
rechecks use the already established browser auth observation contract.

## Presentation ownership

`morning-display-lifetime.js` owns a subscription and a presentation signal.
Invalidation removes private modal content only if the current modal still
contains that instance's exact mounted surface. Another capability's modal and
a newer Morning owner's surface are preserved; disposal of an unmounted owner
cannot clear a newer display with the same element ID.
Preview URLs are revoked; lookup/result caches and row references are cleared;
fallback download anchors and their removal timers are released. New displays
require a fresh scope/read, rather than reusing completed account data.

The signal is passed **only** to an unaccepted confirmation. The modal queue
removes a revoked queued request or resolves the matching active request false,
clears its private text, and preserves other requests. Accepting a confirmation
detaches its cancellation listener. Visual teardown cannot cancel a server
operation or durable write that has started. Existing operation scopes still
govern reservation, issuance, ACK/reconciliation and late publication.

An unsubmitted form draft is cleared on authorization change, without being
described as saved. No context, Journal, Flight, owner binding, Main/Shared data,
or ledger is deleted. A persisted uncertain issuance retains its same operation
ID. An auth change does not request a rescan, new issuance, or automatic retry.

## Evidence and limits

- `runtime_morning_account_privacy.py` exercises the actual production customer
  composition with native auth, UI, Blob URLs, two tabs and IndexedDB. Four
  surfaces are tested under local logout, cross-tab logout and account A -> B.
  Relogin requires a fresh search; old links cannot fetch while unauthorized;
  another capability's modal survives; raw Main/Shared and the exact pending
  recovery context stay unchanged. Each profile performs 100 domain owner
  construct/dispose cycles with no retained auth/offline/visibility listeners.
- `--baseline --surface form --phase local` restores the baseline modules only
  in a disposable browser copy and must fail the retained-view assertion.
- `morning_display_lifetime.test.mjs` covers presentation cancellation, renewal,
  started durable work and 100 subscription cycles. Actual modal queue tests in
  `morning_confirmation_cancellation.test.mjs` cover active/queued/already-aborted
  requests, private text erasure and accepted actions surviving later teardown.
- Strict checkJs checks the actual display lifetime body and negative consumers.
  Existing Morning ownership/ledger/recovery, native IDB and database gates remain
  required for the exact branch revision.

Server/OAuth/PDF responses are synthetic. This does not prove live provider
login, physical two-computer operation, or revocation of a document already
downloaded/opened in an external browser window. Calendar and other business
cached views retain their own owners and require separate evidence. A missed
same-user logout/relogin cannot be reconstructed from identical stored
credentials; delivered auth events invalidate the epoch as documented in
`DOCUMENT_SEARCH_ACCOUNT_PRIVACY.md`.

## Operator recovery and rollback

After the account-change message, authenticate the original intended account
and reopen Morning. If an issuance was started, use **check issuance status**
to reconcile the existing operation ID; do not submit a replacement or reset
local storage to restore a preview. An unsubmitted draft requires fresh entry.

This change modifies no persisted schema, wire bytes, provider retry policy,
SQL or ACK semantics. A compatible site rollback retains data and recovery
contexts, but reintroduces the completed-display privacy limitation.
