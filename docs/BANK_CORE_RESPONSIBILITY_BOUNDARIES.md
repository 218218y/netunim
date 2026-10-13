# Bank core responsibility boundaries

This stage starts at the tested and merged
`d78125367ae00293e12c766c085d8dac206ebeb0`. The remaining Bank-only
`lib.mjs` mixed browser login polling with account identity, transaction
normalization, cheque extraction, supplemental details and failure policy.
Its consumers imported this broad module even when they only needed a date or
an account selector.

## Canonical responsibilities

| Responsibility | Implementation |
| --- | --- |
| Existing bounded login, readiness, retry and history settings | `hapoalim-policy.mjs` |
| Transient-navigation classification and retry callback policy | `hapoalim-navigation-policy.mjs` |
| Awaited terminal-login polling and browser URL observation | `hapoalim-login-runtime.mjs` |
| Normalized bank/branch/account identifiers and selectors | `hapoalim-account-selector.mjs` |
| Public account choices and exact, unambiguous descriptor selection | `hapoalim-account-model.mjs` |
| Bounded detail values and semantic/security field classification | `hapoalim-detail-values.mjs`, `hapoalim-detail-keys.mjs` |
| Deposit/return classification and structured cheque identity | `hapoalim-cheque-model.mjs` |
| Posted Bank issuer settlements and permission details | `hapoalim-credit-settlement-model.mjs` |
| Safe detail URLs and bounded supplemental-detail normalization/merge | `hapoalim-additional-details-model.mjs` |
| Existing local-date formatting and nullable Bank-date decoding | `hapoalim-date-codec.mjs` |
| Reported page capacity and Bank transaction projection | `hapoalim-transaction-model.mjs` |
| Scraper failure classification and public message | `hapoalim-failure-policy.mjs` |

Models have explicit dependency budgets and no direct browser, filesystem,
network or timer authority. The login runtime alone owns its awaited polling;
the existing session/provider capabilities continue to own browser lifecycle.
There is no replacement library facade or application-wide context. Commands,
server composition, provider helpers, tests and installer staging import the
actual owners directly.

## Preservation and retirement evidence

The immutable fixture `tests/fixtures/credit-core-policy.json` contains all 73
original Bank declarations. All 70 active declaration ASTs match that fixture;
the remaining three were removed only after auditing their consumers:

- `normalizeAccountNumber` was exercised only by an obsolete test. Active
  account identity uses `normalizeAccountPart` and `parseAccountSelector`.
- `selectBalanceAccount` had no production consumer. The active provider
  selects an exact account descriptor before requesting that account's data.
  Ambiguous and missing account selections still fail closed.
- `isHapoalimChequeTransaction` was an unused deposit-only wrapper. Active
  enrichment uses `hapoalimChequeTransactionKind`, which also distinguishes
  returned and returned-credit rows. Existing positive and false-positive
  characterization cases now call that active classifier directly.

The historical fixture is unchanged. Mutation checks reject changed account
ambiguity, cheque identity requirements, serial-zero pending status, retry
limits and closed-browser handling. Import/effect, acyclic-graph and retirement
guards reject a broad-library import or reintroduced legacy export.

No provider behavior, wire format, persisted schema or migration changes here.
Login deadlines, transient-only retries, account/branch identity, page splitting,
retained transaction rows, pending debits, cheque field association, URL origin
restrictions, unsafe detail filtering and existing local-date semantics remain
the reviewed implementations. Bank credit settlements remain Bank models;
Credit issuer payloads retain their separate models and adapters.

## Contracts and integration evidence

The actual selector, date codec, detail values and detail keys now compile under
strict `checkJs`. Negative consumers prove string account identifiers, nullable
decoded dates, boolean field markers and supported formatter inputs. Mutating
the actual selector to return a numeric bank code or the date decoder to return
a numeric status fails compilation.

Focused account/session/enrichment and model tests pass. The installer stages all
13 canonical modules and its transitive import closure contains no `lib.mjs`.
Native staged Bank tests start the real HTTP composition, exercise CurrentUser
DPAPI, account normalization and artifact publication, and hold provider browser
cleanup before allowing command completion. Required branch CI also exercises
the unchanged Credit composition and the full database/browser/Windows matrix.

## Remaining scope

This completes the broad Bank model-library split. Wider Bank transaction,
account/error objects and provider command envelopes still need incremental
runtime-validation and strict implementation/consumer contracts. Large Credit
adapter construction, DigitalV3/Camoufox internals, Document Bridge and private
application controllers remain separate responsibilities in the roadmap.
Controlled live-provider and physical multi-computer checks remain distinct
from synthetic CI evidence.

Current historical-data readers are retained. Deploying new JavaScript does not
rewrite old IndexedDB records or imported backups; their retirement requires a
verified data migration or evidence that those retained records no longer exist.
