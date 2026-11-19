# Finance contracts

Finance synchronization separates provider observations, archive/snapshot commands, durable confirmations and account-scoped read models. Use the existing Finance operation owner for writes and the shared calculations in `shared/` for both apps. Preserve the retained view when a provider reply or remote acknowledgement fails validation.

## Bank archive and checks

- Match within the captured owner, account and role. An archive ID identifies the previously stored row and its document links. A proven source identity needs event day, nonzero serial and signed amount. Preserve multiplicity, including equal-looking rows and repeated references. See [bank transaction identities](../../shared/bank-transaction-identity.md).
- An unmatched retained row can be declared missing only under complete coverage of its date and account. Read-back, balance-only replies and partial scans have distinct authority. Older date-only data stays readable without establishing a fresh observation.
- Shared Checks owns checks, bank events and their synchronization. Complete bank archive ingestion can update it in the same fenced SQL transaction. Explicit claims and ambiguous candidates prevent automatic matching.
- Aggregate cheque deposits can transition from a zero-reference, itemless direct-deposit placeholder to an itemized machine deposit under uniquely matching currency, amounts and Jerusalem transaction/value days. The [SQL migration](../../supabase/migrations/20261117070000_bank_aggregate_cheque_transition.sql) also validates complete coverage, cheque totals and existing claims. Only a later complete sync performs reconciliation.
- Keep recurring overlay one-to-one. Prefer archive identity, then proven source identity, and retain unmatched historical instances unless the matching coverage supports their removal. The [recurring-debit contract](../../shared/bank-recurring-debits.md) documents its projection rules.

## Credit observations and history

- Keep profile and card identities stable across devices. Use the existing profile setup flow on a second device. A provider name or card suffix alone cannot merge profiles, inherit inclusion/settings or replace history.
- Coverage requires positively decoded provider evidence. MAX accepts a documented-shaped empty response with numeric business code 10 or 11 and explicit null result. A bare null, transport failure, unknown business reply or partial forecast remains unverified. CAL also distinguishes explicit no-pending evidence from malformed or missing data. Optional forecast failure must preserve covered core data and report its own gap.
- Preserve each purchase occurrence separately. [The shared credit identity](../../shared/credit-transaction-identity.js) includes issuer, monetary and purchase witnesses, including purchase date/time, merchant and installment data. A provider ID alone cannot authorize replacement. For an unverified regression, retain the accepted card snapshot and mark the affected coverage incomplete.
- Credit version comparison accounts for effective inclusion, settings, assignment and calculated billing, using the same reference date and app normalizer. Restoration requires validated content, MFA, a reason, a current revision and a scoped server operation. It saves a prior version and preserves Bank and manual Kupa credit data. See [Recovery](../operations/recovery.md).

## Cash flow

Both apps use the same [cash-flow projection](../../shared/kupa-cashflow.js) and [calculation contract](../../shared/cashflow.md). The reference date determines evidence age and settlement. The optional end date determines the forecast horizon. Keep observation time, bank value day, issuer billing day and forecast end separate. A missing amount stays unknown until evidence supplies it.

Start with the model tests for the affected family under [tests](../../tests). Use the isolated PostgreSQL finance/checks suites for changes to SQL reconciliation, history preservation or revision authority.
