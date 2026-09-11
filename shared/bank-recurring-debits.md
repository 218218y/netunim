# Bank-backed monthly expense forecasts

`bank-recurring-debits.js` owns the three explicitly requested obligations:
home Hapoalim mortgage, home Mercantile mortgage, and business pension.
The user confirmed that the listed bank descriptions identify only these
obligations within their respective accounts. No amounts or personal identifiers
are embedded in the rules. Tracking begins in September 2026; an earlier posted
debit supplies the initial estimate without manufacturing pre-upgrade arrears.

## Calculation contract

- Match the normalized bank **description** and account role. Whitespace,
  directional formatting and hyphen variants are normalized; arbitrary substrings,
  memos and equal amounts are not identification evidence.
- A completed, non-missing ILS debit within the bank snapshot date is evidence.
  Pending rows, credits, future transactions and foreign currency do not settle
  a monthly obligation or set its estimated amount.
- One identified debit closes its posting calendar month. Its amount in cents
  seeds subsequent estimates. More than one debit in a month is ambiguous:
  retain any previous estimate and expose an incomplete-forecast warning.
- Generate one outstanding occurrence for every unproven month after the source,
  within the forecast horizon. Passing a due date or receiving a newer balance
  snapshot does not remove it. A later month's debit does not erase an earlier gap.
- Due dates are estimates for the 15th, moved to the 16th when the 15th is Saturday.
  Other holidays or exceptional collection delays are not guessed. Bank evidence,
  rather than the estimated date, controls settlement. A payment genuinely covering
  another calendar month cannot be inferred from the currently available fields.
- The bank balance already contains posted debits. The engine subtracts only
  outstanding estimates; it never subtracts the posted transaction again.
- Ordinary manual expenses remain independent. There is no legacy name-based
  suppression or migration of manual entries; the user removed those entries.

## Persistence and presentation

Both bank refresh controllers retain recognized source rows in
`feed.recurringDebitHistory`, alongside that account's balance and transactions
in the existing finance snapshot. Both feed normalizers preserve this field.
Fresh rows override retained evidence; missing rows are invalidated only by an
explicit missing state or absence inside a complete coverage window. Account
changes discard previous-account history. Keeping each monthly source preserves
gaps even after the rolling bank/archive window advances. This is a small subset
of the existing bank data, not a second bank transaction archive.

The shared checking cash-flow calculation and the separate Kupa long-term
calculation both consume this engine, retaining their existing horizons.
The expense screen includes overdue occurrences and a read-only bank tracking
section. The cash-flow drilldown displays source date, estimate, and awaiting
status, including the next scheduled debit when outside the current horizon.
Without a recognized source, no amount is invented; the tracking section reports
that no bank source exists. An invalidated previously recognized source produces
an incomplete-forecast warning.

The initial source comes from the existing synchronized feed. Later refreshes
persist its recognized history. The implementation neither connects to the live
bank nor changes stored user expenses as part of deployment.

## Verification

`tests/bank_recurring_debits.test.mjs` covers bank cents, account scoping, exact
horizon, early/late/staggered posting, Saturday handling, persistent missing
months, changed amounts, ambiguity, invalid evidence, independent manual entries,
source retention/correction/account changes, both app copies, and Kupa refresh.
`tests/orders_finance_sync_models.test.mjs` verifies retained history in the
Orders atomic save. `tests/runtime_financial.py` exercises rendered pending and
settled forecasts and desktop/mobile layout in both app shells.

Edit shared JavaScript only in `shared/`, then run `python tools/sync-assets.py`
to synchronize the two app copies and service-worker asset lists/cache keys.
