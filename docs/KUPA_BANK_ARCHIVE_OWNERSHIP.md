# Kupa Bank archive readout ownership

Starting main: `5d3008d7147c20a7eefe142143d0499fccaf4c40`.
Four tests failed against its actual controller: failed rows completed hydration
before an accepted snapshot settled; verification released a Finance lease and
drain completed with that sibling pending; an ordinary late rejection reported
former-account error details after handoff; pre-refresh hydration displayed an
uncommitted archive while a Bank refresh was still pending. These are controlled
reproductions, not evidence of a production data-loss incident.

## Ownership and retained policy

`domains/bank/archive-readout.js` owns role caches, hydration flights and accepted
reads. Six explicit ports provide live read authority, current feed targets,
row/snapshot readers, connection-mode access, display publication and reporting.
Construction is inert. Its narrow queries/commands and runtime expose matching
readout, verification reads, confirmed publication, archive-ID invalidation,
ensure/pause/resume, idempotent disposal and drain.

Bank composition creates and disposes the owner and drains its work. Controller
collaborators decrease from 28 to 26. It pauses hydration before preflight and
resumes in finally, including automatic-attempt/lease/provider failures. Started
reads remain owned, but background publication and later-role starts are fenced.
Stopping automatic scheduling preserves accepted operations under valid scope;
disposal closes publication, clears private readout and retains accepted work
until it settles.

Kupa retains its local/file snapshot and recovery policy. Cloud display loads
all years; verification retains the 370-day window. Partial home failure retains
accepted business projection and unchanged home candidates. Confirmed publication
keeps Kupa's existing revision/render timing. Acknowledgement invalidates only
matching `archiveId` projections and reloads them; it does not patch IDs or write
Main/Shared journals. `archive-model.js` handles pure feed projection.

`shared/bank-archive-read-batch.js` is the canonical paired-read algorithm used by
both Kupa and Orders. Callers own its returned promise through all accepted row
and snapshot reads, including after synchronous/asynchronous failure. It keeps
the original start order and first error, unless authority changed. It supplies
no cache, timers, business write or journal ACK. Generated copies remain managed
by `sync-assets.py`; separate application owners retain their different display,
mutation and lifecycle semantics.

## Verification and limits

The four pre-change failures pass after extraction. Focused owner tests cover
same-login joins, re-login, unchanged home projection, partial failure, atomic
permit checking, acknowledgement identity, pause and disposal of current,
superseded and direct verification reads. Fifteen frozen declaration digests
preserve local-save, money, feed, archive-coverage and snapshot policies. Negative
mutations detect lost coverage, rounding and local persistence.

Five native browser cases use the actual Kupa capability and real Main/Shared
IndexedDB checkpoints: hydration failure, account handoff, verification failure,
disposal/drain and hydration during Bank refresh. They retain exact journals and
note identity/content, expose no candidate archive and perform no Bank write.
Provider/cloud responses are synthetic. Existing local/file, receipt, lost
response, home-failure, alert and automation suites remain required.

The actual Kupa owner and shared batch compile with strict `checkJs`; negative
consumers reject wrong roles, identities, async authority, invalid row payloads,
private permits and fabricated ACKs. Body mutations to numeric rows fail in both
the shared batch and Kupa cache. Import/effect/collaborator budgets prevent broad
platform dependencies. Full branch CI remains the deployment gate.

Complete controllers, Finance lease/RPC consumers, other Bridge orchestration
and compatibility inventory remain separate work. Historical persisted readers,
provider retry/fallback behavior, wire formats and database schema are unchanged.
See [remaining major work](ARCHITECTURE_REMAINING_WORK.md).
