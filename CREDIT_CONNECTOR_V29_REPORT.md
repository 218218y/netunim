# Credit Connector v29 — implementation, evidence and rollout

## Outcome

v29 is a focused correction on top of v28. It keeps Credit Connector contract v2, the v4 monthly Last Known Good model and the existing Supabase payload. There is no Supabase migration, production dependency swap or destructive data operation.

## Root causes and corrections

| Root cause | Risk in v28 | v29 correction |
|---|---|---|
| `parseVisaCalFrame()` required `data.result` | A valid optional Frames response was mislabeled as schema drift | Missing/null result is `CREDIT_FRAMES_UNAVAILABLE` warning; impossible declared types alone are schema errors |
| Frame selection had no proven no-match fallback | Account-level debit/limit could be lost when the only returned group had no matching card frame | A sole bank/cal group supplies the same account-level fallback fields defined by 6.9.0; ambiguous dual groups produce unavailable, not invented data |
| Response diagnostics fingerprinted only the event envelope | A live schema difference could not be investigated safely | Local response-shape fingerprint, key names and presence/type/count metadata; no values or identifiers |
| Frames/Pending shared the generic error list | Component failure could look like profile transaction failure | Explicit component plus `error/warning/deferred/info` severity; Core success depends only on Core Transactions |
| `interactive === true` bypassed the server cooldown lookup | The ordinary diagnostic button could violate 429 Retry-After or repeat a 403 | The same profile gate runs before every mode; no regular UI bypass exists |
| Deferred polls reused a failure-looking UI path | An old Amex block could appear to have happened again | Original failure time is retained, attempted count remains zero and both apps render a paused state |
| The diagnostics endpoint had no user-facing export | Safe incident data required manual LocalAppData access | Both clients copy only the endpoint's sanitized events |
| Installer text implied Camoufox WAF success | Local identity continuity was overstated as issuer acceptance | Installer states that only persistent anti-fingerprinting identity is proven locally; WAF acceptance is a live-canary gate |

## Evidence from israeli-bank-scrapers 6.9.0

The installed pinned package and its embedded TypeScript source map were inspected locally. `FramesResponse.result`, `calIssuedCards`, `bankIssuedCards` and `cardLevelFrames` are optional. The official Visa Cal adapter uses optional chaining, card-level debit when available, and `nextTotalDebitForAccount` / `nextTotalDebitDateForAccount` as account-level fallbacks. It returns undefined frame fields instead of failing the entire scrape.

v29 deliberately adds no response mappings beyond that proven 6.9.0 contract.

## Safe response diagnostics

The local JSONL event may include:

- `responseShapeFingerprint`;
- sorted top-level key names;
- result type;
- presence booleans for status/status-title fields;
- presence/type/count for bank/cal groups and their `cardLevelFrames` node.

It cannot include response values, card IDs, amounts, authorization, cookies, tokens, raw JSON, raw HTML or request bodies. Shape data is emitted only to the local diagnostics logger and loopback diagnostics endpoint; it is not added to the Kupa/Orders cloud error model.

## Verification performed

- Optional/missing/null Frames fixtures.
- Explicit provider error and genuinely malformed group fixtures.
- Bank-only, Cal-only and account-level fallback fixtures.
- Frames warning with successful Core Transactions.
- Frame Last Known Good preservation and stale labeling in Kupa and Orders.
- Response-shape redaction and value-independent fingerprint fixtures.
- 429 stops additional calls within the same Cal run.
- Profile cooldown preserves the original timestamp and returns deferred severity.
- Interactive refresh with attempted count zero does not update profile `attemptedAt`.
- Existing 12-month forecast and no-synthetic-installment tests remain in the repository verification gate.

### Commands and results

