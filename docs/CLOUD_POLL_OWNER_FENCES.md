# Poll replies retain their original owner

Reviewing the newly checked Main sync bodies exposed the same authority risk
outside Morning recovery: both regular poll coordinators could continue a held
head/HTTP/adoption operation after account, storage epoch or login changed while
generation and business data happened to match. Eighteen controlled cases failed
against `41354010`, while both unchanged-scope controls passed.

Each poll now captures its original CloudWriteScope, checks it after journal,
HTTP, adoption and secondary awaits, and passes it through final confirmation.
Orders adopts only through its guarded publication callback. Kupa passes the
same cancellation callback through Main/Finance checkpoint publication and
independent Finance reads. A stale completion cannot set a conflict, publish
another account's data, show success, start new secondary reads or clear a
replacement owner's busy flag. The existing identity helper deliberately still
allows an owner to clear its own busy flag after losing primary leadership.

All 20 new poll tests pass (18 replacements and two unchanged controls). An
additional actual Kupa checkpoint regression proves cancellation after commit
cannot publish or write a conflict on the replacement. The existing 143 focused
poll/status/hydration/model/policy/source tests pass; a native Orders IDB ACK-owner
case passes as well. Existing stand-ins now provide explicit account scopes and
retain owner/epoch when replacing their fake cloud base, as production does.
The production boundary never defaults a missing scope to success.

Runtime behavior intentionally changes for obsolete continuations; normal
publication, conflict/offline behavior, protocol and storage formats are
retained. Three reviewed policy digests record the new Main/Finance publication
guards; the historical policy archive remains frozen. No module or timing gate
changes. The measured small source increase is covered by 2,000/1,000 additional
bytes for Kupa/Orders; startup graph and readability limits remain enforced.

This closes the demonstrated polling path. The explicit Kupa load/discard
command is reviewed separately in
[CLOUD_LOAD_COMMAND_SCOPE.md](CLOUD_LOAD_COMMAND_SCOPE.md); its initiating scope
must also survive every asynchronous step before further publication.
