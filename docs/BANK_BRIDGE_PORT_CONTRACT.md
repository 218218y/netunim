# Local Bank Bridge ports

## Evidence and scope

Baseline main `7e9b9cf6` passed full verification `37790027579`. Both applications
had independent Bridge HTTP implementations inside their business domains. Bank
and Orders finance controllers imported those implementations to obtain pure
refresh policy. Eight controlled malformed HTTP 200 responses were accepted as
successful empty/array/string results; two JSON `null` responses were classified
as connection failure rather than invalid protocol data. No data overwrite was
proved by these client failures.

This slice creates one canonical client, app-owned integration preferences and a
pure canonical refresh policy. It changes malformed-success handling and forbids
HTTP redirects from the authenticated local endpoint. It preserves endpoint
paths, methods, payloads, pairing keys, timeout windows, refresh intervals,
cooldowns, diagnostic fields and the explicit credit endpoint rollback policy.
No scraper, credentials vault, SQL, finance lease, ACK or serialization changes.

## Owners and ports

| Component | Responsibility |
| --- | --- |
| `shared/bank-bridge-client.js` | Authenticated local request/response protocol, per-request deadline, endpoint commands, credit compatibility and cheque image validation |
| `shared/browser-bridge-platform.js` | Browser implementations of preferences, fetch, timers, clock and AbortController creation; no construction I/O |
| Each site's `integrations/bank-bridge.js` | Installed device preference keys, token trimming/storage, local opt-out and retry cooldown policy; supplies the canonical client's ports |
| `shared/finance-refresh-policy.js` | Pure four-hour bank / daily credit due predicates and intervals, with explicit `now` support |
| Domain controllers | Business validation, Shared/Finance readiness, leases, reconciliation, cloud publication and existing UI policy; receive a Bridge port from composition |

The client accepts five collaborators: `tokenStore` (`get`, `set`),
`fetchRequest`, `timers` (`setTimeout`, `clearTimeout`), `createAbortController`
and optional presentation messages. It does not expose a raw request or
configurable origin. The only destination is `http://127.0.0.1:8765`; requests
use `cache: no-store` and `redirect: error`. Pairing remains local to each browser
origin. Credentials are request bodies sent to the local Bridge, never browser
preferences or Supabase state.

## Response and resource contract

- Successful JSON endpoints require a JSON object. Empty, malformed, `null`,
  array and primitive bodies fail with `BRIDGE_RESPONSE_INVALID`; they cannot
  trigger credit fallback or be published as empty success.
- Non-success HTTP responses retain their HTTP/server error code and safe
  provider stage, HTTP status and account-selection/credit error metadata. A
  non-JSON HTTP error still fails with its HTTP status code.
- Credit falls back from `/v2/credit` to `/credit` only on `HTTP_404` or
  `NOT_FOUND`, retaining `rollbackMode`. Auth failures, timeouts, network errors,
  malformed success and other HTTP errors do not create extra attempts.
- Each request owns one AbortController and one deadline, through response-body
  consumption. Completion/error clears that deadline. Concurrent requests have
  independent ownership; aborting one cannot cancel the other.
- Network failure maps to `BRIDGE_UNAVAILABLE`; the next explicit request can
  recover. The client does not introduce an automatic network retry loop.
- Cheque images retain hash-key validation, `404 -> null`, allowed image MIME
  types and the 5 MiB limit. Image failures release the same request resources.
- A failed pairing-token write stops before sending credentials with a token
  that was not stored. Preference failures remain visible to the caller.

Endpoint-specific business schema validation remains owned by the consuming
domain and its existing models. A JSON object alone is not evidence that a bank
snapshot is valid or that cloud data was committed.

## Verification and remaining work

`bank_bridge_client.test.mjs` exercises injected ports without browser globals:
the entire bank/credit request matrix, malformed replies, auth failures, legacy
fallback, body timeout, offline recovery, concurrent deadlines, safe metadata,
credential storage, installed preference keys, cooldowns and cheque images.
Construction tests verify no storage/network I/O. Existing finance freshness,
distributed fencing, archive/read-back, credit merge and image tests remain.

Module graph rejects domain imports of integration/platform implementations and
of these concrete canonical I/O adapters. The client cannot access browser globals,
and each new factory is capped at five collaborators. `sync-assets.py` remains
the canonical distribution and service-worker generation mechanism; shared is
code sharing, not one low-level layer.

The full branch gate must also pass browser/PWA, PostgreSQL, two-tab/two-computer,
Morning, Bank Bridge and Windows deployment contracts before merge. Other
Document Bridge I/O, Kupa credit controller preference/timer ownership and finance
capability API narrowing remain separate reviewable slices.
