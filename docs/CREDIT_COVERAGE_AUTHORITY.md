# Current Credit replacement authority

The current response decoder now validates supplied amounts, installment counts,
charge flags and successful replacement lists before either application's
retained-feed normalizer runs. Saved historical feeds keep their compatibility
reader; null or absent issuer amounts still mean no monetary evidence.

The source-grounded regression was a successful `2026-10` month with an omitted
`transactions` field. With an included card mapping, `readCreditRefreshResult`
accepted it and both merge owners replaced the known month with zero transactions.
The same omission in a successful pending component also authorized replacement.
An explicit empty array remains a valid successful result; failed component reads
retain the prior data. Both success spellings recognized by the retained reader
(`fetchStatus: success`, or omitted fetch status with `status: fresh`) are guarded.

Boolean/array amounts can no longer acquire numeric meaning through `Number`.
Supplied installment evidence must be positive safe integers with part <= total.
Unknown charge statuses, nonboolean foreign-transaction flags, malformed/duplicate
month keys and unknown month retrieval/tier values fail the whole response.

`credit_business_evidence.test.mjs` exercises both real merge implementations,
valid producer output, empty success and failed-component retention. The actual
Orders/Kupa refresh-owner regressions prove zero merge/publication on missing
monthly/pending rows and boolean amounts, with normal lease cleanup. The full
existing lifecycle/provider suite remains required in CI.
