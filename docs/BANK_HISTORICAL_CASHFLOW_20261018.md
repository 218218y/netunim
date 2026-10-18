# Retained Bank clocks in cashflow

Bank observation dates now pass calendar/clock validation before they decide the
cashflow basis, feed availability or credit-settlement evidence. A future or
malformed retained observation cannot advance the reference or authorize settlement
from its feed rows. Invalid values remain in state for diagnosis and refresh recovery.

The check uses today's clock, independently of the requested calculation reference.
Valid observations newer than an earlier reference remain supported. Historical
date-only Bank observations remain readable. Future billing, expense and explicit
forecast dates are business dates and retain their existing rules. `bankSyncAt`
alone does not become a new cashflow basis or override independently valid evidence.

`bank_historical_cashflow.test.mjs` checks both accounts and both generated app
copies: poisoned clocks, malformed dates, unchanged retained state, unpaid credit,
legacy settlement, future forecasts and recovery after local clock correction.
The old year-2999 account-routing fixture now passes its intended calculation date
explicitly rather than relying on a future observation to move today's reference.
