# Checked cashflow reconciliation

The full `shared/kupa-cashflow.js` body is now a strict checkJs root, together
with its actual finance-cache and card-history dependencies. It reuses the
existing BillingRow, billing-cycle, bank evidence, recurring debit/income and
cashflow-warning contracts. Reconciled rows add settlement and display metadata
to BillingRow, without another transaction/amount model. The canonical billing
provenance union includes the two existing reconciliation sources.

The forecast result discriminates a missing balance (both balance and projection
null) from a numeric balance, including zero. Bank detail fields remain unknown
after an object-shape check. Display card identity is distinct from the monetary
reconciliation and from settlement state. Internal graph-index checks stop on an
impossible index instead of inventing evidence. Three-component proof scores,
typed graph maps/sets and retained-row conversions check the real matching body.
The existing matching priorities, ambiguity bounds, amounts, currencies and
bank-settlement decisions are unchanged for valid inputs.

Validation: strict compilation and focused ESLint pass. 163 focused financial,
reconciliation, card-history and cache tests pass. 3,465 before/after comparisons
against `4efd24bb` match, including both accounts, null/zero/negative balances,
missing/signed card amounts, foreign currency, pending/completed transactions,
installments, year boundaries, historical billing and partial/malformed bank
identity details. Two local actual-body mutations reject replacing an unavailable
projection by zero and using a raw bank amount as money. Settlement/provenance
mutations and negative consumers also run in CI.

The root inventory is 343 (216 product modules, 127 fixtures). No eager module or
timing budget increases: modules remain 310/406. The source ceilings increase by
8,000 bytes per app for checked-body annotations and guards; the measured graph
is recorded by the startup budget test, with less than 1 KB headroom. Canonical
sources and both shipped copies are synchronized.

This does not make every boolean relationship in historical BillingRow a
compile-time theorem. Runtime money, coverage, FX and settlement regressions
remain necessary. General Sync Document bodies and larger provider models are
separate remaining checked-implementation targets.
