# Calendar persisted trust boundary

IndexedDB is an input boundary. `calendar/persisted-records.js` decodes queue
commands, durable sequences/retry metadata, range caches and Google account
metadata before any delivery, sync confirmation or display authorization.

Malformed pending work is never filtered, acknowledged, rewritten or discarded.
The whole read fails with `calendar_persisted_record_invalid`. Valid historical
operations can omit retry annotations; an unattributed historical cache remains
data without an app-owner display grant. Valid operation IDs and outbound body
bytes are retained, including supported partial PATCH bodies. Retry updates may
change only attempts, attempt time and error text, never queued identity/body.

Cached events are validated against the calendar list in the same snapshot.
Their calendar attribution must exist, a cached edit role cannot contradict the
calendar-list role, and transient optimistic flags never become stored evidence.
This is structural validation and display attribution, not proof of Google's
current server permissions or a Google ACK.

`transaction.js` installs terminal handlers before requests, joins native
completion/abort, and retains the original request/decoder failure. Queue commit
hints follow successful native completion only. Queue confirmation still decodes
and publishes synchronously inside its readonly transaction; no await opens a
cross-tab gap before confirmation.

The editor's save/delete commands now live in `domains/calendar/editor-commands.js`.
The controller retains modal presentation, admission and accepted-work drain.
Its immutable editor policy fixture permits only surface/form port substitutions.

Evidence includes malformed-input unit tests, positive and negative static
consumers, request-versus-transaction completion tests, and a real-IDB browser
test with 38 rejected reads/writes/confirmations. The latter checks unchanged
durable rows, no commit hint or publication, and successful recovery after the
exact test-only original rows are restored. Existing account, cross-tab queue,
delivery, UI and PWA suites remain in the full CI gate.
