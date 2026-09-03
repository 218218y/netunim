# Credit Connector v2 — implementation and rollout report

## Decision

The proposed direction was correct, with three changes required to make it safe in production:

1. `syncedAt` must represent a complete **Core coverage** refresh, not merely “some request returned data”. A forecast-only partial result must not postpone the next daily Core refresh.
2. Last Known Good must be merged at `profile + card + YYYY-MM`; keeping only a monolithic profile snapshot cannot distinguish fresh, stale, and never-fetched months.
3. Persistent Camoufox storage alone is not sufficient. The generated Camoufox config/seeds and the persistent Firefox context must both be reused and verified across two real process launches.

## Implemented architecture

- Bridge contract: `Credit Connector contractVersion = 2`, Bridge v28.
- Provider boundary: `CreditProviderAdapter`, `VisaCalAdapter`, `MaxAdapter`, `IsracardAdapter`, and `AmexAdapter`.
- Visa Cal: one browser/login/session, followed by isolated Frames, Pending, and `card + YYYY-MM` API reads. No month retry is performed inside the run.
- Coverage: the 130-day history through next month is Core; later issuer months through `+12` are Forecast enrichment.
- Core failure: slice outcomes are returned for diagnosis, but an existing profile's business data is not replaced; only failed coverage markers become stale/missing, and neither the profile nor global successful timestamp advances.
- Forecast failure: returns `CREDIT_PARTIAL_FORECAST`; successful Core data advances while the failed forecast slice remains stale/missing.
- Monthly persistence: feed v4 stores `month`, `tier`, `status`, `fetchStatus`, `fetchedAt`, normalized transactions, provider schema version, and last safe error fields.
- Cloud payloads contain normalized financial data and safe errors only. Credentials, authorization values, cookies, browser profiles, raw login bodies, and raw HTML remain outside the state document.
- Amex/Isracard Camoufox fallback: one local identity directory per provider + hashed login identity, with a persistent `user_data_dir` and atomically persisted Camoufox config.
- 403 before credentials: one attempt, `CREDIT_AUTOMATION_BLOCKED`, then a 24-hour per-profile automatic circuit breaker.
- 429: preserves issuer `Retry-After`; when absent, a conservative 24-hour fallback is used. No retry occurs before the saved not-before time.
- Normal background cadence is approximately daily (24 hours from the last shared successful Core refresh). Ordinary failed automatic attempts are also locally spaced by 24 hours.
- Diagnostics: local JSONL only, allowlisted fields, correlation ID, 1 MiB rotation, five files, 30-day retention, and an authenticated loopback summary endpoint.
- Rollback: the installer retains the prior runtime under `app-rollback`; both web clients prefer `/v2/credit/*` and fall back only on a 404 to the v27 `/credit/*` contract.

## Root causes addressed

| Root cause | Effect before v2 | Correction |
|---|---|---|
| Generic Cal `scrape()` was all-or-nothing | One rejected future month discarded otherwise valid cards/months | Cal login/session separated from per-month API reads |
| Monolithic cloud profile snapshot | Partial refresh could not preserve and label individual old months | Deterministic per-month LKG merge |
| Success clock was too coarse | Partial data could suppress the next daily repair attempt | Clock advances only when at least one profile completes Core; per-profile clock advances only for that profile’s complete Core |
| Camoufox generated state was ephemeral | A later launch could present a new observable browser identity | Persistent profile + persisted config/seeds + two-launch integration probe |
| Historical 403 handling rotated anonymous identities | Extra issuer/WAF pressure without authenticated progress | Exactly one anonymous attempt and durable cooldown |
| Retry timing did not fully preserve issuer intent | Premature re-entry after rate limiting | Exact `Retry-After` propagation and local deferral |
| Errors were too generic | Support could not tell login, session, schema, network, and rate-limit failures apart | Stage-aware taxonomy, correlation IDs, safe diagnostic fingerprint |
| Raising the feed version reused the old migration predicate | A v3 user’s newer manual adjustments could be deleted during v4 normalization | Destructive historical cleanup is now explicitly limited to source versions below 3 |
| Installer replaced the only runtime copy | Operational rollback required rebuilding an old package | Staged health gate, preserved runtime, and swap-based rollback helper |

## Data and migration safety

- There is no destructive database migration and no Supabase schema change.
- Existing v1-v3 credit feeds are normalized into the v4 monthly representation on read.
- Existing issuer/profile/card data is retained when a new slice fails.
- Failed refreshes do not replace a known month with an empty array.
- A month that never succeeded is marked `missing`; an older successful slice whose refresh failed is marked `stale`.
- Runtime `txns` remains compatible with existing calculations, while JSON serialization stores transactions once under month slices.
- No future installment is generated. Forecast calculations consume only issuer-supplied rows.

## Installation and rollout

