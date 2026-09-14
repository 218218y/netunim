# Account cash-flow projection

`kupaAccountCashflowData(state, account, reference, {targetDate})` is the shared
calculation used by Orders and Kupa. `reference` is the calculation date; an
optional `targetDate` selects the inclusive end of the forecast. Do not simulate
a future target by moving `reference`: that ages pending issuer data and changes
which bank transactions can be treated as posted.

The automatic horizon is an account-wide monthly window around the 15th
(16th when the 15th is Saturday), extended to known credit billing dates within
that month. Outstanding current obligations keep the current month open. Once
they are settled, the window moves to the following month. A paid card's next
cycle cannot advance an account while its other current obligations remain open.
An overdue window ends no earlier than the calculation date and explicitly
reports that settlement is still awaited. With no known obligations the fallback
is the upcoming mid-month boundary. Zero and fully offset cycles do not hold a
month open.

The forecast reuses issuer billing rows and bank settlement evidence. For this
projection, late bank postings can resolve a cycle before the next monthly cycle;
the existing provider/card identity and ambiguity checks still apply. An
unmatched current estimate is retained after the two-day diagnostic threshold.
Legacy `expiredSettlement*` fields remain for warning IDs and old consumers, but
do not mean the estimate was removed from the cash-flow calculation. Historical
fallback cycles are superseded by a proven current cycle for the same card;
explicitly incomplete cycles remain visible. A manual bank snapshot is the
authoritative baseline and does not use an old synchronized feed as evidence.

All selected credit rows, manual expense occurrences, bank-derived recurring
estimates and held cheques use the same inclusive end date. Legacy cheque cutoff
settings remain readable for compatibility but do not truncate a dated forecast.
Bank-derived recurring expenses use `bankRecurringExpensesData`; they are removed
only with its account-specific bank evidence, and future months use the latest
known posted amount. Unknown future card spending is not extrapolated.

`breach` uses the exact selected rows to find the first daily threshold crossing,
netting same-day movements without assuming an intraday order. Bank summaries
show its date even when the final balance recovers. The existing notification
lead-time setting controls popups/notifications, not the visible forecast warning.

The date explorer uses each app's central date editor and updates only its result
region. It changes no financial data and allows no date earlier than the current
calculation/balance baseline. Regression coverage is in
`tests/cashflow_horizon.test.mjs`, the existing credit/recurring models, and
`tests/runtime_financial.py` (both accounts, both apps, desktop and mobile).
