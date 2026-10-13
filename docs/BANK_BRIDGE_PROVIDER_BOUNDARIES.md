# Bank Bridge provider and session boundaries

## Evidence and scope

Baseline `f2231edc92d78bce5a88087023a94bd7a04db239` already owned accepted
configuration/provider operations and process shutdown. However, server.mjs
still contained session authentication, login adapter state, readiness polling,
bank scraper allocation/termination and multi-profile credit orchestration.
This stage separates those responsibilities. It changes their composition,
without inventing a provider malfunction or changing issuer policy.

Twenty before-change characterization tests exercised the actual existing
functions with controlled browser/connector ports. After extraction their
fixtures import actual inert factories. The temporary lexical provider/session
harnesses were removed; browser page.evaluate test callbacks still execute in a
synthetic browser context, as expected for that external boundary.

## Required capabilities

| Module | Public API | Ownership and required ports |
| --- | --- | --- |
| `hapoalim-session.mjs` | decorate, ready, reuse, safeUrl | Per-scraper terminal login state; metadata reader, explicit clock/delay and bounded terminal-result waiter |
| `hapoalim-provider.mjs` | read | Per-command scraper and diagnostic run; browser, session, account reads, diagnostics, image housekeeping, session metadata and version |
| `credit-session.mjs` | scrape | Connector attempt; browser lookup/library, identity directory, concrete adapter factory and diagnostics |
| `credit-provider.mjs` | scrape | Sequential active profiles, exclusions, cooldown eligibility, identity recovery and aggregated results; session, identity removal and diagnostics |
| `provider-errors.mjs` | stageError, runStage | Existing stage/error classification, without runtime effects |
| `server.mjs` | Concrete composition | Binds actual installed browser, pinned upstream library, filesystem/artifact writers and current provider adapters |

Factories create no browser, filesystem job, timer or provider request. Missing
required effects fail at construction. The bank provider retains the scraper
through diagnostic finalization and awaited termination. Finance commands retain
the existing exclusive operation reservation until that provider promise and
subsequent metadata publication finish. Partial account evidence and best-effort
diagnostic/cleanup errors keep their established behavior; a cleanup failure
does not replace the original bank error.

Login state stays inside each decorated scraper. Readiness polling uses scoped,
awaited delays through an explicit clock; no timer handle is placed in shared
contexts. Interactive and silent terminal-result timeouts, transient-navigation
recovery, accounts API readiness, stable navigation windows, safe saved-session
paths and their existing failure taxonomy are preserved. No AbortController or
new cancellation/retry policy was added.

Credit identities remain sequential even when they share an issuer. Issuer-wide
deferral suppresses attempts; a Camoufox-only block still permits the Chromium
primary path. Expired rejected identities are removed before the next eligible
attempt, with IdentityRecovery diagnostics awaited before entry. A failed
Chromium attempt retains any existing Camoufox cooldown. Raw samples remain an
internal provider result for the financial command's local diagnostic writer;
the existing command boundary strips them from public HTTP results.

## Contracts and validation

Historical `bank-provider-policy.json` remains byte-identical. The new frozen
session/error digests were captured from the baseline before moving code.
AST checks find the actual private function in its new factory and normalize
only named platform transports to their former calls: library loading, profile
directory creation, identity directory/removal, logging and clock/delay.
Branches, retry/fallback arguments, ordering and public projections remain in
the digest. Negative mutations of termination success and fallback eligibility
must change the historical digest.

Strict checkJs checks the actual bank orchestration, credit session and error
implementations. Negative consumers cover non-ready receipts, wrong account
results, asynchronous teardown/publication obligations, invalid credentials,
browser flags, connector results, identity paths and account exclusion types.
Actual implementation mutations reject presentation text substituted for the
success flag or a promised credit profile result. Account payload fields and
the upstream page/constructor are intentionally opaque at these ports; this
does not claim complete typing of bank HTTP payload parsing or issuer adapters.

Import/direct-I/O/collaborator budgets protect the provider cores, and public API
budgets prevent widening the session/provider facades. Composition cannot retain
parallel private implementations. Installer dependency-closure checks include
every extracted module. All touched/new production boundaries are linted.

Native startup also copies the actual installer module list into isolated
LOCALAPPDATA on a private port. A test-only upstream scraper executes the real
session/browser callbacks against synthetic bank responses. The real provider,
account reader, diagnostic files, HTTP command and operation owner run together.
Held browser termination must keep configuration rejected as SCRAPE_BUSY and
delay final success metadata/public response. Safe session URL publication,
real local diagnostics, coverage and shutdown are checked. No installed service,
physical browser or live provider is contacted by this fixture. Required Windows
CI includes this composition case alongside actual DPAPI and shutdown tests.

Schema, encrypted formats, persisted selectors, v73 responses, provider adapters,
deployed migrations and retry/fallback semantics remain unchanged. Full CI still
requires PostgreSQL, native browser, Windows, recovery, ACK and fault gates.

## Remaining work

Account/transaction reading and enrichment, cheque-image cache ownership and
installed-browser selection/cache remain in the server composition file. The
larger issuer adapters still require separate responsibility reviews. These are
explicit next boundaries, alongside the remaining Document Bridge orchestration
and the broader compatibility/shared cleanup roadmap. Live issuer behavior and
physical two-computer rollout require their own authorized validation.
