# Document search: completed-result account ownership

## Evidence

Baseline main: `ec013b1a269d300d14e5f030965910e7d9c104ff` (PR 115;
full exact-head CI run 38109029612 passed all eleven jobs).

Pre-change disposable Chromium profiles retained a completed private search and
text preview after local logout and logout in another same-origin tab. The
regression fails with `completed former-account search/preview remained visible`.
Its `--baseline` mode restores the old auth/scope/composition/search modules in
the disposable copy only and reproduces that failure. This is rendered-data
privacy evidence, not evidence of lost business data or production Google access.

## Contract and owners

- Auth owns `{owner, epoch}`. Local credential replacement completes before
  notifying observers; a listener's synchronous scope read sees that identity.
  Token refresh for the same owner preserves the epoch.
- `shared/browser-account-observation.js` owns three browser registrations,
  acquired on the first subscriber and removed on the last unsubscribe.
  Relevant localStorage events trigger a fresh session read, not adoption of
  `event.newValue`. Kupa invalidates its cached auth session before that read.
  Focus and visible-page transitions recheck the current owner.
- Queued logout/relogin events invalidate the old login even when the current
  stored value is already A again. Same-owner token-refresh events preserve
  scope; unrelated preferences and sessionStorage events do not change it.
- Composition exposes one subscription port on the existing search source.
  Provider getters remain live. Fallback, OAuth endpoints, token storage,
  network retries and wire formats are unchanged.
- Global Search cancels scheduled queries, fences in-flight publication using
  its existing sequence checks, clears result references and the old query,
  closes menus, destroys preview viewers and revokes owned Blob URLs. It shows
  an account-change message and requires a new search.
- Search and its options/filter/index controls use the shell's registration
  owner. `bind` and `dispose` are idempotent. Disposal unregisters auth and DOM
  listeners, cancels scheduled searches, hides native preview and removes its
  context menu. It does not abort an already started business commit.

The browser observer never writes credentials, changes durable owner bindings,
deletes outboxes or resets storage. Existing owner checks still decide whether a
new credential may write a business store. Auth-storage read failures retain the
loaders' fail-closed behavior; an old Drive token cannot replace missing auth.

## Verification

- `browser_account_observation.test.mjs`: local replacement, refresh, queued
  same-user relogin, live reread versus stale event payload, visibility/focus,
  irrelevant storage events, 100 listener cycles and both production auth
  implementations. External logout issues no IDB writes. A regression caught
  notification before credential replacement; moving notification after the
  existing store makes current scope coherent.
- `runtime_document_account_privacy.py`: both apps, native Chromium, actual
  same-origin second tabs and IndexedDB. Completed text/image previews vanish;
  image Blob URLs are revoked. Logout sends no Drive request with the old token,
  B receives B's results, independent pending data and raw Main/Shared journal
  stores remain unchanged. Each profile runs 100 search bind/dispose cycles.
- The stress run identified three retained content-options listeners. They and
  child control listeners now use the shell's registration port. Existing
  late-body, obsolete-query, OAuth/token-flight and explicit scope-retry browser
  regressions still pass.
- The browser observer's actual body and negative consumers are strict checkJs
  inputs; async credential reads and wrong owner/epoch consumers are rejected.

Provider/OAuth responses and the independent pending fixture are synthetic;
auth, UI, browser events and IndexedDB are real. Full branch CI remains the
release gate. These fixtures do not exercise production Google grants or two
physical computers.

## Recovery, compatibility and remaining work

After an account-change message, authenticate the intended account and start a
new search. Do not reset storage or discard pending work to restore a preview.
A compatible site rollback changes no persisted format, but restores the old
completed-result privacy limitation.

This slice owns Global Search and its Drive previews. Morning's separate display
owner now covers forms/browser/standalone PDFs and confirmations; see
MORNING_ACCOUNT_DISPLAY_PRIVACY.md. Calendar views, other domain readouts and
business-page caches need their own cross-tab review. Focus reread detects a different
current owner; it cannot reconstruct an unobserved same-user logout/relogin
from identical stored credentials. Queued browser auth storage events invalidate
that epoch when delivered; visibility checks do not fabricate a durable auth ledger.
