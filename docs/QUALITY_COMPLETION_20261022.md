# Focused quality completion, 2026-10-22

Base: `2289bdbaf5abe246b50366ec558cf1e35e9214cd` (PR 281), Document Bridge v43. Source findings are verified
against this checkout; the external archive review is a research input.

## Financial presentation

Reproduced missing normalized transaction amounts becoming zero in both bank
alert kinds and Morning selection labels. Both bank tables also collapsed
unknown and genuine zero into the same empty debit/credit cells. They now use
the existing `readBankMoney` contract: unknown amounts say “סכום לא ידוע”, zero
remains a known displayed amount, and signed amounts retain their direction.
Unknown amounts span both direction columns without inventing a debit or credit.
Morning eligibility is unchanged; absent/nonpositive amounts cannot be selected
for receipt creation. Selected historical labels still explain unknown amounts.

Caption and post-transaction balance reads use the same contract defensively.
Normal feed normalization already rejects missing primary balances; this is
additional presentation protection, not evidence of corrupt stored balances.
No historical values, archive metadata, acknowledgement identities, storage,
synchronization or provider writes are changed.

`tests/bank_money_display.test.mjs` exercises normalization → alert/selection
model → actual HTML and public view methods, unknown/coercible/invalid amounts,
true and numeric-string zero, signed values, navigation and dismissal. Existing
bank/Morning/integrity/date tests remain required, together with the full CI gate.

## Remaining investigations and acceptance

Search parity and representative peak resource measurement follow this stage.
Default Bank Bridge CORS remains unchanged until actual client/origin inventory
and recovery evidence justify a compatibility change. See the existing
[threat model](BRIDGE_THREAT_MODEL_20261022.md).

Two physical computers, full installed Windows/PWA upgrades, copied-backup
restores with pending work and real financial test-provider cases remain
**NOT RUN** without the isolated environment required by the
[operational protocol](OPERATIONAL_ACCEPTANCE_20261022.md). Automated/synthetic
evidence must not be relabeled as physical acceptance.
