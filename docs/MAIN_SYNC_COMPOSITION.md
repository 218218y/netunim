# Main sync owner composition

Both startup roots now bind ten stable collaborators to a dedicated Main sync
composition. The runtime factory accepts twelve explicit roles instead of 33
Orders or 42 Kupa individual dependencies. This retires the internal flat API;
only test fixtures translate older named stand-ins.

| Role | Authority |
| --- | --- |
| model / session / tab | Existing visible state, session projection and leadership observation |
| access | Live account/storage scope, preparation and Main availability |
| journal | Read the durable head, materialize/ACK/reject a flight, write control and join local commit |
| checkpoint | Authoritative adoption; Kupa also retains its existing normalization, Finance checkpoint and explicit discard paths |
| recovery | Read/commit retained journal evidence and cancel account recovery wakeups |
| projection | App-specific cloud projection, comparison, merge and visible publication |
| transport | Main reads/writes and Kupa's independent Finance read |
| view | Status, error and render publication |
| mirror | Orders working-file mirror or Kupa local backup |
| secondary | Shared Checks and independent financial readout |

Composition explicitly selects each method and binds its owner. It never
spreads the broad Storage V2 interface into Main, so unrelated authoritative
replacement/restore APIs do not become ordinary write dependencies. Root
callbacks still read live scopes and defer UI collaborators constructed later
in startup. Existing staged capabilities and initialization order are retained.

`shared/cloud-write-authority.js` now owns the identical account/epoch/login,
leadership and preparation predicate in both apps. Queued control transactions
receive the captured scope and a live synchronous assertion. Storage remains
responsible for the transaction precondition. A scope change suppresses an old
control failure; an abort/error while authority is current still propagates.
Control completion returns unknown storage evidence and cannot grant an ACK.

Kupa Main RPC serialization belongs to `cloud/main-document-write.js`, composed
by Cloud transport. The strict four-port writer preserves validation, document
target lookup, measurement, v6 endpoint selection, immutable operation ID,
delete intents, audit, priority and network retry. Its response body and row are
`unknown`; the existing write-flight/ACK owners retain authoritative decoding.
`sync/document.js` neither receives raw HTTP nor the unused Checks session.
Its existing RPC forwarding method remains for storage transfer consumers.

## Evidence and scope

- The immutable 22-function policy fixture was captured from main `04167250`
  before refactoring. Save/rebase/recovery/hydration/discard and cutover decisions
  match it. The writer permits only the three explicit dependency substitutions:
  HTTP request, document-name getter and validator.
- Production composition tests use receiver-dependent owners and real journal
  fixtures, including post-ACK local edits, independent Checks and replacement
  login during recovery. Existing Node and native IDB fixtures execute the
  grouped production factory through explicit test-only adapters.
- Strict implementation and negative consumers protect the common authority
  and Kupa writer. Mutation tests reject deferred authority and fabricated
  response evidence. Graph guards enforce twelve runtime roles, ten composition
  collaborators, explicit API selections and the raw-HTTP/Checks boundary.

This completes the composition boundary slice. Save-loop/retry coordination,
Kupa hydration/Finance publication, complete business payload contracts and
other broad controllers remain separate work. No storage format, migration,
ACK/rebase/recovery policy or live provider policy changes are introduced.
