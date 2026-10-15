# Durable owner binding authority

The public storage-owner module now only composes browser/database defaults.
Its actual authority body lives in the strictly checked storage-owner-binding
implementation; database replies are unknown until decoded. No declaration facade
stands in for implementation checking.

Reproduced gaps: completed handoffs were discarded before validating their app,
identity or phase; cache failure occurred after in-memory owner/readiness changes;
a failed refresh could leave an earlier binding writable. Pending writes also
left admission open while an owner transition was unobserved.

Binding generations/identities/reservations and handoff phases/directions now
validate without coercion. A pending handoff must agree with the binding owner.
Completed history is validated, then ignored as history: it need not describe the
latest generation, and no modern transfer proof is invented for it. Metadata is
retained. Invalid evidence is never rewritten or deleted.

Cache verification precedes in-memory publication. Accepted writes close admission
until replies verify identity, generation and immutable transition fields. A failed
read/cache/write revokes authority; refresh may restore it from valid durable data.
Unexpected identity patches are rejected before IDB. Leadership is checked again
after writes. Browser/IDB composition remains explicit.

Closing admission does not cancel an accepted journal receipt. Main and Shared
Checks capture commit authority for the verified owner/generation when creating
their journal. That authority permits queued local commits during source freeze;
new edits still require writable admission. Lost leadership, failed verification
or another generation revoke it. The existing native unblurred-note transfer
fixture exercises this distinction through restart in both applications.

Evidence: strict implementation plus negative consumers, malformed/unknown/completed
record matrices, cache/activation failures, held/substituted replies, leadership
loss, preserved historical records and a mutation recreating the former completed
record unlock. Native IndexedDB tests retain checksum-valid malformed records and
prove refresh/cache failure recovery in both apps. Existing account/offline and
owner-transfer suites remain enabled. Startup ceilings are unchanged.

Remaining: the IDB ownership transaction body and coherent multi-store snapshot
are the next slice. Whole business-journal/runtime strict typing is not claimed.
