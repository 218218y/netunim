# Document Bridge search and opaque result ownership

The HTTP server now normalizes a request through its existing query policy and
delegates the search/recent command to a strict owner with five role APIs:
Everything reads, PDF read preparation/projection, ordering, opaque publication
and audit. Pagination, supplemental merging, final-page publication and accepted
command lifetime belong together. This owner cannot open, delete, preview or
choose an arbitrary file. The Everything transport and its exact exit-8 reprobe
policy remain unchanged in the server.

A separate strict result registry owns private paths, opaque IDs, exact expiry,
file-stat resolution and case-insensitive invalidation through clock, identity
and filesystem-stat ports. Public records retain their existing fields and do
not acquire a full path. An already accepted file command retains its captured
row across a stat await, including invalidation or registry disposal; new commands
cannot reacquire a retired ID. Preview/PDF invalidation stays with the existing
document command and cache/index owners.

## Reproduced lifetime gaps

The old content search used `Promise.all`: malformed Everything output returned
its error while an accepted PDF-index load was still running. A controlled native
process and the actual production PDF preparation reproduce the original early
return. The new owner joins both reads and throws the first observed failure.
Production PDF preparation handles its load failure as a partial index; separate
defensive port-failure tests cover the reverse order and prove that later malformed
stdout cannot replace an earlier error or mint IDs.

Shutdown seals new commands, retires the registry and awaits accepted search and
audit work alongside maintenance and native preview disposal. Held native reads
and authenticated loopback HTTP verify that no late result gets a new ID or a
successful response. A command accepted immediately before disposal starts no
provider work if it has not entered execution yet.

The installer's old 2.5-second shutdown request deadline was shorter than existing
30-second searches, their exit-8 reprobe and maintenance drain. Its private stop
request now allows 120 seconds before applying the existing listener/process
checks. This extends only the caller deadline, without changing ES timeouts,
retries, forced-stop policy, wire version or response fields. An actual native
HTTP stop-client fixture holds and joins a production search before port release.

## Preserved behavior and scope

An immutable fixture records the original server declarations before production
editing. Executed old/current comparisons cover 4,608 search combinations and
108 recent requests: all eight file filters, four sorts, both directions, default,
fractional/capped limits, offsets through 5,000, case-insensitive duplicates,
partial PDF results, exact response/log/ES arguments and private resolved rows.
Query errors, exact TTL boundaries and missing-file messages are preserved.
The actual Everything decoder/reprobe function still matches its original token
digest. Strict consumer contracts and body mutations reject text limits/expiry,
deferred publication and disposal that does not join its work. Installer closure
tests require both new modules in transactional staging.

This completes search merge/pagination and opaque-result ownership, not the whole
Document Bridge decomposition. Everything discovery/startup, PDF reconciliation,
scheduled maintenance and installer/doctor orchestration remain explicit work.
Native fixtures use synthetic processes and files; they do not certify live
Everything, installed Preview Handlers or a real Windows installation update.
