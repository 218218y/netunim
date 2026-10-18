# Workbook storage and browser binding lifecycle

The independent workbook remains separate from Main/Shared Storage V2. It uses
the existing connection factory, with its existing version 1 database and keys.
A failed/blocked open rejects. A late success after a blocked open is closed.
Forced close invalidates only the matching cached connection. A closed connection
can be reopened once when transaction creation fails with InvalidStateError;
an already started transaction is never replayed. Workbook versionchange closes
the connection and requires a page reload rather than competing with an upgrade.

Both document replacement and draft retirement commit atomically. Synchronous
write exceptions abort the transaction; request success is never a durable receipt.
Quota/abort failures remain visible in the sync status and preserve the prior
document and draft journal. Emergency drafts remain bounded and account scoped.

The sync engine owns accepted work for the page lifetime. The workspace owns
reentrant browser bindings: dispose preserves the draft, removes all five
listeners and its polling interval, and may be called repeatedly. Rendering or
activation rebinds once. Disposed bindings cannot publish late activation text.
Disposal does not cancel an accepted durable write or clear an account's draft.

Validation: native Chromium tests in both applications cover closed/forced-close
reopening, abort after put success, quota after the first put, recovery of a failed
save's draft, and upgrade from a second connection. Deterministic tests cover late
blocked-open results and exact listener ownership across disposal/reactivation.
Existing workbook tests retain account switching, lost ACK replay and conflicts.

The existing Kupa eager closure stays at 303 modules. Additional lifecycle guards
increase source by approximately 4 KB; its source ceiling rises from 1,766,000 to
1,770,000 bytes. Runtime timing ceilings and Orders budgets remain unchanged.
