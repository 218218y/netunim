# Finance contracts

Finance synchronization separates provider observations, archive/snapshot commands, durable confirmations and account-scoped read models. Use the existing Finance operation owner for writes and the shared calculations in `shared/` for both apps. Preserve the retained view when a provider reply or remote acknowledgement fails validation.

## Bank archive and checks

- Match within the captured owner, account and role. An archive ID identifies the previously stored row and its document links. A proven source identity needs event day, nonzero serial and signed amount. Preserve multiplicity, including equal-looking rows and repeated references. See [bank transaction identities](../../shared/bank-transaction-identity.md).
- An unmatched retained row can be declared missing only under complete coverage of its date and account. Read-back, balance-only replies and partial scans have distinct authority. Older date-only data stays readable without establishing a fresh observation.
- Shared Checks owns checks, bank events and their synchronization. Complete bank archive ingestion can update it in the same fenced SQL transaction. Explicit claims and ambiguous candidates prevent automatic matching.
- Hapoalim can replace an itemless direct-deposit placeholder with an itemized machine deposit containing one or more cheques. The fenced snapshot writer requires a newer complete scan covering both action days, a single pair in the scoped source and archive, exact ILS totals, the same Jerusalem value day and validated cheque items. The final action day may coincide with the original action day or move forward to the verified value day. A positive deposit reference or the bank's `-1` marker identifies a deposit representation. The item table supplies the cheque numbers. Running balance and reference continuity are unnecessary for this transition. [Lifecycle migration](../../supabase/migrations/20261120100000_bank_cheque_deposit_lifecycle.sql)
- The writer retains the pending archive ID on first finalization. If the final record already exists, the writer retains that ID and records the original pending row, its prior alert state and the final identity in `netunim_internal.bank_cheque_deposit_transitions`. A competing deposit, an incompatible cheque claim or a pending document link leaves the records separate and surfaces a review when a possible final deposit exists. Previously missing rows use the same reconciliation on a complete scan that still covers the original date.
- Keep recurring overlay one-to-one. Prefer archive identity, then proven source identity, and retain unmatched historical instances unless the matching coverage supports their removal. The [recurring-debit contract](../../shared/bank-recurring-debits.md) documents its projection rules.

## Credit observations and history

- Keep profile and card identities stable across devices. Use the existing profile setup flow on a second device. A provider name or card suffix alone cannot merge profiles, inherit inclusion/settings or replace history.
- Coverage requires positively decoded provider evidence. MAX accepts a documented-shaped empty response with numeric business code 10 or 11 and explicit null result. A bare null, transport failure, unknown business reply or partial forecast remains unverified. CAL also distinguishes explicit no-pending evidence from malformed or missing data. Optional forecast failure must preserve covered core data and report its own gap.
- Preserve each purchase occurrence separately. [The shared credit identity](../../shared/credit-transaction-identity.js) includes issuer, monetary and purchase witnesses, including purchase date/time, merchant and installment data. A provider ID alone cannot authorize replacement. For an unverified regression, retain the accepted card snapshot and mark the affected coverage incomplete.
- Credit version comparison accounts for effective inclusion, settings, assignment and calculated billing, using the same reference date and app normalizer. Restoration requires validated content, MFA, a reason, a current revision and a scoped server operation. It saves a prior version and preserves Bank and manual Kupa credit data. See [Recovery](../operations/recovery.md).

## Cash flow

Both apps use the same [cash-flow projection](../../shared/kupa-cashflow.js) and [calculation contract](../../shared/cashflow.md). The reference date determines evidence age and settlement. The optional end date determines the forecast horizon. Keep observation time, bank value day, issuer billing day and forecast end separate. A missing amount stays unknown until evidence supplies it.

Start with the model tests for the affected family under [tests](../../tests). Use the isolated PostgreSQL finance/checks suites for changes to SQL reconciliation, history preservation or revision authority.

### Cheque lifecycle rollout

1. Confirm a recoverable database backup or point-in-time restore before applying the migration. For an incident under review, capture the scoped archive rows, snapshot timestamps, claims and document links in a private recovery record.
2. Apply the forward migration and verify the live catalog before publishing either site. Both clients read the new `missing_reason` column and can still read the archive during a staged rollout. Follow the [Supabase release runbook](../operations/supabase.md).
3. After a complete account sync covering the original action day, verify one finalized archive row with its cheque items and a transition record with the original pending observation. Confirm the active missing alert cleared for that row and other missing alerts still appear.
4. To disable the new matching behavior, ship a forward migration restoring the previous merge and snapshot function bodies and keep the additive column available to deployed clients. Keep the transition records for audit. If a completed transition requires data recovery, compare its saved observation and dependencies against a restored backup in isolation before any scoped repair. [Recovery runbook](../operations/recovery.md)
