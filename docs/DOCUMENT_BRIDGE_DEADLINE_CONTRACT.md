# Document Bridge deadlines and caller cancellation

## Proven failure

On baseline main `6cf0112e`, controlled client/source regressions returned
`DOCUMENT_BRIDGE_ABORTED` for request deadlines while the caller signal was
still active. Global Search intentionally ignores that cancellation code.
A real Chromium reproduction with the production client, document source and
search controller confirmed that a recent-documents deadline left its spinner
visible after the response body aborted. This is an operator-facing request
outcome bug; it does not imply loss of business data.

## Request contract

| Outcome | Client error code | Presentation |
| --- | --- | --- |
| Caller cancels/supersedes a request | `DOCUMENT_BRIDGE_ABORTED` | Quiet; an old request cannot alter a newer view. |
| Request deadline expires | `DOCUMENT_BRIDGE_TIMEOUT` | Current view shows an error and explicit retry. |
| Network unavailable | `DOCUMENT_BRIDGE_UNAVAILABLE` | Existing connectivity/source policy applies. |
| Invalid successful response | `DOCUMENT_BRIDGE_RESPONSE_INVALID` | Error; no automatic source fallback. |
| Server rejects the request | Existing server/HTTP code | Existing authentication/error policy applies. |

The first cancellation cause is retained even if both caller cancellation and
the deadline fire before the promise continuation. The deadline still covers
headers and the complete response body, with the existing endpoint-specific
duration. Each request detaches its caller listener and clears its timer in
`finally`. Pre-aborted callers start no network request.

Preview metadata now accepts the same optional signal as preview bytes, search
and match lookup. The document source forwards it to the selected provider.
Calls that omit the new optional argument retain their endpoint and payload.

`DOCUMENT_BRIDGE_ABORTED` remains the cancellation code for existing consumers.
The new deadline code is deliberately excluded from local-to-Drive fallback.
No server endpoint, auth, pairing key, retry budget or business/storage format
changes are included. There are no automatic deadline retries.

## Search owner and recovery

Initial file/content search and recent documents settle deadlines as errors.
Pagination preserves already loaded rows, clears loading-more and displays the
failed page's error. Its explicit retry resumes at the retained row count;
unique-row merging remains unchanged.

Preview metadata/body errors show a diagnostic code and retry for the selected
document. Match lookup errors remain visible alongside the viewer, with their
own retry. Each match request owns its controller, checks its sequence, signal
and selected document after awaits, and releases its controller only if still
current. Retrying one search source does not restart the other search lane.

Closing or superseding a view aborts its caller scope. Late errors/queued
deadlines cannot overwrite the replacement query or preview. Error text and
diagnostic codes are HTML escaped by the canonical error presentation module.

## Verification

- Node regressions cover each deadline endpoint, both search modes, first-cause
  ordering, pre-aborted callers, response-body deadlines, independent request
  cleanup, malformed responses and no accidental Drive fallback.
- `runtime_document_deadlines.py`, in the full `browser-ui` gate, uses the
  actual canonical client, routed source and search controller in both app DOMs.
  It controls request deadlines after headers while retaining real UI scheduling.
  It verifies errors/retries for recent/file/content/paging/preview/matches,
  retained pagination rows, stale query/preview cancellation, quiet close and
  no remaining request timers or Drive calls.
- Full branch verification remains required before merge. The production
  Windows Bridge server and live provider credentials are not exercised by
  this isolated deadline test; their existing contract gates remain in CI.
