# Dashboard business position

Both applications use `shared/business-position.js` for the same base position:

`bank + all held business cheques - all known unpaid business card charges - one expense month`

Orders adds outstanding customer payments and supplier credit less supplier debt.
Kupa adds the same Orders summary plus the cash ledger. Amounts are summed in
integer agorot; display rounding cannot change the computed result. Missing bank
or Orders data produces an unavailable total. Unknown card amounts, unassigned
billing dates and incomplete issuer coverage produce a visibly partial estimate.

The bank is the authoritative snapshot plus explicit adjustments, excluding legacy
`check_deposit` adjustments. Only business cheques with status `בקופה` are added,
regardless of due date. Deposited, returned and home cheques are excluded. No bank
forecast is used as a starting balance, so its cheques cannot be added twice.

Credit uses the same monthly settlement and outstanding-row selector as the
dated cash-flow forecast. A timed-out settlement warning never proves payment;
unpaid elapsed cycles stay deducted until posted bank evidence resolves them.
Refunds offset charges. Unknown future spending is not extrapolated.

The existing expense policy is preserved: the automatic business forecast selects
the expense month, and expenses are counted through that month's last day, never
before the bank snapshot date. Bank-derived recurring expenses retain their own
posted-evidence rules. The UI names this month and the details show the window.
This is a position based on recorded commitments, not an accounting profit or a
promise of liquidity on a particular date. The Bank screens and their date
explorers retain the separate exact-date cash-flow calculation.

Supplier and customer ledgers remain authoritative for outstanding balances. The
system has no universal link proving that a manually entered card expense also
settled a supplier debit, or that a received cheque settled a customer debt. Such
payments must be recorded in those ledgers; automatically inferring links from
amounts or descriptions would silently erase legitimate liabilities or assets.

Regression coverage: `business_position.test.mjs`, `credit_billing_cycles.test.mjs`,
`sync_models.test.mjs`, and the browser financial acceptance suite.
