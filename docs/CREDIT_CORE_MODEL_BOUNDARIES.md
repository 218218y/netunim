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
directly. `lib.mjs` retains its historical 56 exports as a compatibility facade
and continues to own the Bank-specific code. Bank credit settlements and
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
  export set. The implementation checks preserve every declaration AST after
  routing; mutation tests detect altered debit signs, login identity, pending
  status and automation cooldown. The old facade exports are identical to the
  canonical functions and constants.
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
  follows their imports and the library re-exports. Native staged Bank and Credit
  server tests exercise the real commands, isolated filesystem publication,
  issuer model and browser-cleanup wait through the new module graph. Existing
  credit signs, monthly coverage, Bank normalization and static contracts pass.
  Required Windows CI includes the staged native tests and CurrentUser DPAPI.

## Remaining scope

The Bank-specific portion of `lib.mjs` still combines login timing, account
selection, cheque details and transaction normalization, so Bank consumers
retain that broad import. A future split should follow those responsibilities
while preserving the same Bank policy fixture. Credit profile, transaction and
failure object payloads still need incremental runtime-validation/type contracts
beyond the strictly checked scalar codec. The Credit adapter factory's 17 option
fields, DigitalV3/Camoufox internals, Document Bridge, application controllers,
compatibility inventory and measured UI/performance work remain in the broader
roadmap. Synthetic CI and native fixtures cannot replace a controlled live issuer
session and physical multi-computer check.
