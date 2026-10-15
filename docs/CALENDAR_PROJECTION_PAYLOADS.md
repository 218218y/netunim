# Calendar read models and Google payload evidence

This slice starts from `cb53a17504020a26dc7ea8af27b03a5849d78ce4`.
It keeps the existing session capability and local journal delivery policy.

## Boundaries

- `domains/calendar/read-model.js` owns event identity, permissions, day/time
  projection and pending insert/patch/delete overlays. It accepts snapshots and
  operations and returns new display records without writing either input.
- `domains/calendar/presentation.js` projects a readonly display model into the
  board and toolbar. Its only other input escapes text; it has no DOM, session,
  journal, provider or scheduling authority. Current time is supplied explicitly.
- `domains/calendar/editor-payload.js` owns synchronous full/quick form parsing
  through one field reader. Existing trimming, error order, all-day exclusive end
  dates, timed/multi-day validation and defaults remain unchanged.
- `calendar/payload.js` decodes network `unknown` into Google calendars/events,
  paginated responses, identity-bound event replies and safe error text.
  `calendar/api.js` invokes those decoders before returning success to the session
  or journal. These six production modules, including the existing period/date
  helpers, are now covered by strict `checkJs`.

The controller decreases from 41,494 to 28,981 source bytes. It retains its sixteen
composition inputs and mounted display/confirmation authority. Editor modal
markup, status presentation and accepted queue commands remain in the controller;
this is not a claim that every Calendar responsibility has been extracted.

## Reproduced correctness gap

Previously a successful HTTP response with malformed JSON, `{}`, or an event
with another ID could reach journal acknowledgement. A malformed list could also
be interpreted as an empty collection and overwrite a verified cache. The native
`--baseline` regression replaces only the API in the disposable site with the
starting implementation; `insert-empty` fails with
`malformed success falsely completed Calendar sync`.

The API now rejects malformed envelopes, identities, authority-bearing field
types, attendees and date/time boundaries before cache publication or ACK.
Application-owned `_calendar*` and `_pending*` fields never come from Google.
Unmodeled Google resource fields remain unknown. Empty lists, hidden/read-only
calendars, future access roles (without invented write permission), zero-duration
provider events and sparse cancelled tombstones remain supported. Event replies
must match the requested/client-generated identity; invalid evidence retains the
original durable operation. DELETE requires an empty successful body. Existing
HTTP 401, 404/410 and 409 handling stays intact, including GET/content confirmation
after a lost create response.

Google's documented [event representations](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [CalendarList entries](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
inform the boundary: deleted events can be sparse, and timed boundaries can carry
an offset or explicit IANA timezone. This slice preserves the application's
existing timezone/display policy rather than introducing a conversion library.

Pagination rejects repeated continuation tokens. The four-worker event reader
joins all already accepted reads on failure and stops starting subsequent reads;
the session cannot finish/drain while a sibling response is still pending. No
provider retry, refresh cadence, cache range or delivery order is changed.

## Evidence and limits

- The new immutable fixture records the original 24 function declarations and
  token digests before editing production. AST comparisons allow only projection
  names and the fallback-calendar parameter. Older immutable Calendar digests are
  still checked against those original declarations and current semantic ASTs.
- Executed comparisons cover 54 permission/overlay scenarios, five day boundaries
  per event, 24 board/toolbar combinations and full/quick editor outcomes. Input
  snapshots and queues remain unchanged by projection.
- API/journal regressions cover malformed lists/events/replies, spoofed internal
  flags, identity mismatches, safe HTTP errors, repeated pages and held siblings.
  Strict negative consumers and actual-body mutations protect identity, synchronous
  presentation and editor payload types.
- `runtime_calendar_payload.py` runs seven real browser/IndexedDB cases, then
  reloads before verified recovery. Original sequence, event identity/body and
  cached rows survive failure. Main/Shared raw records remain equal around each
  operation, and an unrelated durable note survives restart. Local focused cases
  cover `insert-empty` and `event-page`; all seven belong to the canonical CI gate.
- The existing native delivery fixture now models Google's full PATCH response
  by merging the patch into a complete prior event, preserving its original
  ordering, account, aborted-ACK and recovery assertions.

No persisted format, OAuth/SQL/RPC contract, Service Worker strategy or Main/Shared
writer changed. The generated Service Worker includes the four new modules.
Unknown-data contracts for persisted Calendar rows, broader editor command
ownership, Morning metadata/forms and live Google verification remain separate
work; controlled browser fixtures do not certify a live provider.
