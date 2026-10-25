# Checked credit coverage and month planning

`credit-coverage.mjs`, `credit-month-plan.mjs`, `credit-value-codec.mjs` and their
wire-constant dependency now have checked bodies, with their `@ts-nocheck`
exclusions removed. Coverage reuses the existing CreditMonthSlice, transaction,
provider and fetch-status contracts rather than defining another financial model.
Failure cannot be typed as success or a completed fetch timestamp; success keeps
canonical transactions and a known core/forecast tier. Unknown caught error
fields are inspected before formatting; diagnostic fields that were never
validated remain unknown.

The four modules perform no login, HTTP, browser automation or provider policy
change. Existing endpoint/wire constants and the archived 118-declaration provider
policy fixture stay frozen. Five explicitly reviewed source digests account only
for equivalent error-property inspection and constructing the Error code field;
all other provider normalization/fallback policies remain compared as before.

Validation: 398 focused Credit behavior/boundary/policy tests pass; 111 coverage,
error and month-plan comparisons against `2ab7760f` match; strict compilation and
focused ESLint pass. Two local compiler mutations reject fabricated fetch success
and a UI status. Timestamp/tier mutations and negative consumers remain in CI.
The root inventory is 339 (213 product modules, 126 fixtures), with 19 Bridge
exclusions remaining. These server-side files add no eager browser source.

`credit-monthly-projection.mjs` was probed but not added: its MAX dependency pulls
the larger raw-data diagnostic graph. That deserves a separate checked round,
along with provider models; no facade or broad any was added to bypass it.
The large cashflow reconciler and general Sync Document bodies remain separate
implementation targets. This stage does not claim their completion.
