# Local Document Bridge ports and cancellation

## Evidence

Baseline `9d2002cf` passed full verification `37795253671`. Eighteen controlled
regressions failed before this change (nine per app): five malformed successful
JSON responses, pre-cancelled search and binary preview, unavailable preferences
during anonymous health, and cancellation while decoding a preview HTTP error.
The previous clients sent pre-cancelled requests because adding an AbortSignal
listener after abort does not replay that event. The preview error decoder also
swallowed AbortError. No data overwrite was proved by these client failures.

## Owners

| Owner | Contract |
| --- | --- |
| `shared/document-bridge-client.js` | Fixed loopback HTTP protocol, response parsing, runtime-version checks, endpoint commands and cancellation/deadline scope |
| `shared/document-search/integrations/document-bridge.js` | Device pairing preferences, installed-key compatibility; constructs the client with explicit ports |
| `shared/browser-bridge-platform.js` | Browser preferences, fetch, timers and AbortController implementations, shared with Bank Bridge |
| `shared/document-search-composition.js` | Constructs the local integration and Drive provider, then binds the existing provider-routing policy |
| `domains/documents/search-source.js` | Provider selection, opaque result IDs, existing fallback eligibility and action routing |

The client has four collaborators: tokenStore (`get`/`set`), fetchRequest,
timers (`setTimeout`/`clearTimeout`) and createAbortController. It cannot access
browser globals and exposes no raw request or configurable origin. Domain code
cannot import these concrete I/O implementations. New Bridge factories retain
the five-collaborator architecture budget.

## Request scope

1. Reject an already-cancelled caller before token access, timer or network I/O.
2. Anonymous `/health` reads no token; authenticated calls require local pairing.
3. Bind one caller-abort listener and one deadline to a request-owned controller.
4. Recheck cancellation before sending, after headers and after body consumption.
5. Report cancellation/deadline with the existing `DOCUMENT_BRIDGE_ABORTED` code
   and existing caller-cancel/timeout messages. Never convert a cancelled preview
   error response into an HTTP authorization error or a successful buffered result.
6. Clear the deadline and detach the caller listener in `finally`. Concurrent
   requests remain independent. Completed requests cannot be aborted later by a
   former caller; no automatic retry is introduced.

The deadline covers JSON and binary body reads. Network failure remains
`DOCUMENT_BRIDGE_UNAVAILABLE`; the next explicit request may recover. Body I/O
must obey the supplied AbortSignal; native fetch provides that implementation.

## Protocol and compatibility

- Destination is only `http://127.0.0.1:8766`, with `cache: no-store` and
  `redirect: error`. Pairing tokens cannot follow HTTP redirects.
- Successful JSON endpoints require a non-null object. Empty, malformed, array
  and primitive bodies fail with `DOCUMENT_BRIDGE_RESPONSE_INVALID`.
- HTTP/server codes, HTTP status and rootErrors are preserved. Non-JSON HTTP
  errors retain their HTTP code. Invalid success and cancellation do not trigger
  Drive fallback; the existing fallback allowlist remains unchanged.
- Runtime version remains 38. Search, recent, matches, folder selection and PDF
  index operations retain their existing version checks and explicit upgrade path.
- Methods, endpoint paths, payloads, pagination/sort normalization, deadlines,
  binary preview bytes and opaque IDs are preserved. No filesystem/server,
  scraper, SQL, persisted business schema, cloud ACK or merge changes.
- Pairing uses `netunim_document_bridge_token_v1`; legacy Orders/Kupa keys remain
  readable. A failed best-effort canonical-key migration retains the legacy
  token. An explicit token write failure is visible and stops legacy cleanup.
  Tokens are never part of Supabase state.

## Verification

`document_bridge_client.test.mjs` tests both generated integrations with injected
ports: all endpoints, controlled cancellation and body timeouts, concurrent
requests/listener release, HTTP errors, offline recovery, installed-key restore,
version compatibility and provider-routing failure behavior. Separate construction
tests verify no storage/network I/O. Existing client/server/security/PWA contracts,
search/Drive behavior and deterministic asset parity remain required.

The generator now owns `integrations/document-*` copies as well as the existing
document domain/UI tree, including read-only drift checks and stale-copy removal.
Generated deployment files remain outputs. Full branch browser, PostgreSQL,
recovery, two-computer and Windows gates must pass before merge.

Google Drive I/O and remaining application resource/capability ownership are
separate slices; this change completes only the local Document Bridge boundary.
