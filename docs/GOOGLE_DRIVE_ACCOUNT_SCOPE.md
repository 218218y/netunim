# Google Drive integration and authorization scope

## Evidence and boundary

Before this change, four focused regressions failed. A disposable Chromium
profile reproduced the behavior in both apps through `composeDocumentSearch`:
the A token was used again after switching to B, and after logout. A controlled
late response also succeeded after the authenticated owner changed. These are
token/result ownership failures; this review does not claim business journal
data loss or evidence that a real user accessed a different user's files.

The canonical implementations now have distinct owners:

- `shared/google-drive-document-policy.js`: pure query, file normalization,
  filtering, sorting, MIME/preview decisions and Google view URL validation.
- `shared/google-drive-client.js`: managed OAuth requests, token/result caches,
  Drive pagination/metadata/download orchestration and authorization fencing.
- `shared/browser-google-drive-platform.js`: browser fetch, clock, OAuth return
  cleanup and navigation.
- `shared/document-search/integrations/document-google-drive.js`: three small
  composition ports: authenticated transport, live account scope and platform.
- `shared/authenticated-account-scope.js`: the auth capability's in-memory login
  epoch. Explicit session replacement/logout changes the epoch. A successful
  access-token refresh within the same user preserves it.

Four additional regressions through the production auth transport reproduced
OAuth disconnect replay for B after A's 401, and a stale OAuth intent sent
after refresh plus same-user relogin. Auth transport now consumes the client's
`assertRequestScope` before sending, after session acquisition, and around its
existing 401 refresh/replay. The guard is removed from fetch options. A refresh
also captures its own auth scope: an obsolete success/failure cannot replace
or clear credentials belonging to a newer login.

`sync-assets.py` generates both app implementations. Domains consume the pure
policy and injected source API; the old domain network module is removed. The
module graph enforces those import/I/O boundaries and factory budgets.

## Operation contract

The root supplies the auth capability's `{owner, epoch}` scope. Each operation
captures it on entry. The Drive client adds a local epoch for explicit
`clearToken`, connection/revocation and observed auth scope changes. All token
acceptance, cache access/publication, downloads and navigation are checked
against that entering scope. Checks cover response headers, body consumption
and final return, including fast empty-result and cached-metadata paths.

An old token acquisition cannot join a new scope, replace its credentials or
clear its outstanding acquisition in `finally`. Same-scope requests can share
one token acquisition; one caller's cancellation does not abort that shared
work for the other callers. Logout followed immediately by login to the same
user is detected by the auth epoch even without a Drive call during logout.

Successful disconnect invalidates acquisitions that began during revocation.
A late disconnect/connect response for an older login fails before clearing a
new login's cache or navigating. No token/result cache is persisted. Google
refresh credentials remain exclusively in the existing backend.

This scope describes the calling runtime's auth capability. It does not add a
global auth event bus, interrupt another tab's auth storage, or scrub results
already rendered by a completed authorized search. Newly started operations and
late responses are fenced; a new search replaces the displayed results.

## Error and recovery policy

| Outcome | Code | Behavior |
| --- | --- | --- |
| No authenticated account at entry | `google_drive_cloud_auth_required` | No OAuth/Drive request; operator must connect cloud first |
| Login/Drive scope changed during operation | `GOOGLE_DRIVE_ACCOUNT_CHANGED` | No former-scope result/navigation; visible error with explicit retry |
| Caller cancelled an obsolete query/preview | `DOCUMENT_BRIDGE_ABORTED` | Quiet cancellation; no late UI overwrite |
| Drive transport/body fails offline | `GOOGLE_DRIVE_UNAVAILABLE` | Visible failure; explicit retry can reuse valid same-scope authorization |
| Drive rejects token | `google_drive_reconnect_required` | Clear access token; no silent API replay; next explicit request reacquires |
| Invalid JSON or forbidden download | `GOOGLE_DRIVE_INVALID_RESPONSE` / `GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN` | Typed visible failure |

Existing local Everything fallback policy, OAuth scope, endpoints, preview size
bounds, resource-key headers, namespace IDs, CSP and server credentials are
preserved. This change introduces no network retry policy, journal/SQL change
or persisted auth format change.

A delayed 401 can clear only the credential used by that request. It cannot
erase a different token acquired by a newer request in the same login. An
account-scope failure in preview displays the error/retry view rather than the
previous result's Google link as a fallback. Platform-supplied user agent keeps
provider selection independent of browser globals in the domain source.

## Verification

Baseline: main `f58da20c509ded333a6f48d69e18bb843948b763`, full GitHub run
`37815860836` completed successfully before this slice. Focused local evidence
below is distinct from the full branch release gate.

- Focused Node regressions use fake ports and controlled promises for token and
  response bodies, account change, same-user relogin, cancellation, concurrent
  acquisition, revocation, offline/retry, 401/403 and malformed responses.
- The production auth modules are tested for refresh versus explicit login
  epochs, outgoing OAuth scope and obsolete refresh success/failure. Existing
  query/pagination/Workspace preview and fallback tests remain.
- `runtime_google_drive_scope.py` uses actual app DOMs and production auth ->
  composition -> integration -> source -> Global Search with disposable profiles
  and fake transports. It proves late body rejection, cache isolation, login
  epochs, token-flight fencing, visible error/retry and stale UI cancellation.
- Full CI remains the release gate for Browser, PostgreSQL, storage/recovery,
  two-tab/two-computer and Windows contracts. These fixtures do not exercise a
  real Google OAuth grant or contact production Google/Supabase accounts.
