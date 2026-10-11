# Calendar display authority and resources

## Evidence

Baseline: `b4e200ae3c373a2eeb23cba49b5bd34c1577d863` (PR #117).
Its full main verification passed at
[run 38120149326](https://github.com/218218y/netunim/actions/runs/38120149326).
The new native browser regression failed before the fix: a completed private
Calendar event remained displayed after logout. This proves a presentation
privacy defect, not lost or duplicated business data.

Reproduce the former behavior in a disposable profile only:
`python tests/runtime_calendar_account_privacy.py --baseline --surface board --phase local`.
That command intentionally fails against the baseline modules copied into the
test site. It does not change workspace sources or any installed browser data.

## Display policy and cache compatibility

A local Calendar cache now records the authenticated application `owner` that
performed the verified Google read. It is distinct from `accountId`, the Google
account. Preferences alone do not prove this relationship. A display read uses
one native readonly transaction over cache, pending operations, and the Google
account metadata. The selected cache must match the current application owner
and the durable Google account; pending calendar IDs must belong to that cache's
calendar list. The caller checks its login/connection epoch after the await.

This adds one attribution field to replaceable display-cache snapshots. It
does not change the IndexedDB version/stores, queued operation format, stable
Google IDs, RPCs, Google retry/reconciliation policy, Main/Shared journal or ACK.
Historical caches with no `owner` remain intact, but cannot be attributed by
guessing. They show an authentication notice until an authorized Google refresh
creates an attributed snapshot. This is an intentional privacy behavior change.
Afterward the same authenticated application owner can reopen its cache and
pending overlay offline, including after reload. Logout/different application
owner cannot display that cache. Previously shipped readers can still read the
extra cache field; a cache rewritten by an older version needs verification
again. No migration or automatic queue deletion is involved.

Attribution is an application display policy, not encryption or protection
against someone who can modify the browser's physical storage. Revoking Google
consent remotely cannot be discovered while the application remains offline.

## Presentation and operation ownership

The Calendar capability subscribes to the existing production account observer.
Local logout, replacement account, same-user relogin, cross-tab credential
change, and focus/visibility revalidation invalidate its private model, owned
board, editor/quick/details window, unaccepted delete confirmation, delayed
day click and animation frames. An unrelated feature's modal and another
Calendar owner's mount remain untouched. New editor openings capture fresh
authority; a save/delete already started keeps its original authority across
the confirmation, append, overlay read, close, toast and wake.

An append whose native transaction started may finish after logout. It retains
the exact sequence/event ID/body. Its old completion cannot publish success,
reopen cached content, close a new account's modal, or launch a replacement
account's sync. No UI cancellation signal is passed to that durable write.
Google delivery and its existing immutable-ID recovery remain separately owned.

`start()` is idempotent. `dispose()` removes this capability's account and browser
subscriptions, poll interval, reconnect/day timers and animation callbacks; it
is final and idempotent. Queued wakeups and in-flight continuations are fenced
by the presentation lifetime. Cleanup never clears the IDB queue/cache or
aborts a durability transaction. A disposed owner cannot start networking.

## Verification and limits

- Native UI/auth/IndexedDB: board, full editor, quick editor and delete
  confirmation, each under local logout, logout in a second tab and A-to-B
  replacement (12 profiles). Each runs 100 real composition start/dispose
  cycles and checks retained queue/cache/Main/Shared, listener/poller counts,
  same-owner offline reopening and unrelated modal preservation.
- Controlled native transaction-completion races: account replacement after
  cache read and after a committed append. Exact pending IDs/content survive;
  former-account publication/toast/modal cleanup is rejected.
- Historical ownerless cache remains unchanged while locked; a
  verified refresh delivers the same pending IDs and authorizes later offline
  display. Existing offline UI creation/reload and Calendar pending/recovery
  suites remain mandatory.
- Native display-read abort reports the error, observes request and transaction
  rejection together, and leaves all stores unchanged without an unhandled
  rejection.
- Strict checkJs checks the actual display authorization/lifetime bodies and
  negative consumers, alongside the existing Calendar auth/queue contracts.

Providers/OAuth endpoints are synthetic; the browser, production composition,
account store, second tab, DOM and IndexedDB are real. This does not certify live
Google consent or two physical computers. Idle cross-tab pending notifications,
competing delivery ownership and other business-page caches remain separate
work. Full branch CI, including Browser/PostgreSQL/recovery/Windows gates, is
required before merge.

## Operator and rollback notes

For an old cache authentication notice, sign into the correct application
account and refresh Calendar online once. If old pending belongs to another
Google account, restore that Google connection; the existing mismatch guard
retains the queue. Never reset storage or create replacement events to remove
the notice. Attributed offline cache can reopen for the same application owner.

Site rollback keeps the same queue/cache stores and stable event IDs. Preserve
exports and queue diagnostics; older code lacks this presentation privacy
protection. Returning to this version may require a fresh verified read if the
older version rewrote an unattributed cache.
