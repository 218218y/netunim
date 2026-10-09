# Calendar account authority and durable delivery

## Evidence and baseline

Baseline: `50da7b251283a659698a206ee76e430a7fe4485c` (PR #108).
[Full branch verification](https://github.com/218218y/netunim/actions/runs/37924793425)
passed, including 1,821 Node tests, browser groups, PostgreSQL and Windows.

Before this change, `calendar_account_scope.test.mjs` reproduced nine failures:
cached credentials survived logout/account replacement/relogin, late OAuth
responses published credentials, a new account joined an old restoration, and
a late Google 401 cleared the new account's credential. Its same-login refresh
control passed. `calendar_sync_scope.test.mjs` separately reproduced six
continuation/publication failures after local queue, metadata, delivery, Google
read and cache awaits. An additional resume regression proved that a wrapper
returned `true` even when the underlying sync rejected its former authority.
These prove authority and reporting bugs; they do not prove lost business data.

## Authority contract

The composition root injects `cloudAuth.getAccountScope()` into Calendar auth.
An operation captures the authenticated Supabase owner, its login epoch and
the Calendar connection epoch. Explicit logout, account change, same-user
relogin or Calendar disconnection revokes the captured operation. A same-login
Supabase access-token refresh preserves it. A missing account cannot restore,
use or send a Google credential. Credentials remain memory-only.

OAuth request dispatch, response headers, body decoding and credential
publication recheck the original operation. The cloud transport also receives
its synchronous request assertion. Restoration coalesces only within that
authority; an old task's error/finally cannot clear a newer credential, apply
its recovery cooldown to a new owner or release the new owner's promise.
Existing bounded 15/30/60/120-second backend recovery delays remain unchanged.

Google API pagination and the four bounded read workers retain one operation
across the entire batch. Each request and response publication checks it;
neither a later page nor the next worker acquires a replacement account.
A 401 rejects only the credential actually sent. Provider rejection keeps the
current login epoch so its error can be reported; explicit user disconnection
revokes the operation. The existing verified Google-account/pending-queue
mismatch policy remains in force.

The controller checks that same operation after local reads, account metadata,
journal delivery, Google reads and cache commits. Only a completed current
sync returns `true` or publishes a success. Resume propagates that result.
An old sync/reconnect cannot release a newer task's busy flag/promise, report
its errors in the new login, or launch its delayed reconnect under new authority.
This is an operation fence, not a central service locator or scheduler.

## Commit and replay contract

Calendar's existing IDB queue is separate from Main/Shared Storage V2.
An event keeps its preassigned Google ID, body and ordered local sequence.
Queue reads and every delivery/acknowledgement continuation are fenced before
another request or deletion. An already-started local acknowledgement may
finish; revocation stops the next operation and stale publication.

If Google created an event but its response is late after revocation, the
client cannot confirm that result: it retains the queued operation. An explicit
authorized recovery retries that same ID. A Google 409 then requires GET and
comparison of ID, summary, description, location and date boundaries before
local acknowledgement. It never invents a replacement ID or rolls back a
possibly committed server event. Patch/delete semantics, Google endpoint
parameters, schema/wire formats and provider retry policy are unchanged.

## Verification and operational recovery

- Node regressions cover revocation at token headers/body, cached authority,
  same-login refresh, new-account restoration, late 401, current-owner cooldown,
  queue-read continuation, controller await boundaries and new-task ownership.
- `runtime_calendar_ownership.py` runs actual composition, auth, API, journal
  and controller with native Chromium/IndexedDB in four disposable profiles.
  Controlled OAuth/Google responses cover account replacement, logout and
  same-user relogin at token and committed-event bodies. Pending survives a
  fresh runtime with exact ID/content. Recovery creates exactly one synthetic
  server effect; an already committed event uses 409 + verified GET. Main/Shared
  raw stores and an independent durable note remain unchanged. A second reload
  retains the confirmed event cache and empty queue.
- The existing Calendar UI suite still checks offline editing, dates, views,
  optimistic pending overlays and queue survival on reload.
- Strict checkJs checks the actual auth body and negative account/epoch/port
  consumers. API, journal and controller bodies are not yet fully typechecked.
- Full branch CI is required before merge. Controlled endpoints are not proof
  of live Google OAuth/provider behavior or a production two-computer drill.

After logout during delivery, reconnect to the original cloud/Google account
and explicitly refresh. Pending data must remain available until verified
delivery. Do not clear IDB, switch Google accounts to drain an old queue, or
manually create a replacement event for an uncertain response. A mismatching
existing event remains a visible conflict instead of an automatic ACK.

## Remaining scope

This change does not add an authentication event bus between tabs or clear
already displayed offline cache on another tab's logout. It does not claim
complete Calendar listener/timer disposal, fence every local editor dialog,
or certify all concurrent-append/status interleavings. The subsequent
CALENDAR_PENDING_CONFIRMATION.md documents the now-covered read/cache/queue
append races and owned wakeup. Other interleavings still require their own
behavioral evidence, privacy/product policy and ownership slices. Main/Shared
Journal, SQL migrations, remote ACK and other providers are unchanged.