- `npm run lint` — passed.
- `node tests/credit_connector_v2.test.mjs` — passed.
- `node tests/bank_bridge_models.test.mjs` — passed.
- `node tests/credit_sync_models.test.mjs` — passed.
- `node tests/orders_finance_sync_models.test.mjs` — passed.
- `python tests/bank_bridge_contracts.py` — all Bank Bridge contracts passed.
- `python tests/static_contracts.py` — all static contracts passed.
- `python tests/run_all.py` — all repository verification suites passed, including browser/runtime, security, PWA, data-integrity, workflow and financial suites.
- `node tests/camoufox_identity_integration.mjs` — passed across two real local browser launches; user agent, platform, language, hardware, screen, timezone and canvas observations remained stable.
- `python tools/sync-assets.py --check` and `git diff --check` — passed.

## Live canary status

No live issuer request was sent and no issuer credentials were used during this change. Therefore none of the following is marked verified:

- the current live Cal Frames response shape;
- current Cal totals versus v28 and the issuer UI;
- Amex LoginPage WAF acceptance;
- Amex cookie/trusted-device continuity across two live launches;
- MAX or native Isracard phase/per-month parity.

The local Camoufox doctor proves runtime launch and observable identity continuity only. It does not prove WAF acceptance.

## Canary and deployment

1. Run the full repository verification immediately before deployment.
2. Install `netunim-kupa\bank-bridge\install_bank_bridge.bat` on one authorized canary computer.
3. Verify `/health` reports Bridge 29 and credit contract 2.
4. Perform exactly one Cal refresh and copy the safe technical diagnostic. Review the structural shape before adding any mapping not already in 6.9.0.
5. If Amex is not in an active cooldown, perform one live attempt. A 403 ends the canary with no rotation/retry. If accepted, perform a second launch only after the planned interval and verify that no new identity directory was created.
6. Compare transaction/frame totals with the issuer UI and v28 before deploying the web clients and remaining Bridge installations.

## Rollback

Run `%LOCALAPPDATA%\NetunimKupaBankBridge\rollback_bank_bridge.bat`. The runtime swap leaves DPAPI profiles, browser identities, diagnostics, shared snapshots and bank/credit business data outside the swapped application directory. The v29 web clients explicitly retain v28 contract-2 and v27 legacy rollback compatibility.

## Changed files

Bridge/runtime:

- `netunim-kupa/bank-bridge/README.txt`
- `netunim-kupa/bank-bridge/credit-adapters.mjs`
- `netunim-kupa/bank-bridge/credit-diagnostics.mjs`
- `netunim-kupa/bank-bridge/install_bank_bridge.bat`
- `netunim-kupa/bank-bridge/isracard-camoufox.mjs`
- `netunim-kupa/bank-bridge/lib.mjs`
- `netunim-kupa/bank-bridge/package-lock.json`
- `netunim-kupa/bank-bridge/package.json`
- `netunim-kupa/bank-bridge/server.mjs`

Kupa client:

- `netunim-kupa/site/assets/js/domains/credit/controller.js`
- `netunim-kupa/site/assets/js/domains/credit/sync-feed.js`
- `netunim-kupa/site/assets/js/domains/credit/view.js`
- `netunim-kupa/site/assets/js/main.js`
- `netunim-kupa/site/assets/js/ui/actions.js`
- `netunim-kupa/site/service-worker.js`

Orders client:

- `netunim-orders/site/assets/js/domains/finance/controller.js`
- `netunim-orders/site/assets/js/domains/finance/credit-feed.js`
- `netunim-orders/site/assets/js/domains/finance/reporting.js`
- `netunim-orders/site/assets/js/domains/finance/view.js`
- `netunim-orders/site/assets/js/main.js`
- `netunim-orders/site/assets/js/ui/actions.js`
- `netunim-orders/site/service-worker.js`

Verification and delivery:

- `tests/bank_bridge_contracts.py`
- `tests/bank_bridge_models.test.mjs`
- `tests/credit_connector_v2.test.mjs`
- `tests/credit_sync_models.test.mjs`
- `tests/orders_finance_sync_models.test.mjs`
- `tests/static_contracts.py`
- `CREDIT_CONNECTOR_V29_REPORT.md`

## Deferred research

MAX per-month parity and the `@sergienko4/israeli-bank-scrapers` fork remain research-only until Cal and Amex pass their live gates. Production dependencies were not changed.