1. Do not deploy the web apps until deterministic verification and the live checks below pass.
2. Run `netunim-kupa\bank-bridge\install_bank_bridge.bat` on one canary Windows computer. The installer stages dependencies, provisions Camoufox, verifies real two-launch identity continuity, and activates v28 only after the doctor succeeds.
3. Verify `http://127.0.0.1:8765/health` reports `version: 28` and `creditContractVersion: 2`.
4. Run one manual diagnostic refresh for each provider separately.
5. Compare per-card transaction counts, monthly totals, Frames/Pending behavior, and the 130-day/+12-month coverage against v27 and the issuer UI.
6. Confirm a second silent refresh reuses Amex trusted-device/session state and does not create another identity directory.
7. Allow several daily canary cycles; inspect only the sanitized local diagnostic summary.
8. After parity is confirmed, deploy Kupa and Orders and install v28 on the remaining refresh computers. Other computers will continue to see the last shared normalized result but keep their own credentials/browser state.

No live deployment was performed by this change set.

## Rollback

- Run `%LOCALAPPDATA%\NetunimKupaBankBridge\rollback_bank_bridge.bat` on the affected computer.
- The helper stops the verified loopback service, swaps `app` with `app-rollback`, starts the restored runtime, and health-checks it.
- DPAPI credit profiles, credit metadata, Camoufox identity directories, shared snapshots, and bank data live outside the runtime directory and are not deleted by rollback.
- The v4 clients can consume the v27 monolithic result through the explicit 404-only legacy route fallback.
- On a first-ever install there is no earlier runtime to restore; reinstall the desired reviewed version instead.

## Verification performed

- Deterministic adapter fixtures: isolated Cal month/provider/schema/non-JSON errors; missing init/token/login UI; two-card isolation; full +12-month plan.
- LKG model tests: fresh/stale/missing merge, Core clock behavior, v1-v3 compatibility, no duplicate JSON transaction storage, no synthesized installments.
- Security tests: credential/token/raw-HTML exclusion from diagnostics and public profiles.
- Retry tests: 403 classification/circuit, 429 classification, and `Retry-After` parsing/deferral.
- Identity tests: config/path reuse contract, one-identity deletion isolation, and a real installed Camoufox 0.12.0 two-launch observable-identity comparison including canvas output.
- Repository core verification and the complete browser/deployment gate both passed on this working tree. Run the same gate again immediately before an actual deployment.

## Not verified against live issuer sites

No issuer credentials were used and no live request was sent to Visa Cal, MAX, Isracard, or American Express. Therefore the following remain explicit canary gates, not assumed facts:

- current production selectors/iframes and login success paths;
- current issuer API schemas, token/header requirements, and monthly status-code behavior;
- whether each issuer actually returns all requested future months for the specific account;
- whether Amex currently accepts the persisted identity from the canary network/device;
- the issuer’s real 403/429 frequency and actual `Retry-After` values;
- exact transaction/account totals versus v27 and each live issuer UI.

These checks cannot be marked complete without an authorized live canary run.

## Changed files

### Bridge and operational documentation

- `CREDIT_CONNECTOR_V2_REPORT.md`
- `netunim-kupa/bank-bridge/README.txt`
- `netunim-kupa/bank-bridge/install_bank_bridge.bat`
- `netunim-kupa/bank-bridge/rollback_bank_bridge.bat`
- `netunim-kupa/bank-bridge/package.json`
- `netunim-kupa/bank-bridge/package-lock.json`
- `netunim-kupa/bank-bridge/server.mjs`
- `netunim-kupa/bank-bridge/lib.mjs`
- `netunim-kupa/bank-bridge/credit-adapters.mjs`
- `netunim-kupa/bank-bridge/credit-diagnostics.mjs`
- `netunim-kupa/bank-bridge/credit-identity.mjs`
- `netunim-kupa/bank-bridge/isracard-camoufox.mjs`

### Kupa web client

- `netunim-kupa/site/assets/js/domains/bank/bridge.js`
- `netunim-kupa/site/assets/js/domains/credit/controller.js`
- `netunim-kupa/site/assets/js/domains/credit/sync-feed.js`
- `netunim-kupa/site/assets/js/domains/credit/view.js`
- `netunim-kupa/site/assets/js/state/contexts.js`
- `netunim-kupa/site/assets/js/state/normalization.js`
- `netunim-kupa/site/service-worker.js`

### Orders web client

- `netunim-orders/site/assets/js/domains/finance/bridge.js`
- `netunim-orders/site/assets/js/domains/finance/controller.js`
- `netunim-orders/site/assets/js/domains/finance/credit-feed.js`
- `netunim-orders/site/assets/js/domains/finance/view.js`
- `netunim-orders/site/service-worker.js`

### Verification

- `tests/bank_bridge_contracts.py`
- `tests/bank_bridge_models.test.mjs`
- `tests/credit_connector_v2.test.mjs`
- `tests/camoufox_identity_integration.mjs`
- `tests/credit_sync_models.test.mjs`
- `tests/orders_finance_sync_models.test.mjs`
- `tests/static_contracts.py`
