# Document Bridge HTTP boundary

## Responsibility

`netunim-orders/document-bridge/http-handler.mjs` owns the request gate and wire
transport. `http-routes.mjs` binds seven small capability facades: service status,
PDF maintenance, search, document preview, native preview, file commands and
shutdown. The listener constructs and validates them before accepting requests.
These facades expose commands, not mutable runtime state or a service locator.

The server retains token/config filesystem ownership, Everything processes and
query normalization, opaque result IDs/expiry, preview processes, recycle-bin
deletion, index/cache state and resource shutdown. HTTP has no filesystem or
provider access. Its only private dispatch path passes the common access gate.

## Preserved external contract

1. Read the current configuration on every request. Reject an untrusted Origin
   before preflight, public health, token reads, request-body reads or commands.
2. Allow configured `OPTIONS` with existing CORS/private-network headers and
   exact `GET /health` without a pairing token. All other requests require the
   freshly read token and the existing constant-time equality check.
3. Match the exact HTTP method and request target. Query strings and trailing
   slashes do not create alternate routes. Loopback management without Origin
   remains supported with an authenticated token and `null` CORS origin.
4. Consume at most 8192 UTF-8 bytes only on existing payload-bearing routes.
   Preserve empty-body handling, error codes and legacy 400/410/503 mapping.
   Parsing does not newly validate business data: the existing implementations
   retain normalization/validation responsibilities.
5. File commands receive only `body.id`, never an arbitrary `body.path`.
   Preview preserves MIME, bytes, encoded filename, size and no-store/CORS.
6. Shutdown prepares its resources, writes the successful response, then
   schedules the existing listener/process teardown. No new cancellation or
   retry policy is introduced.

The current version is still 38; endpoints, pairing keys, configurations,
installation rollback, PDF data and client compatibility are unchanged. The
installer explicitly stages both HTTP modules before initialization/activation.

## Verification

- Fourteen characterization checks passed against the previous production
  handler/helpers before extraction, using real loopback HTTP and isolated fake
  command owners. They cover origin/token ordering, fresh settings, exact paths,
  wire arguments, body bounds, binary data, errors and the canonical client.
- `document_bridge_http.test.mjs` exercises the extracted boundary over real
  ephemeral HTTP listeners, adds authorization for every private route,
  interrupted-body handling, startup port validation and shutdown ordering.
  Everything/Windows command owners are fake in these tests.
- `document_bridge_packaging.test.mjs` walks the actual static import graph from
  `server.mjs` and verifies the transactional installer contains every dependency.
- Strict checkJs checks the actual routing body and negative consumers for
  unbound ports, untrusted fields, binary-result shape and shutdown ownership.
  This does not claim static coverage for the entire server or business inputs.
- The required Windows CI job stages the declared runtime modules, uses the
  reviewed Node 24.21.0 executable, launches the actual server in a disposable
  application directory and checks health, origin rejection, private commands,
  opaque-ID expiry and graceful process exit. Everything is deliberately
  unavailable; no provider, operator file or installed configuration is used.
  A locally occupied port 8766 is reported as NOT RUN/skip, without stopping the
  operator's bridge. CI fails if the isolated port is occupied.

The refactor is organizational, not a claim of a new production security bug.
Index/preview decomposition and live-provider/Windows installation drills remain
separate work. Rollback restores the previous complete versioned runtime; keep
the new server and its two imported modules together when installing this slice.
