# Credit adapter responsibility boundaries

This stage starts at `6e6376a4b64c2e277274c6e6a64dddb52d80d426`.
The remaining large `credit-adapters.mjs` combined provider routing, browser
authentication, transport, issuer normalization, month projection and diagnostics.
The change separates those existing responsibilities without replacing the
connector or changing the provider algorithms.

## Reproduced transport failure

The CAL Node fallback caught failures obtaining an HTTP response, but read
`response.text()` outside that catch. An aborted or disconnected response body
therefore leaked a raw `AbortError` or `TypeError` without the existing
`CREDIT_PROVIDER_NETWORK_ERROR`, stage and cause-name fields.

Two tests failed against the original implementation before production changes.
The transport now catches acquisition of the headers and body together, retaining
the original timeout and its `finally` cleanup. HTTP classification and JSON
parsing remain outside that network catch. The same tests pass, as do real
loopback HTTP tests that hold a response body until timeout or disconnect it after
headers arrive. Each attempt sends exactly one Node request. A browser HTTP
response remains authoritative, including 403, 429, HTML and malformed JSON;
these responses do not trigger a Node fallback.

## Canonical responsibilities

| Responsibility | Canonical implementation |
| --- | --- |
| Wire constants and synchronization horizons | `credit-adapter-wire.mjs` |
| Value/date/error conversion | `credit-value-codec.mjs` |
| Pure month plan and strictly checked sync scope | `credit-month-plan.mjs`, `credit-sync-scope.mjs` |
| HTTP classification and parsing | `credit-http-policy.mjs` |
| Browser/Node request transport and scoped timeouts | `credit-http.mjs` |
| Awaited CAL request/login delay | `credit-scheduler.mjs` |
| CAL transaction, statement, pending and frame models | `visa-cal-model.mjs` |
| CAL authenticated session, identity and login navigation | `visa-cal-session.mjs` |
| Shared diagnostic events and excluded-account capture | `credit-adapter-base.mjs` |
| CAL browser lifecycle and issuer orchestration | `visa-cal-adapter.mjs` |
| MAX transaction discovery, normalization and diagnostic evidence | `max-model.mjs` |
| MAX browser lifecycle and issuer orchestration | `max-adapter.mjs` |
| Billing-month projections and coverage/error rows | `credit-monthly-projection.mjs`, `credit-coverage.mjs` |
| Isracard/Amex DigitalV3 and existing Camoufox fallback | `isracard-group-adapter.mjs` |
| Historical generic scraper adapter | `credit-generic-adapter.mjs` |
| Provider routing | `credit-adapter-factory.mjs` |

`credit-adapters.mjs` is now an explicit re-export facade with exactly its former
35 exports and canonical function/class identities. It contains no implementation
or second write/request path. Internal helpers remain private unless another
responsibility actually consumes them. The two historical horizon exports in
`lib.mjs` re-export their canonical constants. Financial command and multi-profile
orchestration consumers import the narrow scope/wire modules directly.

Construction, browser initialization/termination, one credential submission,
request ordering, retry limits, category-error tolerance, per-month CAL isolation,
MAX discovery and excluded-account filtering retain their original behavior.
So do issuer balance/statement adjustments, pending authority, native browser
identity, core/forecast coverage, raw-data redaction and DigitalV3/Camoufox policy.
Schemas, persisted files, RPCs and deployed migrations are unchanged.

## Evidence and architecture guards

- `credit-adapter-policy.json` captures 118 original declarations from the starting
  commit: complete provider classes/methods, pure functions and wire constants.
  Formatting and import/export routing are excluded from AST identity. The only
  intentionally changed function, private `postJson`, is excluded and has the
  failing-before-change and native HTTP regressions described above. Mutation
  tests prove the fixture detects altered cleanup, fallback, account exclusion,
  request fallback and month horizons. Existing Bank policy fixtures also pass.
- The original connector, CAL statement-total and signed-amount tests continue to
  exercise the historical facade. Its export set and identities are checked
  against the baseline rather than inferred from the new implementation.
- Pure calculation/projection modules have explicit import budgets and cannot
  directly acquire fetch, browser, storage or timer authority. Existing pure
  normalization exports from `lib.mjs` are allowlisted by name. The module graph
  is acyclic; negative mutations prove the guard rejects timers, browser globals
  and new platform imports.
- The actual sync-scope implementation and negative consumers are in strict
  `checkJs`. A mutation of its numeric horizon to presentation text fails the
  compiler. The complete adapter payloads/classes remain outside strict checking;
  this stage does not claim full connector type coverage.
- The installer explicitly stages all new dependencies. Transitive closure follows
  imports and re-exports. A native staged-server test exercises the real HTTP
  command, credit session, factory, MAX adapter, serialized page callback, model,
  projection, metadata and diagnostic owners against synthetic issuer responses.
  Held browser termination prevents early response/status publication and keeps
  reset busy. Release completes the original monthly data, redacted public result
  and status/diagnostic publication before normal shutdown. This test is required
  in the Windows CI job alongside CurrentUser DPAPI and existing native tests.

Only the extracted modules and their new tests are formatted. The larger
repository, generated-copy mechanism and historical migration readers are not
reformatted or reorganized by this change.

## Remaining scope

The historical factory options remain source-compatible, including its 17 option
fields. Per-provider command ports and complete issuer input/result contracts
remain future boundary work; splitting the implementation is not evidence that
all dependency width has been solved. `lib.mjs` still combines Bank/Credit helper
responsibilities. DigitalV3 and Camoufox internals, CLI/token creation, remaining
Document Bridge orchestration, compatibility inventory and application controller
decomposition also remain in the roadmap. Live issuer sessions and physical
multi-computer checks require their own controlled environment; synthetic native
and CI coverage do not substitute for those checks.
