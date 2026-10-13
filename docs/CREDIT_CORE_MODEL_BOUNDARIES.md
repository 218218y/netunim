# Credit core model boundaries

This stage starts at the tested and merged `a676537375dfb0eb04a4e1dfc805e377ced013d3`.
The Bank Bridge library still placed Credit profile validation, monetary and
transaction normalization, diagnostic redaction and failure/cooldown policy
beside Bank login polling, account selection and cheque processing. That meant
even pure CAL/MAX calculations imported the Bank runtime library.

## Canonical responsibilities

| Capability | Implementation |
| --- | --- |
| Bounded text, nullable amounts, debit sign and explicit transaction time | `credit-core-values.mjs` |
| Supported providers, credential normalization, profile identity and public profile shape | `credit-profile-model.mjs` |
| Transaction, month and account normalization, deduplication and issuer available-credit rules | `credit-transaction-model.mjs` |
| Safe provider error context, rate-limit/automation cooldown, deferral and error severity | `credit-failure-policy.mjs` |

All Credit production consumers now import the relevant canonical module
directly. At the end of this stage, `lib.mjs` exported only its
34 Bank functions/constants; the subsequent
[Bank core stage](BANK_CORE_RESPONSIBILITY_BOUNDARIES.md) retires that library
after routing Bank consumers to canonical owners. Bank credit settlements and
permission details remain Bank behavior, because they interpret Bank transaction
payloads rather than Credit issuer responses.

This is a responsibility change, not a data migration. Transaction signs,
unknown/missing charge handling, pending status, issuer available credit,
provider credentials, error stage/redaction and retry/cooldown policy match the
original implementation. The adapter policy and deployed wire formats remain
unchanged.

## Evidence

- A fixture taken from the exact starting Git commit hashes all 73 Bank and
  30 Credit library declarations. It also fixes the historical 56-name public
  export set as historical evidence. The implementation checks preserve every declaration AST after
  routing; mutation tests detect altered debit signs, login identity, pending
  status and automation cooldown. Current exports are the Bank portion of that
  baseline; all Credit re-exports have been removed.
- The four new models have explicit import budgets and no direct browser,
  process, network or timer authority. Negative mutations prove those guards
  reject such dependencies. CAL/MAX projections and issuer adapters no longer
  import the Bank library for Credit models; Bank-only consumers retain their
  existing dependencies.
- The actual amount codec and negative consumers are in strict `checkJs`.
  Replacing a signed numeric amount with display text fails compilation. Wider
  account and issuer payloads remain outside this strict boundary; no complete
  connector typing is claimed here.
- The installer stages all four new modules, and the transitive packaging check
  follows their imports. Native staged Bank and Credit
  server tests exercise the real commands, isolated filesystem publication,
  issuer model and browser-cleanup wait through the new module graph. Existing
  credit signs, monthly coverage, Bank normalization and static contracts pass.
  Required Windows CI includes the staged native tests and CurrentUser DPAPI.

## Retirement and browser gate correction

The consumer audit also removed `credit-adapters.mjs`, `credit-diagnostics.mjs`,
the uninstantiated `GenericScraperAdapter`, its unused `maxRawDiagnosticSamples`
helper, and the `creditStartDate` alias. Commands, tests and the server import
their canonical owners directly. The default month plan calls
`creditRecoveryStartDate` directly. Historical policy fixtures remain immutable;
the three retired adapter declarations are explicitly excluded, and only that
default initializer's synonymous function name is normalized for comparison.
Current import/installer guards reject any reintroduction of the retired files.

The PR's first browser-ui run failed in the existing Orders document privacy
fixture after the push run passed. The fixture cloned some DOM nodes but left
the application's real search owner subscribed to its own auth instance.
Both owners still resolved the same live DOM by ID. Observing the test login
from the production auth instance deterministically cleared the test's results,
preview and input. This reproduced the earlier intermittent search/preview
timeouts without any change to application data or Credit models.

The fixture now disposes the existing search owner before binding the synthetic
source. Each synthetic provider request deliberately invokes the production auth
observer during the request, so the formerly random interleaving is checked on
every run. Search/preview deadlines and privacy/IDB assertions are unchanged.
Failure diagnostics now include phase, input, bounded display state and synthetic
requests. Both apps' local and cross-tab privacy cases pass with this interleaving.

Read-only persisted-data compatibility remains distinct from retired code APIs.
`storage-v2-persisted-compat.js` is consumed by the current bootstrap, operation
decoder and IndexedDB journal when reading earlier durable records. A fresh
deployment does not rewrite those records or imported backups. Removing these
readers requires evidence that no retained data needs them, or a verified data
migration; it is not part of eliminating the unused Credit module exports.

## Remaining scope

The subsequent [Bank core stage](BANK_CORE_RESPONSIBILITY_BOUNDARIES.md) separates
login timing, account selection, cheque details and transaction normalization,
preserving the active declarations against the same immutable Bank fixture.
Credit profile, transaction and
failure object payloads still need incremental runtime-validation/type contracts
beyond the strictly checked scalar codec. The Credit adapter factory's 17 option
fields, DigitalV3/Camoufox internals, Document Bridge, application controllers,
compatibility inventory and measured UI/performance work remain in the broader
roadmap. Synthetic CI and native fixtures cannot replace a controlled live issuer
session and physical multi-computer check.
