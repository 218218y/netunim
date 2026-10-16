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

## Producer closure

The actual Bridge normalizer could independently launder the same malformed raw
input: `normalizeCreditMonthSlice({month: '2026-10', fetchStatus: 'success'})`
produced `transactions: []`, and a transaction with `chargedAmount: true` became
`chargedAmount: 1`. Browser-only validation cannot identify this after conversion.

The canonical Credit contract is now standalone and synchronized by the existing
asset generator into `bank-bridge/credit-transaction-evidence.mjs`. Transaction,
month and account producers invoke it before coercion/deduplication. A producer
failure uses `CREDIT_PROVIDER_SCHEMA_ERROR`, stage `Transactions`, without retry
authority; the current browser response keeps its separate failure code.

The installer explicitly stages the new file. Transitive packaging and real
isolated runtime-start tests exercise that deployed file list. Producer tests
disable three actual guards and reproduce missing-list and boolean-money defects;
the browser/Bridge source parity and pure-module guards prevent a second schema
implementation or platform dependency from appearing.

Earlier raw amount conversion is guarded too: `creditNumber`/`creditDebitAmount`
(used by Isracard/Amex), Cal's amount parser and MAX's formatted-number parser
reject booleans/containers/nonfinite numbers before sign or formatting conversion.
Issuer-specific numeric strings and nullable missing amounts remain supported.
A fourth implementation mutation reproduces `true -> -1` and `[120] -> -120`
when the raw admission guard is removed.

Local verification passed 575 Credit/Finance/provider/Bridge contracts, existing
Bank Bridge static contracts, strict typecheck and ESLint. Startup remains 297 /
397 eager modules, with 1,735,203 / 2,354,584 source bytes. The former Kupa limit
was exceeded by 203 bytes after the authority fixes. Source ceilings are restored
to about one percent reserve (1,753,000 / 2,379,000); time ceilings and module
limits are unchanged. This is an explicit maintenance reserve, not a measured
speed improvement or justification for additional lazy loading.
